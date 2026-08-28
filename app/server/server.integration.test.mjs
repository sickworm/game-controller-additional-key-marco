import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverPath = path.join(projectRoot, "app", "server", "server.mjs");

test("HTTP and WebSocket server endpoints are loopback-safe", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gamesir-server-"));
  const port = await availablePort();
  await cp(path.join(projectRoot, "app", "web"), path.join(root, "app", "web"), { recursive: true });
  const xoutputDir = path.join(root, "tools", "XOutput");
  const xoutputExe = path.join(xoutputDir, "XOutput.exe");
  const xoutputSettings = path.join(xoutputDir, "settings.json");
  await mkdir(xoutputDir, { recursive: true });
  await writeFile(xoutputExe, "");
  await writeFile(xoutputSettings, JSON.stringify(validXoutputSettings()));
  const child = spawn(process.execPath, [serverPath], { env: { ...process.env, APP_ROOT: root, PORT: String(port), GAMESIR_XOUTPUT_EXE: xoutputExe }, stdio: "ignore", windowsHide: true });
  t.after(async () => { child.kill(); await onceExit(child); await rm(root, { recursive: true, force: true }); });
  await waitForHealth(port);

  const health = await request(port, "/health");
  assert.equal(health.status, 200);
  assert.equal(health.json.data.status, "ok");

  const status = await request(port, "/api/status");
  assert.equal(status.status, 200);
  assert.equal(status.json.data.ahk.status, "offline");
  assert.deepEqual(status.json.data.sources, { P1: "F9", P2: "F10", P3: "F11", P4: "F12" });
  assert.equal(status.json.data.service.ownership, "managed");
  assert.equal(status.json.data.xoutputConfiguration.status, "protected");
  assert.equal(status.json.data.xoutputConfiguration.backups.length, 1);
  const session = JSON.parse(await readFile(path.join(root, "runtime", "runtime-session.json"), "utf8"));
  assert.equal(session.service.pid, child.pid);
  assert.deepEqual(session.processes, {});

  const blockedStart = await request(port, "/api/runtime/start", {}, "POST");
  assert.deepEqual(blockedStart.json.data, { ahk: "blocked-preflight", xoutput: "blocked-preflight" });

  const page = await request(port, "/");
  assert.equal(page.status, 200);
  assert.match(page.text, /GameSir G7 Pro/);
  assert.match(page.text, /id="language-toggle"/);
  assert.match(page.text, /src="\/i18n\.js"/);
  const translations = await request(port, "/i18n.js");
  assert.equal(translations.status, 200);
  assert.match(translations.text, /gamesir-config-language/);
  await writeFile(path.join(root, "runtime", "executor-status.ini"), `[executor]\nstate=running\nupdatedAt=${Date.now()}\nactionState=idle\nactiveRevision=1\nxinputUser=0\ninputState=connected\nvjoyState=acquired\n`);
  const probeResponse = request(port, "/api/xinput/probe", {}, "POST");
  const probeRequest = await waitForFile(path.join(root, "runtime", "xinput-probe-request.ini"));
  const probeId = probeRequest.match(/id=([^\r\n]+)/)?.[1];
  assert.ok(probeId);
  const probeResult = `[probe]\r\nid=${probeId}\r\nstatus=complete\r\nvirtualUser=1\r\nslot0=connected\r\nslot1=connected\r\nslot2=connected\r\nslot3=disconnected\r\n`;
  await writeFile(path.join(root, "runtime", "xinput-probe-result.ini"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(probeResult, "utf16le")]));
  const probed = await probeResponse;
  assert.equal(probed.status, 200);
  assert.equal(probed.json.data.virtualUser, 1);
  assert.equal(probed.json.data.selectedUser, 0);
  assert.equal(probed.json.data.autoSelected, false);
  assert.equal(probed.json.data.ambiguous, true);
  assert.deepEqual(probed.json.data.slots.map((slot) => slot.kind), ["physical-candidate", "xoutput-virtual", "physical-candidate", "disconnected"]);
  const failedProbeResponse = request(port, "/api/xinput/probe", {}, "POST");
  const failedProbeRequest = await waitForFileMatch(path.join(root, "runtime", "xinput-probe-request.ini"), (content) => !content.includes(probeId));
  const failedProbeId = failedProbeRequest.match(/id=([^\r\n]+)/)?.[1];
  assert.ok(failedProbeId);
  await writeFile(path.join(root, "runtime", "xinput-probe-result.ini"), `[probe]\r\nid=${failedProbeId}\r\nstatus=error\r\nerror=SetAxis failed\r\n`);
  const failedProbe = await failedProbeResponse;
  assert.equal(failedProbe.status, 409);
  assert.match(failedProbe.json.error.message, /SetAxis failed/);
  const activityResponse = request(port, "/api/xinput/detect-physical", {}, "POST");
  const activityRequest = await waitForFileMatch(path.join(root, "runtime", "xinput-probe-request.ini"), (content) => content.includes("mode=activity"));
  const activityId = activityRequest.match(/id=([^\r\n]+)/)?.[1];
  const activityResult = `[probe]\r\nid=${activityId}\r\nstatus=complete\r\nvirtualUser=-1\r\nphysicalUser=2\r\nslot0=connected\r\nslot1=disconnected\r\nslot2=connected\r\nslot3=disconnected\r\n`;
  await writeFile(path.join(root, "runtime", "xinput-probe-result.ini"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(activityResult, "utf16le")]));
  const detected = await activityResponse;
  assert.equal(detected.status, 200);
  assert.equal(detected.json.data.selectedUser, 2);
  assert.equal(detected.json.data.activityDetected, true);
  assert.equal((await request(port, "/../AGENTS.md")).status, 404);
  assert.equal((await request(port, "/api/status", { Origin: "http://example.test" })).status, 403);

  await writeFile(xoutputSettings, JSON.stringify(legacyKeyboardSettings()));
  const rolledBack = await request(port, "/api/status");
  assert.equal(rolledBack.json.data.xoutputConfiguration.status, "unsupported-input");
  const backupId = status.json.data.xoutputConfiguration.backups[0].id;
  const restored = await request(port, "/api/xoutput/configuration/restore", {}, "POST", { backupId });
  assert.equal(restored.status, 200);
  assert.equal(JSON.parse(await readFile(xoutputSettings, "utf8")).Mapping[0].Mappings.LX.Mappers[0].InputDevice, "398d7d30-98e6-11f1-8002-444553540000");

  const event = await firstWebSocketEvent(port);
  assert.equal(event.type, "status.snapshot");
  assert.equal(event.data.service.address, `127.0.0.1:${port}`);

  const stopped = await request(port, "/api/runtime/stop", {}, "POST");
  assert.equal(stopped.json.data.service, "stopping");
  await onceExit(child);
});

async function availablePort() {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function waitForHealth(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await request(port, "/health")).status === 200) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("isolated server did not start");
}

async function waitForFile(filePath) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { return await readFile(filePath, "utf8"); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`file was not created: ${filePath}`);
}

async function waitForFileMatch(filePath, predicate) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const content = await readFile(filePath, "utf8");
      if (predicate(content)) return content;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`matching file content was not created: ${filePath}`);
}

function request(port, pathname, headers = {}, method = "GET", payload) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: pathname, headers: payload ? { "Content-Type": "application/json", ...headers } : headers, method }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        let json;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: response.statusCode, text, json });
      });
    });
    request.on("error", reject); request.end(payload ? JSON.stringify(payload) : undefined);
  });
}

function validXoutputSettings() {
  const mappings = {};
  for (const input of ["A", "B", "X", "Y", "L1", "R1", "L3", "R3", "Start", "Back", "LX", "LY", "RX", "RY", "L2", "R2", "UP", "DOWN", "LEFT", "RIGHT"]) mappings[input] = { Mappers: [{ InputDevice: "398d7d30-98e6-11f1-8002-444553540000" }] };
  return { Mapping: [{ Mappings: mappings }] };
}

function legacyKeyboardSettings() {
  return { Mapping: [{ Mappings: { UP: { Mappers: [{ InputDevice: "Keyboard" }] } } }] };
}

function firstWebSocketEvent(port) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const timer = setTimeout(() => { socket.close(); reject(new Error("WebSocket snapshot timeout")); }, 2000);
    socket.onmessage = ({ data }) => {
      const event = JSON.parse(data);
      if (event.type !== "status.snapshot") return;
      clearTimeout(timer); socket.close(); resolve(event);
    };
    socket.onerror = () => { clearTimeout(timer); reject(new Error("WebSocket connection failed")); };
  });
}

function onceExit(child) {
  return child.exitCode !== null ? Promise.resolve() : new Promise((resolve) => child.once("exit", resolve));
}
