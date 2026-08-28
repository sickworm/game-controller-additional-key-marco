import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { access, copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, ConfigStore } from "./config-store.mjs";

const rootDir = path.resolve(process.env.APP_ROOT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));
const webDir = path.join(rootDir, "app", "web");
const port = parsePort(process.env.PORT ?? "3780");
const store = new ConfigStore(rootDir);
const sockets = new Set();
const pendingCaptures = new Set();
const runtimeDir = path.join(rootDir, "runtime");
const sessionPath = path.join(runtimeDir, "runtime-session.json");
const xinputProbeRequestPath = path.join(runtimeDir, "xinput-probe-request.ini");
const xinputProbeResultPath = path.join(runtimeDir, "xinput-probe-result.ini");
// HidHide's existing allow-list registers the 64-bit executable.  Do not use
// AutoHotkey.exe here: it can read keyboard hotkeys but not the cloaked GameSir.
const AHK_EXE = resolveToolPath("GAMESIR_AHK_EXE", [
  "D:\\AutoHotkey\\v2\\AutoHotkey64.exe",
  "C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe",
  "C:\\Program Files\\AutoHotkey\\AutoHotkey64.exe",
]);
const VJOY_DLL = resolveToolPath("GAMESIR_VJOY_DLL", ["C:\\Program Files\\vJoy\\x64\\vJoyInterface.dll"]);
const XOUTPUT_EXE = resolveToolPath("GAMESIR_XOUTPUT_EXE", [
  path.join(rootDir, "tools", "XOutput-3.32", "XOutput.exe"),
  "D:\\codex_workspace\\tools\\XOutput-3.32\\XOutput.exe",
]);
const XOUTPUT_SETTINGS = path.join(path.dirname(XOUTPUT_EXE), "settings.json");
const XOUTPUT_BACKUP_DIR = path.join(runtimeDir, "xoutput-backups");
// vJoy's DirectInput product GUID is stable for the supported driver. An
// override supports installations whose vJoy driver exposes another GUID.
const VJOY_DEVICE_GUID = (process.env.GAMESIR_VJOY_GUID ?? "398d7d30-98e6-11f1-8002-444553540000").toLowerCase();
const HIDHIDE_CLI = resolveToolPath("GAMESIR_HIDHIDE_CLI", [
  "D:\\HidHide\\x64\\HidHideCLI.exe",
  "C:\\Program Files\\HidHide\\x64\\HidHideCLI.exe",
]);
const AHK_SCRIPT = path.join(rootDir, "gamesir_merge_vjoy_f9_f12.ahk");
let runtimeSession;
let xinputProbePromise;
let lastXinputProbeResult;

await store.init();
runtimeSession = await recoverRuntimeSession();
const server = http.createServer(async (request, response) => {
  const requestId = crypto.randomUUID();
  try {
    enforceLocalRequest(request);
    await route(request, response, requestId);
  } catch (error) {
    const status = error instanceof ConfigError ? error.status : 500;
    const code = error instanceof ConfigError ? error.code : "INTERNAL_ERROR";
    if (status >= 500) console.error(JSON.stringify({ level: "error", requestId, message: error.message, stack: error.stack }));
    json(response, status, { error: { code, message: status === 500 ? "服务内部错误。" : error.message, requestId } });
  }
});

server.on("upgrade", (request, socket) => {
  try {
    enforceLocalRequest(request);
    if (request.headers.origin && request.headers.origin !== `http://127.0.0.1:${port}`) throw new Error("Cross-origin WebSocket denied");
    if (new URL(request.url, "http://127.0.0.1").pathname !== "/ws") throw new Error("Not found");
    const key = request.headers["sec-websocket-key"];
    if (!key || request.headers["sec-websocket-version"] !== "13") throw new Error("Invalid WebSocket request");
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, "\r\n"].join("\r\n"));
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
    fullStatus().then((status) => sendWs(socket, "status.snapshot", status)).catch(() => socket.destroy());
  } catch {
    socket.destroy();
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(JSON.stringify({ level: "info", message: "Configuration center listening", address: `http://127.0.0.1:${port}` }));
});
setInterval(() => fullStatus().then((status) => broadcast("status.changed", status)).catch(() => {}), 1000).unref();
setInterval(() => flushCaptureResults().catch(() => {}), 250).unref();

async function route(request, response, requestId) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { data: { status: "ok", address: `127.0.0.1:${port}` } });
  if (request.method === "GET" && url.pathname === "/api/status") return json(response, 200, { data: await fullStatus() });
  if (request.method === "POST" && url.pathname === "/api/configuration/save") {
    const payload = await body(request);
    const saved = await store.saveConfiguration(payload);
    broadcast("config.changed", await fullStatus());
    return json(response, 200, { data: saved });
  }
  if (request.method === "POST" && url.pathname === "/api/executor/reload") {
    const reload = await store.requestReload();
    broadcast("config.changed", await fullStatus());
    return json(response, 200, { data: reload });
  }
  if (request.method === "POST" && url.pathname === "/api/runtime/check-environment") return json(response, 200, { data: await checkEnvironment() });
  if (request.method === "POST" && url.pathname === "/api/runtime/start-preflight") return json(response, 200, { data: await startPreflightExecutor() });
  if (request.method === "POST" && url.pathname === "/api/runtime/start") return json(response, 200, { data: await startRuntime() });
  if (request.method === "POST" && url.pathname === "/api/runtime/stop") {
    const result = await stopRuntime();
    json(response, 200, { data: result });
    if (result.service === "stopping") setTimeout(shutdownService, 100).unref();
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/xoutput/configuration/snapshot") return json(response, 200, { data: await snapshotXoutputConfiguration({ required: true }) });
  if (request.method === "POST" && url.pathname === "/api/xoutput/configuration/restore") {
    const result = await restoreXoutputConfiguration((await body(request)).backupId);
    broadcast("status.changed", await fullStatus());
    return json(response, 200, { data: result });
  }
  if (request.method === "GET" && url.pathname === "/api/profiles") return json(response, 200, { data: await store.listProfiles() });
  if (request.method === "GET" && url.pathname === "/api/input-sources") return json(response, 200, { data: await store.readSources() });
  if (request.method === "GET" && url.pathname === "/api/device-settings") return json(response, 200, { data: await store.readDeviceSettings() });
  if (request.method === "POST" && url.pathname === "/api/xinput/probe") return json(response, 200, { data: await probeXinputSlots() });
  if (request.method === "POST" && url.pathname === "/api/xinput/detect-physical") return json(response, 200, { data: await detectPhysicalXinput() });
  if (request.method === "PUT" && url.pathname === "/api/device-settings") {
    const settings = await store.saveDeviceSettings(await body(request));
    broadcast("config.changed", await fullStatus());
    return json(response, 200, { data: settings });
  }
  if (request.method === "POST" && url.pathname === "/api/input-sources/capture") {
    const ahk = await ahkStatus();
    if (ahk.status !== "running") throw new ConfigError("AHK_OFFLINE", "AHK 执行器未连接，不能开始背键识别。", 409);
    const captureRequest = await body(request);
    const capture = await store.beginCapture(captureRequest.logical, captureRequest.expectedSource);
    pendingCaptures.add(capture.id);
    return json(response, 201, { data: capture });
  }
  const captureMatch = url.pathname.match(/^\/api\/input-sources\/capture\/([0-9a-f-]+)$/);
  if (captureMatch && request.method === "GET") {
    const capture = await store.captureStatus(captureMatch[1]);
    if (capture.status === "success") {
      broadcast("config.changed", await fullStatus());
      if (capture.preflight) broadcast("preflight.changed", capture.preflight);
    }
    return json(response, 200, { data: capture });
  }
  if (request.method === "PUT" && url.pathname === "/api/input-sources") {
    const payload = await body(request);
    const sources = await store.saveSources(payload.sources, payload.expectedRevision);
    broadcast("config.changed", await fullStatus());
    return json(response, 200, { data: sources });
  }
  if (request.method === "POST" && url.pathname === "/api/profiles") {
    const profile = await store.createProfile((await body(request)).name);
    broadcast("config.changed", await fullStatus());
    return json(response, 201, { data: profile });
  }
  const profileMatch = url.pathname.match(/^\/api\/profiles\/([a-z0-9-]+)$/);
  if (profileMatch && request.method === "GET") return json(response, 200, { data: await store.getProfile(profileMatch[1]) });
  if (profileMatch && request.method === "PATCH") {
    const profile = await store.renameProfile(profileMatch[1], (await body(request)).name);
    broadcast("config.changed", await fullStatus());
    return json(response, 200, { data: profile });
  }
  if (profileMatch && request.method === "DELETE") {
    await store.deleteProfile(profileMatch[1]);
    broadcast("config.changed", await fullStatus());
    response.writeHead(204); return response.end();
  }
  if (profileMatch && request.method === "PUT") {
    const payload = await body(request);
    const profile = await store.saveProfile(profileMatch[1], payload.profile, payload.expectedRevision);
    broadcast("config.changed", await fullStatus());
    return json(response, 200, { data: profile });
  }
  const activateMatch = url.pathname.match(/^\/api\/profiles\/([a-z0-9-]+)\/activate$/);
  if (activateMatch && request.method === "POST") {
    const activated = await store.activateProfile(activateMatch[1]);
    broadcast("config.changed", await fullStatus());
    return json(response, 200, { data: activated });
  }
  const exportMatch = url.pathname.match(/^\/api\/profiles\/([a-z0-9-]+)\/export$/);
  if (exportMatch && request.method === "GET") return json(response, 200, { data: await store.getProfile(exportMatch[1]) });
  if (request.method === "POST" && url.pathname === "/api/profiles/import") {
    const profile = await store.importProfile((await body(request)).profile);
    broadcast("config.changed", await fullStatus());
    return json(response, 201, { data: profile });
  }
  if (request.method === "POST" && url.pathname === "/api/preflight/run") {
    const report = await runPreflight();
    await store.writePreflight(report);
    broadcast("preflight.changed", report);
    return json(response, 200, { data: report });
  }
  const preflightConfirmMatch = url.pathname.match(/^\/api\/preflight\/([0-9a-f-]+)\/confirm-xoutput$/);
  if (preflightConfirmMatch && request.method === "POST") {
    if ((await processStatus("XOutput.exe")).status !== "running") throw new ConfigError("XOUTPUT_OFFLINE", "XOutput 进程未运行，不能确认虚拟 Xbox 输出。", 409);
    const report = await store.confirmXOutputPreflight(preflightConfirmMatch[1]);
    broadcast("preflight.changed", report);
    return json(response, 200, { data: report });
  }
  const preflightMatch = url.pathname.match(/^\/api\/preflight\/([0-9a-f-]+)$/);
  if (preflightMatch && request.method === "GET") return json(response, 200, { data: await store.getPreflight(preflightMatch[1]) });
  if (request.method === "GET") return serveStatic(url.pathname, response);
  throw new ConfigError("NOT_FOUND", "未找到该接口。", 404);
}

async function flushCaptureResults() {
  for (const id of [...pendingCaptures]) {
    try {
      const capture = await store.captureStatus(id);
      if (capture.status === "waiting") continue;
      pendingCaptures.delete(id);
      broadcast("input.captureResult", capture);
      if (capture.status === "success") {
        broadcast("config.changed", await fullStatus());
        if (capture.preflight) broadcast("preflight.changed", capture.preflight);
      }
    } catch (error) {
      if (error instanceof ConfigError && error.code === "CAPTURE_NOT_FOUND") pendingCaptures.delete(id);
      else throw error;
    }
  }
}

async function fullStatus() {
  const ahk = await ahkStatus();
  const xoutput = await componentStatus("xoutput", "XOutput.exe");
  const ahkOwnership = await componentStatus("ahk", "AutoHotkey64.exe");
  return {
    service: { status: "running", address: `127.0.0.1:${port}`, ownership: "managed", sessionId: runtimeSession.sessionId },
    ...(await store.status()),
    ahk: { ...ahk, ownership: ahkOwnership.ownership, pid: ahkOwnership.pid, startedAt: ahkOwnership.startedAt },
    xoutput,
    xoutputConfiguration: await xoutputConfigurationStatus(),
  };
}

async function xoutputConfigurationStatus() {
  let document;
  try { document = JSON.parse(await readFile(XOUTPUT_SETTINGS, "utf8")); }
  catch (error) { return { status: error.code === "ENOENT" ? "missing" : "invalid", detail: error.code === "ENOENT" ? "未找到 XOutput settings.json。" : "XOutput settings.json 不是有效 JSON。", backups: await listXoutputBackups() }; }
  const assessment = assessXoutputConfiguration(document);
  let backup;
  if (assessment.status === "protected") backup = await snapshotXoutputConfiguration({ document, required: false });
  return { ...assessment, ...(backup?.backup ? { latestBackup: backup.backup } : {}), backups: await listXoutputBackups() };
}

function assessXoutputConfiguration(document) {
  const mappings = document?.Mapping?.[0]?.Mappings;
  if (!mappings || typeof mappings !== "object") return { status: "invalid", detail: "未找到 Controller 映射。" };
  const mappers = Object.values(mappings).flatMap((mapping) => Array.isArray(mapping?.Mappers) ? mapping.Mappers : []);
  const assigned = mappers.map((mapper) => mapper?.InputDevice).filter((input) => typeof input === "string" && input.length > 0);
  const blocked = assigned.filter((input) => /^(keyboard|mouse)$/i.test(input));
  const sources = [...new Set(assigned.filter((input) => !/^(keyboard|mouse)$/i.test(input)))];
  if (blocked.length) return { status: "unsupported-input", detail: `配置包含 ${blocked.length} 项 Keyboard/Mouse 输入；本链路只接受 vJoy Device 作为唯一输入来源。`, assigned: assigned.length, sources };
  if (assigned.length < 16) return { status: "incomplete", detail: `仅检测到 ${assigned.length} 项输入映射；完整 vJoy Controller 至少应有 16 项。`, assigned: assigned.length, sources };
  if (sources.length !== 1) return { status: "mixed-input", detail: `检测到 ${sources.length} 个 DirectInput 来源；虚拟模式必须只使用一只 vJoy Device。`, assigned: assigned.length, sources };
  if (sources[0].toLowerCase() !== VJOY_DEVICE_GUID) return { status: "unexpected-input", detail: "配置使用的唯一 DirectInput 来源不是 vJoy Device；为避免把实体手柄直连配置误作可恢复备份，已拒绝保护。", assigned: assigned.length, sources };
  return { status: "protected", detail: `已验证 ${assigned.length} 项 vJoy-only 映射。`, assigned: assigned.length, sources };
}

async function snapshotXoutputConfiguration({ document, required }) {
  let content;
  try { content = document ? `${JSON.stringify(document, null, 2)}\n` : await readFile(XOUTPUT_SETTINGS, "utf8"); }
  catch (error) { if (required) throw new ConfigError("XOUTPUT_SETTINGS_MISSING", "未找到 XOutput settings.json，无法创建备份。", 409); return {}; }
  let parsed;
  try { parsed = document ?? JSON.parse(content); }
  catch { if (required) throw new ConfigError("XOUTPUT_SETTINGS_INVALID", "XOutput settings.json 不是有效 JSON，无法创建备份。", 409); return {}; }
  const assessment = assessXoutputConfiguration(parsed);
  if (assessment.status !== "protected") {
    if (required) throw new ConfigError("XOUTPUT_SETTINGS_UNSAFE", `拒绝备份：${assessment.detail}`, 409);
    return { assessment };
  }
  await mkdir(XOUTPUT_BACKUP_DIR, { recursive: true });
  const hash = createHash("sha256").update(content).digest("hex");
  const backups = await listXoutputBackups();
  const existing = backups.find((backup) => backup.hash === hash);
  if (existing) return { assessment, backup: existing };
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${hash.slice(0, 12)}`;
  const fileName = `${id}.json`;
  await writeFile(path.join(XOUTPUT_BACKUP_DIR, fileName), content, "utf8");
  const backup = { id, fileName, hash, createdAt: new Date().toISOString(), bytes: Buffer.byteLength(content) };
  return { assessment, backup };
}

async function listXoutputBackups() {
  try {
    const entries = await readdir(XOUTPUT_BACKUP_DIR, { withFileTypes: true });
    const backups = await Promise.all(entries.filter((entry) => entry.isFile() && /^[0-9TZ-]+-[a-f0-9]{12}\.json$/i.test(entry.name)).map(async (entry) => {
      const filePath = path.join(XOUTPUT_BACKUP_DIR, entry.name);
      const [content, metadata] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
      return { id: entry.name.slice(0, -5), fileName: entry.name, hash: createHash("sha256").update(content).digest("hex"), createdAt: metadata.birthtime.toISOString(), bytes: metadata.size };
    }));
    return backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

async function restoreXoutputConfiguration(backupId) {
  if (typeof backupId !== "string" || !/^[0-9TZ-]+-[a-f0-9]{12}$/i.test(backupId)) throw new ConfigError("XOUTPUT_BACKUP_INVALID", "备份标识无效。", 400);
  if (await projectXOutputRunning()) throw new ConfigError("XOUTPUT_RUNNING", "请先停止并退出本项目使用的 XOutput，再恢复配置。", 409);
  const backupPath = path.join(XOUTPUT_BACKUP_DIR, `${backupId}.json`);
  let content;
  try { content = await readFile(backupPath, "utf8"); }
  catch (error) { throw new ConfigError("XOUTPUT_BACKUP_NOT_FOUND", "找不到所选 XOutput 配置备份。", error.code === "ENOENT" ? 404 : 409); }
  let candidate;
  try { candidate = JSON.parse(content); }
  catch { throw new ConfigError("XOUTPUT_BACKUP_INVALID", "所选备份不是有效 JSON。", 409); }
  const assessment = assessXoutputConfiguration(candidate);
  if (assessment.status !== "protected") throw new ConfigError("XOUTPUT_BACKUP_UNSAFE", `拒绝恢复：${assessment.detail}`, 409);
  await mkdir(XOUTPUT_BACKUP_DIR, { recursive: true });
  if (existsSync(XOUTPUT_SETTINGS)) {
    const current = await readFile(XOUTPUT_SETTINGS, "utf8");
    const quarantine = path.join(XOUTPUT_BACKUP_DIR, `pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}-${createHash("sha256").update(current).digest("hex").slice(0, 12)}.json`);
    await writeFile(quarantine, current, "utf8");
  }
  const temporary = `${XOUTPUT_SETTINGS}.${process.pid}.restore.tmp`;
  await copyFile(backupPath, temporary);
  try { await rename(temporary, XOUTPUT_SETTINGS); }
  catch (error) { await unlink(temporary).catch(() => {}); throw new ConfigError("XOUTPUT_RESTORE_FAILED", `恢复 XOutput 配置失败：${error.message}`, 409); }
  return { status: "restored", backupId, detail: "已恢复备份；重新启动 XOutput 后生效。" };
}

async function ahkStatus() {
  const status = await readIni(path.join(rootDir, "runtime", "executor-status.ini"));
  const executor = status.executor;
  if (!executor?.updatedAt || Date.now() - Number(executor.updatedAt) > 3000) return { status: "offline", activeRevision: null };
  const state = executor.error ? "degraded" : executor.state === "running" ? "running" : executor.state;
  return {
    status: state,
    activeRevision: Number(executor.activeRevision),
    actionState: executor.actionState,
    inputState: executor.inputState,
    vjoyState: executor.vjoyState,
    xinputUser: Number(executor.xinputUser),
    reloadRequestAt: executor.reloadRequestAt || undefined,
    error: executor.error || undefined,
    diagnostics: {
      lastMacroEvent: executor.lastMacroEvent || "",
      activeActions: executor.activeActions || "none",
      macro: Object.fromEntries(["P1", "P2", "P3", "P4"].map((logical) => [logical, {
        trace: executor[`macro${logical}`] || "idle",
        waitUntil: Number(executor[`macro${logical}WaitUntil`]) || 0,
        ignoredPulses: Number(executor[`macro${logical}IgnoredPulses`]) || 0,
      }])),
    },
  };
}

async function probeXinputSlots() {
  if (xinputProbePromise) return xinputProbePromise;
  xinputProbePromise = performXinputProbe().finally(() => { xinputProbePromise = undefined; });
  return xinputProbePromise;
}

async function performXinputProbe() {
  const ahk = await ahkStatus();
  if (ahk.status !== "running") throw new ConfigError("AHK_OFFLINE", "AHK 执行器未连接，无法检测 XInput 槽位。", 409);
  if (ahk.actionState === "busy") throw new ConfigError("AHK_BUSY", "宏或连发正在执行，暂不能检测 XInput 槽位。", 409);
  const id = crypto.randomUUID();
  const temporary = `${xinputProbeRequestPath}.${process.pid}.${id}.tmp`;
  await writeFile(temporary, `[probe]\r\nid=${id}\r\nrequestedAt=${Date.now()}\r\n`, "utf8");
  try { await rename(temporary, xinputProbeRequestPath); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }

  let result;
  const deadline = Date.now() + 4500;
  while (Date.now() < deadline) {
    const document = await readIni(xinputProbeResultPath);
    if (document.probe?.id === id && ["complete", "error"].includes(document.probe.status)) { result = document.probe; break; }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  if (!result) throw new ConfigError("XINPUT_PROBE_TIMEOUT", "XInput 槽位检测超时，请确认 AHK 正在运行后重试。", 409);

  if (result?.status === "error") throw new ConfigError("XINPUT_PROBE_FAILED", `AHK 槽位检测失败：${result.error || "未知脚本错误"}`, 409);
  const virtualUser = Number(result.virtualUser);
  const hasVirtual = Number.isInteger(virtualUser) && virtualUser >= 0 && virtualUser <= 3;
  const slots = Array.from({ length: 4 }, (_, user) => {
    const connected = result[`slot${user}`] === "connected";
    if (!connected) return { user, connected: false, kind: "disconnected", selectable: false, reason: "未连接" };
    if (hasVirtual && user === virtualUser) return { user, connected: true, kind: "xoutput-virtual", selectable: false, reason: "已确认是 XOutput 虚拟手柄" };
    return { user, connected: true, kind: "physical-candidate", selectable: true, reason: "已连接的实体候选" };
  });
  const candidates = slots.filter((slot) => slot.selectable);
  let selectedUser = (await store.readDeviceSettings()).xinputUser;
  let autoSelected = false;
  if (candidates.length === 1 && selectedUser !== candidates[0].user) {
    await store.saveDeviceSettings({ xinputUser: candidates[0].user });
    selectedUser = candidates[0].user;
    autoSelected = true;
    broadcast("config.changed", await fullStatus());
  }
  lastXinputProbeResult = {
    id,
    slots,
    virtualUser: hasVirtual ? virtualUser : null,
    selectedUser,
    autoSelected,
    ambiguous: candidates.length > 1,
    detail: hasVirtual ? "已通过 vJoy 主动信号确认 XOutput 虚拟槽位。" : "未检测到 XOutput 虚拟槽位。",
  };
  return lastXinputProbeResult;
}

async function detectPhysicalXinput() {
  const candidates = lastXinputProbeResult?.slots?.filter((slot) => slot.selectable).map((slot) => slot.user) ?? [];
  if (candidates.length < 2) throw new ConfigError("XINPUT_ACTIVITY_NOT_NEEDED", "当前没有多个实体候选，无需活动识别。", 409);
  const ahk = await ahkStatus();
  if (ahk.status !== "running" || ahk.actionState === "busy") throw new ConfigError("AHK_NOT_READY", "AHK 当前无法开始实体手柄活动识别。", 409);
  const id = crypto.randomUUID();
  const temporary = `${xinputProbeRequestPath}.${process.pid}.${id}.tmp`;
  await writeFile(temporary, `[probe]\r\nid=${id}\r\nmode=activity\r\ncandidates=${candidates.join(",")}\r\nrequestedAt=${Date.now()}\r\n`, "utf8");
  try { await rename(temporary, xinputProbeRequestPath); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  let result;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const document = await readIni(xinputProbeResultPath);
    if (document.probe?.id === id && ["complete", "error"].includes(document.probe.status)) { result = document.probe; break; }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  if (!result) throw new ConfigError("XINPUT_ACTIVITY_TIMEOUT", "实体手柄活动识别超时。", 409);
  if (result?.status === "error") throw new ConfigError("XINPUT_ACTIVITY_FAILED", `AHK 实体手柄识别失败：${result.error || "未知脚本错误"}`, 409);
  const physicalUser = Number(result.physicalUser);
  if (!candidates.includes(physicalUser)) throw new ConfigError("XINPUT_ACTIVITY_NONE", "8 秒内未检测到明确的实体手柄操作，请重试并大幅移动摇杆或按下 A。", 409);
  await store.saveDeviceSettings({ xinputUser: physicalUser });
  lastXinputProbeResult = { ...lastXinputProbeResult, selectedUser: physicalUser, autoSelected: true, ambiguous: false, activityDetected: true };
  broadcast("config.changed", await fullStatus());
  return lastXinputProbeResult;
}

async function processStatus(name) {
  try {
    const output = await new Promise((resolve) => execFile("tasklist.exe", ["/FI", `IMAGENAME eq ${name}`, "/FO", "CSV", "/NH"], { windowsHide: true, timeout: 3000 }, (_error, stdout) => resolve(stdout)));
    return { status: output.toLowerCase().includes(name.toLowerCase()) ? "running" : "offline" };
  } catch { return { status: "unknown" }; }
}

async function componentStatus(key, imageName) {
  const record = runtimeSession.processes[key];
  if (record) {
    const process = await matchingProcess(record);
    if (process) return { status: "running", ownership: "managed", pid: record.pid, startedAt: record.startedAt };
    if (await processInfo(record.pid)) return { status: "running", ownership: "unmanaged", pid: record.pid };
    return { status: "offline", ownership: "stale-session", pid: record.pid };
  }
  const detected = await processStatus(imageName);
  return { ...detected, ownership: detected.status === "running" ? "unmanaged" : "none" };
}

async function startPreflightExecutor() {
  const result = { ahk: await startComponent("ahk") };
  broadcast("status.changed", await fullStatus());
  return result;
}

async function checkEnvironment() {
  const components = { hidhide: "enabled" };
  let wasCloaked = true;
  try {
    wasCloaked = await hidHideCloakState();
    await setHidHideCloak(true);
    components.ahk = await startComponent("ahk");
    components.xoutput = await startComponent("xoutput");
    if (components.ahk !== "unmanaged-running") {
      runtimeSession.hidHide = { enabledForSession: true };
      await saveRuntimeSession();
    }
    const ahkReady = await waitForAhkReady();
    const report = await runPreflight();
    if (!ahkReady && !report.checks.some((check) => check.name === "AHK executor" && check.status === "fail")) {
      report.checks.push({ name: "AHK executor", status: "fail", detail: "AHK did not report a heartbeat within 6 seconds." });
      report.status = "failed";
    }
    await store.writePreflight(report);
    broadcast("preflight.changed", report);
    broadcast("status.changed", await fullStatus());
    return { components, report };
  } catch (error) {
    if (!wasCloaked && !components.ahk) await setHidHideCloak(false).catch(() => {});
    if (error instanceof ConfigError) throw error;
    throw new ConfigError("RUNTIME_START_FAILED", `Unable to start virtual mode: ${error.message}`, 409);
  }
}

async function startRuntime() {
  if (!["needs-input-test", "ready-for-xoutput", "passed"].includes((await store.readLatestPreflight())?.status)) {
    return { ahk: "blocked-preflight", xoutput: "blocked-preflight" };
  }
  const result = { ahk: await startComponent("ahk"), xoutput: await startComponent("xoutput") };
  broadcast("status.changed", await fullStatus());
  return result;
}

async function stopRuntime() {
  const result = { ahk: await stopAhk(), xoutput: await stopComponent("xoutput") };
  if (["cleanup-pending", "ownership-mismatch"].includes(result.ahk) || result.xoutput === "ownership-mismatch") return { ...result, hidhide: "kept-on-executor-active", service: "running" };
  if (!runtimeSession.hidHide?.enabledForSession) {
    result.hidhide = "unchanged";
    result.service = "stopping";
  } else if (await projectAhkRunning() || await projectXOutputRunning()) {
    result.hidhide = "kept-on-external-component";
    result.service = "stopping";
  } else {
    try {
      await setHidHideCloak(false);
      delete runtimeSession.hidHide;
      await saveRuntimeSession();
      result.hidhide = "disabled";
      result.service = "stopping";
    } catch {
      result.hidhide = "disable-failed";
      result.service = "running";
    }
  }
  broadcast("status.changed", await fullStatus());
  return result;
}

async function startComponent(key) {
  const definition = key === "ahk"
    ? { executable: AHK_EXE, args: [AHK_SCRIPT], image: "AutoHotkey64.exe", commandToken: AHK_SCRIPT }
    : { executable: XOUTPUT_EXE, args: [], image: "XOutput.exe", commandToken: XOUTPUT_EXE };
  const existing = runtimeSession.processes[key];
  if (existing && await matchingProcess(existing)) {
    if (key !== "ahk") return "already-managed";
    const scriptInfo = await stat(AHK_SCRIPT);
    if (scriptInfo.mtimeMs <= new Date(existing.startedAt).getTime()) return "already-managed";
    // A project script update must not leave a managed, older AHK executor
    // alive.  Restart only our recorded process; HidHide and XOutput stay up.
    const stopped = await stopAhk();
    if (stopped !== "stopped-cleanly") return `restart-${stopped}`;
  }
  if (existing) { delete runtimeSession.processes[key]; await saveRuntimeSession(); }
  if ((await processStatus(definition.image)).status === "running") return "unmanaged-running";
  await access(definition.executable);
  const child = spawn(definition.executable, definition.args, { cwd: rootDir, detached: true, windowsHide: true, stdio: "ignore" });
  child.unref();
  runtimeSession.processes[key] = { pid: child.pid, executable: definition.executable, commandToken: definition.commandToken, startedAt: new Date().toISOString() };
  await saveRuntimeSession();
  return "started";
}

async function stopAhk() {
  const record = runtimeSession.processes.ahk;
  if (!record) return "not-running";
  if (!await matchingProcess(record)) return staleOrMismatched("ahk");
  await store.requestExecutorExit();
  if (!await waitForAhkStop(record.pid)) return "cleanup-pending";
  await store.clearExecutorExitRequest();
  return removeStaleComponent("ahk", "stopped-cleanly");
}

async function stopComponent(key) {
  const record = runtimeSession.processes[key];
  if (!record) return "not-running";
  if (!await matchingProcess(record)) return staleOrMismatched(key);
  await new Promise((resolve) => execFile("taskkill.exe", ["/PID", String(record.pid), "/T"], { windowsHide: true, timeout: 5000 }, () => resolve()));
  return removeStaleComponent(key, "stopped");
}

async function removeStaleComponent(key, result) {
  delete runtimeSession.processes[key];
  await saveRuntimeSession();
  return result;
}

async function staleOrMismatched(key) {
  if (await processInfo(runtimeSession.processes[key].pid)) return "ownership-mismatch";
  return removeStaleComponent(key, "not-running");
}

async function waitForAhkStop(pid) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!await processInfo(pid)) return true;
  }
  return false;
}

async function waitForAhkReady() {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const status = await ahkStatus();
    if (status.status === "running" || status.status === "degraded") return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function recoverRuntimeSession() {
  await mkdir(runtimeDir, { recursive: true });
  let session = await readJson(sessionPath, null);
  if (!session || session.schemaVersion !== 1 || !session.processes || typeof session.processes !== "object") {
    session = { schemaVersion: 1, sessionId: crypto.randomUUID(), createdAt: new Date().toISOString(), processes: {} };
  }
  for (const key of ["ahk", "xoutput"]) {
    const record = session.processes[key];
    if (!record) continue;
    if (!await matchingProcess(record)) delete session.processes[key];
  }
  session.service = { pid: process.pid, executable: process.execPath, startedAt: new Date().toISOString() };
  session.updatedAt = new Date().toISOString();
  await writeJsonAtomic(sessionPath, session);
  return session;
}

async function saveRuntimeSession() {
  runtimeSession.updatedAt = new Date().toISOString();
  await writeJsonAtomic(sessionPath, runtimeSession);
}

async function matchingProcess(record) {
  const process = await processInfo(record.pid);
  if (!process) return false;
  return normalizePath(process.executablePath) === normalizePath(record.executable)
    && normalizePath(process.commandLine).includes(normalizePath(record.commandToken));
}

async function processInfo(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) < 1) return null;
  const command = `Get-CimInstance Win32_Process -Filter 'ProcessId = ${Number(pid)}' | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`;
  try {
    const output = await new Promise((resolve, reject) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 3000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
    if (!String(output).trim()) return null;
    const value = JSON.parse(output);
    return { pid: Number(value.ProcessId), executablePath: value.ExecutablePath ?? "", commandLine: value.CommandLine ?? "" };
  } catch { return null; }
}

async function projectAhkRunning() {
  const command = "Get-CimInstance Win32_Process -Filter 'Name = ''AutoHotkey64.exe''' | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress";
  try {
    const output = await new Promise((resolve, reject) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 3000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
    if (!String(output).trim()) return false;
    const processes = JSON.parse(output);
    return (Array.isArray(processes) ? processes : [processes]).some((process) => normalizePath(process.ExecutablePath) === normalizePath(AHK_EXE) && normalizePath(process.CommandLine).includes(normalizePath(AHK_SCRIPT)));
  } catch { return true; }
}

async function projectXOutputRunning() {
  const command = "Get-CimInstance Win32_Process -Filter 'Name = ''XOutput.exe''' | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress";
  try {
    const output = await new Promise((resolve, reject) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 3000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
    if (!String(output).trim()) return false;
    const processes = JSON.parse(output);
    return (Array.isArray(processes) ? processes : [processes]).some((process) => normalizePath(process.ExecutablePath) === normalizePath(XOUTPUT_EXE));
  } catch { return true; }
}

async function hidHideCloakState() {
  const output = await runHidHide(["--cloak-state"]);
  return output.includes("--cloak-on");
}

async function setHidHideCloak(enabled) {
  await runHidHide([enabled ? "--cloak-on" : "--cloak-off"], { allowSilent: true });
  if ((await hidHideCloakState()) !== enabled) throw new Error(`HidHide cloak did not switch ${enabled ? "on" : "off"}.`);
}

async function runHidHide(args, { allowSilent = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(HIDHIDE_CLI, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let settled = false;
    let outputTimer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(outputTimer);
      if (!child.killed) child.kill();
      if (error) reject(error); else resolve(output);
    };
    const outputReceived = () => {
      clearTimeout(outputTimer);
      // HidHideCLI can emit its allow-list in multiple stdout chunks but does
      // not reliably exit.  Finish only after its output becomes quiet.
      outputTimer = setTimeout(() => finish(), 150);
    };
    child.stdout.on("data", (chunk) => { output += chunk; outputReceived(); });
    child.stderr.on("data", (chunk) => { output += chunk; outputReceived(); });
    child.on("error", finish);
    child.on("close", (code) => { if (!settled) finish(code === 0 ? undefined : new Error(`HidHideCLI exited with code ${code}. ${output.trim()}`)); });
    setTimeout(() => allowSilent ? finish() : finish(new Error(`HidHideCLI did not return status. ${output.trim()}`)), allowSilent ? 250 : 1000).unref();
  });
}

function normalizePath(value) { return String(value ?? "").replaceAll("/", "\\").replaceAll('"', "").toLowerCase(); }

async function readJson(filePath, fallback) {
  try { return JSON.parse(await readFile(filePath, "utf8")); } catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

async function writeJsonAtomic(filePath, value) {
  const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try { await rename(temp, filePath); } catch (error) { await unlink(temp).catch(() => {}); throw error; }
}

function shutdownService() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

async function runPreflight() {
  const checks = await Promise.all([
    fileCheck("AutoHotkey v2 (64-bit)", AHK_EXE),
    fileCheck("vJoy DLL", VJOY_DLL),
    fileCheck("XOutput", XOUTPUT_EXE),
    fileCheck("HidHide CLI", HIDHIDE_CLI),
    fileCheck("AHK 执行器", path.join(rootDir, "gamesir_merge_vjoy_f9_f12.ahk")),
    hidHideCheck(),
    runtimeCheck(),
    ahkPreflightCheck(),
    xoutputPreflightCheck(),
  ]);
  const runtime = await store.status();
  return {
    id: crypto.randomUUID(), checkedAt: new Date().toISOString(), status: checks.some((check) => check.status === "fail") ? "failed" : "needs-input-test", checks,
    inputVerification: Object.fromEntries(Object.entries(runtime.sources).map(([logical, source]) => [logical, { status: "pending", expected: source }])),
    xoutputConfirmation: { status: "required" },
    manual: { status: "required", message: "请依次验证四个背键，然后在 XOutput 中点击 Controller 的 Start，确认其变为 Stop。" },
  };
}

function resolveToolPath(environmentVariable, candidates) {
  const configured = process.env[environmentVariable]?.trim();
  if (configured) return path.resolve(configured);
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

async function ahkPreflightCheck() {
  const status = await ahkStatus();
  const active = await store.status();
  if (status.status !== "running") {
    const detail = status.error === "vjoy-pov-unavailable"
      ? "vJoy Device 1 未启用 POV。打开 vJoyConfig，为 Device 1 启用 1 个 Continuous 或 Discrete POV 后重启。"
      : status.error ? `AHK rejected its configuration: ${status.error}` : "AHK heartbeat is unavailable.";
    return { name: "AHK executor", status: "fail", detail };
  }
  if (status.vjoyState !== "acquired") return { name: "vJoy Device 1", status: "fail", detail: "AHK has not acquired vJoy Device 1." };
  if (status.activeRevision !== active.activeRevision) return { name: "AHK revision", status: "fail", detail: `AHK revision #${status.activeRevision} does not match active revision #${active.activeRevision}.` };
  if (status.inputState !== "connected") return { name: "GameSir XInput slot", status: "fail", detail: `XInput #${status.xinputUser} is disconnected. Select the physical GameSir slot, not a virtual output.` };
  return status.status === "running" ? { name: "AHK 执行器", status: "pass", detail: `运行中，已加载 revision #${status.activeRevision}。` } : { name: "AHK 执行器", status: "manual", detail: "未检测到 AHK 心跳；启动映射后重新检查。" };
}

async function xoutputPreflightCheck() {
  const status = await processStatus("XOutput.exe");
  return status.status === "running" ? { name: "XOutput 进程", status: "pass", detail: "进程运行中，仍需在 XOutput 内确认输出。" } : { name: "XOutput 进程", status: "manual", detail: "未检测到进程；启动后在 XOutput 内确认输出。" };
}

async function fileCheck(name, filePath) {
  try { await access(filePath); return { name, status: "pass", detail: filePath }; } catch { return { name, status: "fail", detail: `未找到：${filePath}` }; }
}

async function runtimeCheck() {
  try { await store.readSources(); return { name: "运行时配置", status: "pass", detail: "配置与背键来源有效。" }; } catch (error) { return { name: "运行时配置", status: "fail", detail: error.message }; }
}

async function commandCheck(name, executable, args, expected) {
  try {
    const { output } = await new Promise((resolve, reject) => execFile(executable, args, { windowsHide: true, timeout: 5000 }, (error, stdout, stderr) => {
      const output = `${stdout}\n${stderr}`;
      if (error && !stdout) reject(error); else resolve({ output });
    }));
    return expected.test(output) ? { name, status: "pass", detail: "状态检查通过。" } : { name, status: "fail", detail: "命令可执行，但状态未满足预期。" };
  } catch { return { name, status: "fail", detail: "无法读取所需服务或驱动状态。" }; }
}

async function hidHideCheck() {
  try {
    // HidHideCLI emits one response per invocation, so query each item
    // separately instead of treating multiple flags as a single command.
    const output = [
      await runHidHide(["--cloak-state"]),
      await runHidHide(["--dev-list"]),
      await runHidHide(["--app-list"]),
    ].join("\n");
    return /--cloak-on[\s\S]*AutoHotkey64/i.test(output)
      ? { name: "HidHide", status: "pass", detail: "Status check passed." }
      : { name: "HidHide", status: "fail", detail: "HidHide is available, but its cloak state or allow-list is incomplete." };
  } catch (error) {
    return { name: "HidHide", status: "fail", detail: `Unable to read HidHide status: ${error.message}` };
  }
}

function serveStatic(pathname, response) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(webDir, relative);
  const relativeToWeb = path.relative(webDir, filePath);
  if (relativeToWeb.startsWith("..") || path.isAbsolute(relativeToWeb) || !existsSync(filePath)) throw new ConfigError("NOT_FOUND", "未找到该资源。", 404);
  const contentType = filePath.endsWith(".html") ? "text/html; charset=utf-8" : filePath.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8";
  response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  createReadStream(filePath).pipe(response);
}

function enforceLocalRequest(request) {
  const origin = request.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${port}`) throw new ConfigError("FORBIDDEN_ORIGIN", "仅允许本机配置页面访问。", 403);
  if (!request.socket.remoteAddress?.includes("127.0.0.1") && request.socket.remoteAddress !== "::1") throw new ConfigError("FORBIDDEN", "仅允许本机访问。", 403);
}

async function body(request) {
  let value = "";
  for await (const chunk of request) { value += chunk; if (value.length > 200000) throw new ConfigError("PAYLOAD_TOO_LARGE", "请求过大。", 413); }
  try { return value ? JSON.parse(value) : {}; } catch { throw new ConfigError("INVALID_JSON", "请求 JSON 无效。"); }
}

async function readIni(filePath) {
  try {
    const bytes = await readFile(filePath);
    const text = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString("utf16le") : bytes.toString("utf8");
    const result = {}; let section;
    for (const line of text.split(/\r?\n/)) {
      const header = line.match(/^\[([^\]]+)]$/);
      if (header) { section = header[1]; result[section] ??= {}; continue; }
      const equals = line.indexOf("=");
      if (section && equals > 0) result[section][line.slice(0, equals)] = line.slice(equals + 1);
    }
    return result;
  } catch (error) { if (error.code === "ENOENT") return {}; throw error; }
}

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(payload));
}

function broadcast(type, data) { for (const socket of sockets) sendWs(socket, type, data); }
function sendWs(socket, type, data) { if (!socket.destroyed) socket.write(wsFrame(JSON.stringify({ type, data }))); }
function wsFrame(text) {
  const payload = Buffer.from(text);
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  if (payload.length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  throw new Error("WebSocket payload too large");
}
function awaitStatus(status) { return { service: { status: "running", address: `127.0.0.1:${port}` }, ...status }; }
function parsePort(value) { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("PORT must be 1-65535"); return parsed; }
