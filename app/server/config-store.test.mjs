import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConfigError, ConfigStore } from "./config-store.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "gamesir-config-"));
  const store = new ConfigStore(root); await store.init();
  return { root, store };
}

test("combined save updates profile, sources, and executor snapshot together", async (t) => {
  const { root, store } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const profile = await store.getProfile("default"); const sources = await store.readSources();
  profile.bindings.P1 = { mode: "macro", steps: [{ kind: "press", input: "A" }, { kind: "wait", durationMs: 20 }, { kind: "release", input: "A" }] };
  sources.sources.P1 = "F13";
  const saved = await store.saveConfiguration({ profileId: "default", profile, profileRevision: 1, sources, sourcesRevision: 1 });
  assert.equal(saved.profile.revision, 2); assert.equal(saved.sources.revision, 2);
  const ini = await readFile(path.join(root, "runtime", "executor-config.ini"), "utf8");
  assert.match(ini, /source=F13/); assert.match(ini, /macroStep2=wait\|20/);
});

test("combined save rejects stale revisions without changing active state", async (t) => {
  const { root, store } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const profile = await store.getProfile("default"); const sources = await store.readSources();
  await assert.rejects(() => store.saveConfiguration({ profileId: "default", profile, profileRevision: 0, sources, sourcesRevision: 1 }), (error) => error instanceof ConfigError && error.code === "CONFIG_REVISION_CONFLICT");
  assert.equal((await store.getProfile("default")).revision, 1);
});

test("concurrent combined saves serialize so only one writer succeeds", async (t) => {
  const { root, store } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const profile = await store.getProfile("default"); const sources = await store.readSources();
  const first = structuredClone(profile); first.bindings.P1 = { mode: "tap", input: "B" };
  const second = structuredClone(profile); second.bindings.P1 = { mode: "tap", input: "X" };
  const results = await Promise.allSettled([
    store.saveConfiguration({ profileId: "default", profile: first, profileRevision: 1, sources, sourcesRevision: 1 }),
    store.saveConfiguration({ profileId: "default", profile: second, profileRevision: 1, sources, sourcesRevision: 1 }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await store.getProfile("default")).revision, 2);
});

test("startup completes an interrupted combined save from its transaction journal", async (t) => {
  const { root, store } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const profile = await store.getProfile("default"); const sources = await store.readSources();
  const nextProfile = structuredClone(profile); nextProfile.revision = 2; nextProfile.bindings.P2 = { mode: "tap", input: "Y" };
  const nextSources = structuredClone(sources); nextSources.revision = 2; nextSources.sources.P2 = "F13";
  await writeFile(path.join(root, "runtime", "configuration-transaction.json"), JSON.stringify({ schemaVersion: 1, kind: "configuration-save", profileId: "default", profile: nextProfile, sources: nextSources }));
  const recovered = new ConfigStore(root); await recovered.init();
  assert.equal((await recovered.getProfile("default")).bindings.P2.input, "Y");
  assert.equal((await recovered.readSources()).sources.P2, "F13");
  assert.match(await readFile(path.join(root, "runtime", "executor-config.ini"), "utf8"), /source=F13/);
});

test("profile lifecycle supports import, rename, export read, and deleting non-active profiles", async (t) => {
  const { root, store } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const imported = await store.importProfile(await store.getProfile("default"));
  const renamed = await store.renameProfile(imported.profile.id, "Imported");
  assert.equal(renamed.profile.name, "Imported");
  assert.equal((await store.getProfile(imported.profile.id)).profile.name, "Imported");
  await store.deleteProfile(imported.profile.id);
  await assert.rejects(() => store.getProfile(imported.profile.id), (error) => error.code === "PROFILE_NOT_FOUND");
});

test("device setting is validated and emitted in the executor snapshot", async (t) => {
  const { root, store } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await store.saveDeviceSettings({ xinputUser: 2 });
  assert.equal((await store.readDeviceSettings()).xinputUser, 2);
  assert.match(await readFile(path.join(root, "runtime", "executor-config.ini"), "utf8"), /xinputUser=2/);
});

test("UI preferences default to opening the center and persist changes", async (t) => {
  const { root, store } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal((await store.readUiPreferences()).openConfigurationCenterOnStartup, true);
  await store.saveUiPreferences({ openConfigurationCenterOnStartup: false });
  assert.equal((await store.readUiPreferences()).openConfigurationCenterOnStartup, false);
  await assert.rejects(() => store.saveUiPreferences({ openConfigurationCenterOnStartup: "no" }), (error) => error.code === "INVALID_UI_PREFERENCES");
});

test("device setting rolls back when publishing the executor snapshot fails", async (t) => {
  const { root, store } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const publishActive = store.publishActive.bind(store);
  store.publishActive = async () => { throw new Error("publish failed"); };
  await assert.rejects(() => store.saveDeviceSettings({ xinputUser: 2 }), /publish failed/);
  assert.equal((await store.readDeviceSettings()).xinputUser, 0);
  store.publishActive = publishActive;
});

test("executor exit requests are persisted and cleared atomically", async (t) => {
  const { root, store } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const request = await store.requestExecutorExit();
  const exitPath = path.join(root, "runtime", "exit-request.json");
  assert.equal(JSON.parse(await readFile(exitPath, "utf8")).requestedAt, request.requestedAt);
  await store.clearExecutorExitRequest();
  await assert.rejects(() => readFile(exitPath, "utf8"), { code: "ENOENT" });
});

test("capture status reads UTF-16LE result files written by AutoHotkey", async (t) => {
  const { root, store } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await store.writePreflight({ id: "preflight-1", checks: [], inputVerification: { P1: { status: "pending", expected: "F9" } }, xoutputConfirmation: { status: "required" } });
  const capture = await store.beginCapture("P1");
  const result = `[capture]\r\nid=${capture.id}\r\nlogical=P1\r\nstatus=success\r\nsource=F13\r\nmessage=source-captured\r\n`;
  await writeFile(path.join(root, "runtime", "capture-result.ini"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(result, "utf16le")]));
  const status = await store.captureStatus(capture.id);
  assert.equal(status.status, "success"); assert.equal(status.source, "F13"); assert.equal(status.sources.sources.P1, "F13");
  assert.equal(status.preflight.inputVerification.P1.status, "pass");
  assert.equal((await store.readSources()).revision, 2);
});

test("preflight requires explicit XOutput confirmation after input checks", async (t) => {
  const { root, store } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await store.writePreflight({ id: "preflight-2", checks: [], inputVerification: { P1: { status: "pass" }, P2: { status: "pass" }, P3: { status: "pass" }, P4: { status: "pass" } }, xoutputConfirmation: { status: "required" } });
  const report = await store.confirmXOutputPreflight("preflight-2");
  assert.equal(report.status, "passed"); assert.equal(report.xoutputConfirmation.status, "confirmed");
});

test("only one capture request can be active at a time", async (t) => {
  const { root, store } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await store.beginCapture("P1");
  await assert.rejects(() => store.beginCapture("P2"), (error) => error instanceof ConfigError && error.code === "CAPTURE_IN_PROGRESS" && error.status === 409);
});
