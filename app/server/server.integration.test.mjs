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
  assert.equal((await request(port, "/../AGENTS.md")).status, 404);
  assert.equal((await request(port, "/api/status", { Origin: "http://example.test" })).status, 403);

  await writeFile(xoutputSettings, JSON.stringify(legacyKeyboardSettings()));
  const rolledBack = await request(port, "/api/status");
  assert.equal(rolledBack.json.data.xoutputConfiguration.status, "rollback-detected");
  const backupId = status.json.data.xoutputConfiguration.backups[0].id;
  const restored = await request(port, "/api/xoutput/configuration/restore", {}, "POST", { backupId });
  assert.equal(restored.status, 200);
  assert.equal(JSON.parse(await readFile(xoutputSettings, "utf8")).Mapping[0].Mappings.LX.Mappers[0].InputDevice, "vJoy-guid");

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
  for (const input of ["A", "B", "X", "Y", "L1", "R1", "L3", "R3", "Start", "Back", "LX", "LY", "RX", "RY", "L2", "R2", "UP", "DOWN", "LEFT", "RIGHT"]) mappings[input] = { Mappers: [{ InputDevice: "vJoy-guid" }] };
  return { Mapping: [{ Mappings: mappings }] };
}

function legacyKeyboardSettings() {
  return { Mapping: [{ Mappings: { UP: { Mappers: [{ InputDevice: "Keyboard" }] } } }] };
}

function firstWebSocketEvent(port) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const timer = setTimeout(() => { socket.close(); reject(new Error("WebSocket snapshot timeout")); }, 2000);
    socket.onmessage = ({ data }) => { clearTimeout(timer); socket.close(); resolve(JSON.parse(data)); };
    socket.onerror = () => { clearTimeout(timer); reject(new Error("WebSocket connection failed")); };
  });
}

function onceExit(child) {
  return child.exitCode !== null ? Promise.resolve() : new Promise((resolve) => child.once("exit", resolve));
}
