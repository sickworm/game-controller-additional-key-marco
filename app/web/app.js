const INPUTS = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Start", "Back", "LS", "RS", "DPadUp", "DPadDown", "DPadLeft", "DPadRight"];
const KEYS = ["P1", "P2", "P3", "P4"];
let profile; let sources; let activeProfileId; let dirty = false; let pendingAhkRevision = null;
let macroDiagnosticsOpen = false;
const captureWaiters = new Map();
const elements = { profiles: document.querySelector("#profiles"), bindings: document.querySelector("#bindings"), save: document.querySelector("#save"), state: document.querySelector("#save-state"), preflight: document.querySelector("#preflight-result"), macroDiagnostics: document.querySelector("#macro-diagnostics"), macroLastEvent: document.querySelector("#macro-last-event"), macroActiveActions: document.querySelector("#macro-active-actions"), macroTraces: document.querySelector("#macro-traces"), xoutputProtection: document.querySelector("#xoutput-protection"), xoutputProtectionStatus: document.querySelector("#xoutput-protection-status"), xoutputProtectionActions: document.querySelector("#xoutput-protection-actions"), xoutputBackups: document.querySelector("#xoutput-backups") };

await load(); probeXinputSlots(); connect();
document.querySelector("#save").addEventListener("click", save);
document.querySelector("#new-profile").addEventListener("click", createProfile);
document.querySelector("#rename-profile").addEventListener("click", renameProfile);
document.querySelector("#delete-profile").addEventListener("click", deleteProfile);
document.querySelector("#export-profile").addEventListener("click", exportProfile);
document.querySelector("#import-profile").addEventListener("change", importProfile);
document.querySelector("#macro-diagnostics-toggle").addEventListener("click", toggleMacroDiagnostics);
document.querySelector("#probe-xinput").addEventListener("click", probeXinputSlots);
document.querySelector("#detect-physical-xinput").addEventListener("click", detectPhysicalXinput);
elements.profiles.addEventListener("change", async () => { await api(`/api/profiles/${elements.profiles.value}/activate`, { method: "POST" }); await load(); });
document.querySelector("#xinput-user").addEventListener("change", saveDeviceSettings);

async function load() {
  const [status, index, sourceData] = await Promise.all([api("/api/status"), api("/api/profiles"), api("/api/input-sources")]);
  activeProfileId = status.activeProfile.id; sources = sourceData;
  document.querySelector("#xinput-user").value = status.device.xinputUser;
  elements.profiles.replaceChildren(...index.profiles.map((item) => option(item.id, item.name, item.id === activeProfileId)));
  profile = await api(`/api/profiles/${activeProfileId}`);
  updateStatus(status);
  dirty = false;
  render();
}

function render() {
  elements.bindings.replaceChildren();
  const template = document.querySelector("#binding-template");
  for (const key of KEYS) {
    const row = template.content.firstElementChild.cloneNode(true);
    const binding = profile.bindings[key];
    row.dataset.key = key;
    row.querySelector(".back-key strong").textContent = `背键 ${key.slice(1)}`;
    row.querySelector(".back-key span").textContent = `当前 ${sources.sources[key]}`;
    row.querySelector(".source").replaceChildren(...Array.from({ length: 24 }, (_, index) => option(`F${index + 1}`, `F${index + 1}`, sources.sources[key] === `F${index + 1}`)));
    row.querySelector(".input").replaceChildren(...INPUTS.map((input) => option(input, input, binding.input === input)));
    row.querySelector(".mode").value = binding.mode;
    row.querySelector(".initial-delay").value = binding.initialDelayMs ?? 180;
    row.querySelector(".interval").value = binding.intervalMs ?? 65;
    row.querySelector(".repeat-stop").value = binding.stop?.kind ?? "whileHeld";
    row.querySelector(".count").value = binding.stop?.count ?? 3;
    renderMacro(row, binding.mode === "macro" ? binding.steps : []);
    wireRow(row); elements.bindings.append(row);
  }
}

function wireRow(row) {
  const mode = row.querySelector(".mode"); const update = () => {
    const repeating = mode.value === "repeat"; const macro = mode.value === "macro";
    row.querySelector(".repeat-fields").hidden = !repeating;
    row.querySelector(".macro-editor").hidden = !macro;
    row.querySelector(".input").disabled = macro;
    const isCount = row.querySelector(".repeat-stop").value === "count";
    row.querySelector(".count-wrap").hidden = !repeating || !isCount;
  };
  mode.addEventListener("change", update); row.querySelector(".repeat-stop").addEventListener("change", update);
  row.querySelector(".add-press").addEventListener("click", () => addMacroStep(row, "press", {}, true));
  row.querySelector(".add-release").addEventListener("click", () => addMacroStep(row, "release", {}, true));
  row.querySelector(".add-wait").addEventListener("click", () => addMacroStep(row, "wait", {}, true));
  row.querySelector(".capture-source").addEventListener("click", () => captureSource(row));
  update();
  row.querySelectorAll("select,input").forEach((input) => input.addEventListener("input", () => { dirty = true; elements.state.textContent = "有未保存修改"; }));
}

async function save() {
  elements.save.disabled = true; elements.state.textContent = "正在保存...";
  try {
    const nextProfile = structuredClone(profile); const nextSources = structuredClone(sources);
    for (const row of document.querySelectorAll(".binding-row")) {
      const key = row.dataset.key; const mode = row.querySelector(".mode").value;
      nextSources.sources[key] = row.querySelector(".source").value;
      const binding = mode === "macro" ? { mode, steps: readMacro(row) } : { mode, input: row.querySelector(".input").value };
      if (mode === "repeat") binding.initialDelayMs = number(row, ".initial-delay"), binding.intervalMs = number(row, ".interval"), binding.stop = { kind: row.querySelector(".repeat-stop").value, ...(row.querySelector(".repeat-stop").value === "count" ? { count: number(row, ".count") } : {}) };
      nextProfile.bindings[key] = binding;
    }
    const saved = await api("/api/configuration/save", { method: "POST", body: { profileId: profile.profile.id, profile: nextProfile, profileRevision: profile.revision, sources: nextSources, sourcesRevision: sources.revision } });
    profile = saved.profile; sources = saved.sources;
    const status = await api("/api/status");
    pendingAhkRevision = status.activeRevision;
    updateStatus(status);
    await load();
  } catch (error) { elements.state.textContent = error.message; } finally { elements.save.disabled = false; }
}

async function createProfile() { const name = window.prompt("新配置档名称"); if (!name) return; await api("/api/profiles", { method: "POST", body: { name } }); await load(); }
async function renameProfile() { const name = window.prompt("配置档名称", profile.profile.name); if (!name) return; await api(`/api/profiles/${profile.profile.id}`, { method: "PATCH", body: { name } }); await load(); }
async function deleteProfile() { if (!window.confirm(`删除配置档“${profile.profile.name}”？`)) return; try { await api(`/api/profiles/${profile.profile.id}`, { method: "DELETE" }); await load(); } catch (error) { elements.state.textContent = error.message; } }
async function exportProfile() { const exported = await api(`/api/profiles/${profile.profile.id}/export`); const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" })); const anchor = Object.assign(document.createElement("a"), { href: url, download: `${exported.profile.id}.json` }); anchor.click(); URL.revokeObjectURL(url); }
async function importProfile(event) { const [file] = event.target.files; if (!file) return; try { await api("/api/profiles/import", { method: "POST", body: { profile: JSON.parse(await file.text()) } }); await load(); } catch (error) { elements.state.textContent = error.message; } finally { event.target.value = ""; } }
async function saveDeviceSettings(event) { try { await api("/api/device-settings", { method: "PUT", body: { xinputUser: Number(event.target.value) } }); elements.state.textContent = "实体槽位已保存，等待 AHK 安全加载"; } catch (error) { elements.state.textContent = error.message; } }
async function probeXinputSlots() {
  const select = document.querySelector("#xinput-user");
  const button = document.querySelector("#probe-xinput");
  button.disabled = true;
  select.replaceChildren(...Array.from({ length: 4 }, (_, user) => option(String(user), `XInput #${user} — 检测中`, user === Number(select.value))));
  for (const item of select.options) item.disabled = true;
  elements.state.textContent = "正在主动检测 XInput 槽位…";
  try {
    const result = await api("/api/xinput/probe", { method: "POST" });
    renderXinputProbeResult(result);
    elements.state.textContent = result.autoSelected
      ? `已自动选择 XInput #${result.selectedUser}；${result.detail}`
      : result.ambiguous
        ? `${result.detail} 检测到多个实体候选，请选择正在使用的 GameSir。`
        : result.detail;
  } catch (error) {
    select.replaceChildren(...Array.from({ length: 4 }, (_, user) => {
      const item = option(String(user), `XInput #${user} — 无法检测：${error.message}`, user === Number(select.value));
      item.disabled = true;
      return item;
    }));
    elements.state.textContent = error.message;
  } finally { button.disabled = false; }
}
function renderXinputProbeResult(result) {
  const select = document.querySelector("#xinput-user");
  select.replaceChildren(...result.slots.map((slot) => {
    const item = option(String(slot.user), `XInput #${slot.user} — ${slot.reason}`, slot.user === result.selectedUser);
    item.disabled = !slot.selectable;
    item.title = slot.reason;
    return item;
  }));
  select.value = String(result.selectedUser);
  document.querySelector("#detect-physical-xinput").hidden = !result.ambiguous;
}
async function detectPhysicalXinput() {
  const button = document.querySelector("#detect-physical-xinput");
  button.disabled = true;
  elements.state.textContent = "请在 8 秒内大幅移动 GameSir 摇杆或按下 A…";
  try {
    const result = await api("/api/xinput/detect-physical", { method: "POST" });
    renderXinputProbeResult(result);
    elements.state.textContent = `已根据输入活动自动选择 XInput #${result.selectedUser}`;
  } catch (error) { elements.state.textContent = error.message; }
  finally { button.disabled = false; }
}
async function captureSource(row) { const button = row.querySelector(".capture-source"); button.disabled = true; elements.state.textContent = `请在 20 秒内按下背键 ${row.dataset.key.slice(1)}`; try { const capture = await api("/api/input-sources/capture", { method: "POST", body: { logical: row.dataset.key } }); const result = await waitCapture(capture.id); if (result.status !== "success") throw new Error(result.status === "timeout" ? "背键识别超时。" : result.message ?? "背键识别失败。"); sources = result.sources; row.querySelector(".source").value = result.source; row.querySelector(".back-key span").textContent = `当前 ${result.source}`; elements.state.textContent = `已识别并应用 ${result.source}`; } catch (error) { elements.state.textContent = error.message; } finally { button.disabled = false; } }
async function verifyPreflightKey(logical, expectedSource, button) {
  button.disabled = true; button.textContent = "正在等待按键…";
  elements.state.textContent = `正在验证背键 ${logical.slice(1)}：请在 20 秒内按一次实体背键。`;
  try {
    const capture = await api("/api/input-sources/capture", { method: "POST", body: { logical, expectedSource } });
    const result = await waitCapture(capture.id);
    if (result.status !== "success") throw new Error(result.status === "timeout" ? `背键 ${logical.slice(1)} 验证超时：未收到按键。请确认实体手柄槽位已连接后重试。` : result.message ?? "背键验证失败。");
    sources = result.sources;
    const row = document.querySelector(`.binding-row[data-key="${logical}"]`);
    if (row) { row.querySelector(".source").value = result.source; row.querySelector(".back-key span").textContent = `当前 ${result.source}`; }
    showPreflight(result.preflight);
    elements.state.textContent = `验证成功：背键 ${logical.slice(1)} 收到 ${result.source}。`;
  } catch (error) { elements.state.textContent = `验证失败：${error.message}`; }
  finally { button.disabled = false; button.textContent = "重新验证"; }
}
function waitCapture(id) { return new Promise((resolve, reject) => { const fallback = setTimeout(async () => { try { resolve(await api(`/api/input-sources/capture/${id}`)); } catch (error) { reject(error); } finally { captureWaiters.delete(id); } }, 22000); captureWaiters.set(id, { resolve, reject, fallback }); }); }
function showPreflight(report) {
  const checks = report.checks ?? [];
  const slot = checks.find((check) => check.name === "GameSir XInput slot");
  const keys = Object.entries(report.inputVerification ?? {});
  const allKeysVerified = keys.length > 0 && keys.every(([, check]) => check.status === "pass");
  const nodes = [Object.assign(document.createElement("h2"), { textContent: report.status === "passed" ? "设置完成：可使用虚拟 Xbox" : "按以下步骤完成设置" })];
  if (slot?.status === "fail") nodes.push(Object.assign(document.createElement("p"), { className: "blocking", textContent: "阻断：AHK 未连接到实体 GameSir，背键验证不会收到任何按键。请在上方选择实体槽位并保存，然后点击“重新检测槽位”，直到状态显示“实体已连接”。" }));
  const checkTitle = Object.assign(document.createElement("h3"), { textContent: "第 1 步：设备与执行链路" });
  nodes.push(checkTitle, list(checks.map((check) => `${check.name}: ${check.detail}`), checks.map((check) => check.status)));
  const keyTitle = Object.assign(document.createElement("h3"), { textContent: "第 2 步：逐个验证背键" });
  const verificationList = document.createElement("ul");
  for (const [logical, check] of keys) {
    const item = document.createElement("li"); item.className = check.status;
    item.append(document.createTextNode(check.status === "pass" ? `背键 ${logical.slice(1)}：验证成功，收到 ${check.actual}` : `背键 ${logical.slice(1)}：等待 ${check.expected} 输入。`));
    if (check.status !== "pass") {
      const verify = Object.assign(document.createElement("button"), { type: "button", textContent: `验证背键 ${logical.slice(1)}` });
      verify.addEventListener("click", () => verifyPreflightKey(logical, check.expected, verify)); item.append(verify);
    }
    verificationList.append(item);
  }
  nodes.push(keyTitle, verificationList);
  const xoutputTitle = Object.assign(document.createElement("h3"), { textContent: "第 3 步：启动虚拟 Xbox 输出" });
  nodes.push(xoutputTitle);
  if (!allKeysVerified) nodes.push(Object.assign(document.createElement("p"), { className: "manual", textContent: "先完成四个背键验证；完成后这里会显示启动指引。" }));
  else if (report.xoutputConfirmation?.status === "confirmed") nodes.push(Object.assign(document.createElement("p"), { className: "pass", textContent: "已确认 XOutput 虚拟 Xbox 输出。" }));
  else {
    nodes.push(Object.assign(document.createElement("p"), { className: "manual", textContent: "切换到 XOutput 窗口，在 Game Controllers 的 Controller 行点击 Start。只有按钮变为 Stop 才表示虚拟 Xbox 已启动。" }));
    const confirm = Object.assign(document.createElement("button"), { type: "button", textContent: "已变为 Stop，确认输出" });
    confirm.addEventListener("click", async () => { try { const updated = await api(`/api/preflight/${report.id}/confirm-xoutput`, { method: "POST" }); showPreflight(updated); elements.state.textContent = "虚拟 Xbox 输出已确认。"; } catch (error) { elements.state.textContent = error.message; } });
    nodes.push(confirm);
  }
  elements.preflight.hidden = false; elements.preflight.replaceChildren(...nodes);
}
function list(items, classes) { const ul = document.createElement("ul"); items.forEach((item, index) => { const li = document.createElement("li"); li.className = classes[index]; li.textContent = item; ul.append(li); }); return ul; }
function option(value, label, selected) { const item = new Option(label, value); item.selected = selected; return item; }
function number(row, selector) { return Number(row.querySelector(selector).value); }
function renderMacro(row, steps) { const list = row.querySelector(".macro-steps"); list.replaceChildren(); (steps.length ? steps : [{ kind: "press", input: "A" }, { kind: "release", input: "A" }]).forEach((step) => addMacroStep(row, step.kind, step)); }
function addMacroStep(row, kind, step = {}, userAdded = false) { const list = row.querySelector(".macro-steps"); const line = document.createElement("div"); line.className = "macro-step"; line.dataset.kind = kind; const index = document.createElement("span"); const type = document.createElement("strong"); type.textContent = kind === "press" ? "按下" : kind === "release" ? "释放" : "等待"; line.append(index, type); if (kind === "wait") { const input = document.createElement("input"); input.type = "number"; input.min = "0"; input.max = "10000"; input.value = step.durationMs ?? 80; input.className = "macro-wait"; line.append(input, document.createTextNode("ms")); } else { const input = document.createElement("select"); input.className = "macro-input"; input.replaceChildren(...INPUTS.map((item) => option(item, item, (step.input ?? "A") === item))); line.append(input); } const up = Object.assign(document.createElement("button"), { type: "button", textContent: "↑", title: "上移步骤" }); up.addEventListener("click", () => moveMacroStep(row, line, -1)); const down = Object.assign(document.createElement("button"), { type: "button", textContent: "↓", title: "下移步骤" }); down.addEventListener("click", () => moveMacroStep(row, line, 1)); const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "移除"; remove.addEventListener("click", () => { line.remove(); renumberMacro(row); dirty = true; elements.state.textContent = "有未保存修改"; }); line.append(up, down, remove); line.querySelectorAll("select,input").forEach((input) => input.addEventListener("input", () => { dirty = true; elements.state.textContent = "有未保存修改"; })); list.append(line); renumberMacro(row); if (userAdded) { dirty = true; elements.state.textContent = "有未保存修改"; } }
function moveMacroStep(row, line, direction) { const sibling = direction < 0 ? line.previousElementSibling : line.nextElementSibling; if (!sibling) return; if (direction < 0) sibling.before(line); else sibling.after(line); renumberMacro(row); dirty = true; elements.state.textContent = "有未保存修改"; }
function renumberMacro(row) { row.querySelectorAll(".macro-step span").forEach((item, index) => { item.textContent = String(index + 1); }); }
function readMacro(row) { const steps = []; for (const line of row.querySelectorAll(".macro-step")) { const kind = line.dataset.kind; steps.push(kind === "wait" ? { kind, durationMs: Number(line.querySelector(".macro-wait").value) } : { kind, input: line.querySelector(".macro-input").value }); } return steps; }
async function api(path, options = {}) { const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json" }, body: options.body ? JSON.stringify(options.body) : undefined }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "请求失败"); return payload.data; }
function updateStatus(status) {
  const ahk = status.ahk;
  const ahkNode = document.querySelector("#ahk-status");
  const xoutputNode = document.querySelector("#xoutput-status");
  const serviceNode = document.querySelector("#service-status");
  serviceNode.textContent = status.service.status === "running" ? "运行中" : status.service.status;
  serviceNode.className = status.service.status === "running" ? "pass" : "fail";
  if (ahk?.status === "running" && ahk.inputState === "connected") {
    ahkNode.textContent = `${ahk.ownership === "managed" ? "本会话" : "外部"}运行中 #${ahk.activeRevision} · 实体已连接`;
    ahkNode.className = "pass";
  } else if (ahk?.status === "running") {
    ahkNode.textContent = `运行中 #${ahk.activeRevision} · 实体 GameSir 未连接`;
    ahkNode.className = "fail";
  } else {
    ahkNode.textContent = ahk?.status === "degraded" ? `配置错误：${ahk.error}` : "未连接";
    ahkNode.className = "fail";
  }
  xoutputNode.textContent = status.xoutput?.status === "running" ? `${status.xoutput.ownership === "managed" ? "本会话" : "外部"}运行中` : "未运行";
  xoutputNode.className = status.xoutput?.status === "running" ? "pass" : "fail";
  document.querySelector("#revision").textContent = `#${status.activeRevision}`;
  updateMacroDiagnostics(ahk);
  updateXoutputProtection(status.xoutputConfiguration, status.xoutput);
  updatePendingAhkRevision(status);
}

function updateXoutputProtection(configuration, xoutput) {
  const data = configuration ?? { status: "missing", detail: "无法读取 XOutput 配置。", backups: [] };
  const protectedConfig = data.status === "protected";
  elements.xoutputProtection.className = `xoutput-protection ${protectedConfig ? "pass" : "fail"}`;
  elements.xoutputProtectionStatus.textContent = `状态：${protectedConfig ? "已备份的 vJoy-only 配置" : "需要处理"}。${data.detail}`;
  elements.xoutputProtectionActions.replaceChildren();
  const snapshot = Object.assign(document.createElement("button"), { type: "button", textContent: "备份当前配置" });
  snapshot.addEventListener("click", snapshotXoutputConfiguration);
  elements.xoutputProtectionActions.append(snapshot);
  const backups = data.backups ?? [];
  elements.xoutputBackups.replaceChildren(...backups.slice(0, 5).map((backup) => {
    const item = document.createElement("li");
    item.append(document.createTextNode(`已验证备份：${new Date(backup.createdAt).toLocaleString()} · ${backup.bytes} bytes`));
    const restore = Object.assign(document.createElement("button"), { type: "button", textContent: "恢复此备份", disabled: xoutput?.status === "running" });
    restore.title = restore.disabled ? "请先停止并退出 XOutput，再恢复配置。" : "恢复前会保留当前文件的隔离副本。";
    restore.addEventListener("click", () => restoreXoutputConfiguration(backup));
    item.append(restore);
    return item;
  }));
  if (!backups.length) elements.xoutputBackups.append(Object.assign(document.createElement("li"), { textContent: "尚无可恢复备份。请在 XOutput 主窗口点击 Save configuration 后，再点击“备份当前配置”。" }));
}

async function snapshotXoutputConfiguration() {
  try {
    const result = await api("/api/xoutput/configuration/snapshot", { method: "POST" });
    elements.state.textContent = `XOutput 配置已备份：${new Date(result.backup.createdAt).toLocaleString()}。`;
    updateStatus(await api("/api/status"));
  } catch (error) { elements.state.textContent = `无法备份 XOutput 配置：${error.message}`; }
}

async function restoreXoutputConfiguration(backup) {
  if (!window.confirm("恢复将覆盖 XOutput 当前 settings.json；恢复前会保留当前文件的隔离副本。确认 XOutput 已完全退出后继续？")) return;
  try {
    const result = await api("/api/xoutput/configuration/restore", { method: "POST", body: { backupId: backup.id } });
    elements.state.textContent = result.detail;
    updateStatus(await api("/api/status"));
  } catch (error) { elements.state.textContent = `无法恢复 XOutput 配置：${error.message}`; }
}

function updateMacroDiagnostics(ahk) {
  const available = ahk?.status === "running";
  elements.macroDiagnostics.hidden = !available || !macroDiagnosticsOpen;
  const toggle = document.querySelector("#macro-diagnostics-toggle");
  toggle.disabled = !available;
  toggle.textContent = macroDiagnosticsOpen ? "收起宏诊断" : "宏诊断";
  toggle.setAttribute("aria-expanded", String(macroDiagnosticsOpen));
  if (!available) return;
  const diagnostics = ahk.diagnostics ?? {};
  elements.macroLastEvent.textContent = diagnostics.lastMacroEvent ? `最近宏事件：${diagnostics.lastMacroEvent}` : "最近宏事件：尚未执行。";
  elements.macroActiveActions.textContent = `当前由宏保持的虚拟按键：${diagnostics.activeActions ?? "none"}`;
  const now = Date.now();
  elements.macroTraces.replaceChildren(...KEYS.map((logical) => {
    const macro = diagnostics.macro?.[logical] ?? { trace: "idle", waitUntil: 0, ignoredPulses: 0 };
    const remaining = macro.waitUntil > now ? `；等待剩余约 ${macro.waitUntil - now}ms` : "";
    return Object.assign(document.createElement("li"), { textContent: `${logical}：${macro.trace}${remaining}；已忽略后续脉冲 ${macro.ignoredPulses ?? 0}` });
  }));
}

function toggleMacroDiagnostics() {
  macroDiagnosticsOpen = !macroDiagnosticsOpen;
  updateMacroDiagnostics({ status: "running" });
  api("/api/status").then((status) => updateMacroDiagnostics(status.ahk)).catch(() => {});
}

function updatePendingAhkRevision(status) {
  if (pendingAhkRevision === null) return;
  const ahk = status.ahk;
  const currentRevision = Number(ahk?.activeRevision);
  if (ahk?.status === "running" && Number.isFinite(currentRevision) && currentRevision >= pendingAhkRevision) {
    elements.state.textContent = `已保存：AHK 已加载 revision #${currentRevision}。`;
    pendingAhkRevision = null;
    return;
  }
  if (ahk?.status === "degraded") {
    elements.state.textContent = `已保存 revision #${pendingAhkRevision}，但 AHK 加载失败：${ahk.error ?? "未知错误"}`;
    return;
  }
  const reason = ahk?.actionState === "busy" ? "等待当前宏或连发结束" : ahk?.status === "running" ? "等待 AHK 下一次安全点" : "等待 AHK 连接";
  const current = Number.isFinite(currentRevision) ? `当前 #${currentRevision}` : "当前 revision 未知";
  elements.state.textContent = `已保存 revision #${pendingAhkRevision}，${reason}（${current}）。`;
}
function connect() { const connection = document.querySelector("#connection"); const ws = new WebSocket(`ws://${location.host}/ws`); ws.onopen = () => { connection.textContent = "服务已连接"; connection.className = "connection online"; }; ws.onmessage = ({ data }) => { const message = JSON.parse(data); if (message.type === "status.snapshot" || message.type === "status.changed") updateStatus(message.data); if (message.type === "input.captureResult") { const waiter = captureWaiters.get(message.data.id); if (waiter) { clearTimeout(waiter.fallback); captureWaiters.delete(message.data.id); waiter.resolve(message.data); } } if (message.type === "config.changed") { if (dirty) elements.state.textContent = "其他页面已修改配置；请保存或重新加载。"; else load().catch(() => {}); } if (message.type === "preflight.changed") showPreflight(message.data); }; ws.onclose = () => { connection.textContent = "服务未连接"; connection.className = "connection offline"; setTimeout(connect, 2000); }; }
