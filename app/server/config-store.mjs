import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const LOGICAL_BACK_KEYS = ["P1", "P2", "P3", "P4"];
export const DEFAULT_SOURCES = { P1: "F9", P2: "F10", P3: "F11", P4: "F12" };
export const XBOX_INPUTS = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Start", "Back", "LS", "RS", "DPadUp", "DPadDown", "DPadLeft", "DPadRight"];

const DEFAULT_BINDINGS = {
  P1: { mode: "hold", input: "DPadUp" },
  P2: { mode: "hold", input: "DPadDown" },
  P3: { mode: "hold", input: "DPadLeft" },
  P4: { mode: "hold", input: "DPadRight" },
};

export class ConfigError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class ConfigStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.runtimeDir = path.join(rootDir, "runtime");
    this.profilesDir = path.join(this.runtimeDir, "profiles");
    this.indexPath = path.join(this.runtimeDir, "profiles-index.json");
    this.sourcesPath = path.join(this.runtimeDir, "input-sources.json");
    this.activePath = path.join(this.runtimeDir, "active-profile.json");
    this.executorIniPath = path.join(this.runtimeDir, "executor-config.ini");
    this.reloadPath = path.join(this.runtimeDir, "reload-request.json");
    this.exitRequestPath = path.join(this.runtimeDir, "exit-request.json");
    this.captureRequestPath = path.join(this.runtimeDir, "capture-request.ini");
    this.captureResultPath = path.join(this.runtimeDir, "capture-result.ini");
    this.deviceSettingsPath = path.join(this.runtimeDir, "device-settings.json");
    this.transactionPath = path.join(this.runtimeDir, "configuration-transaction.json");
    this.preflightPath = path.join(this.runtimeDir, "preflight-status.json");
    this.uiPreferencesPath = path.join(this.runtimeDir, "ui-preferences.json");
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await mkdir(this.profilesDir, { recursive: true });
    await this.recoverConfigurationTransaction();
    const index = await this.readJson(this.indexPath, null);
    if (index) {
      const createdDeviceSettings = !await this.readJson(this.deviceSettingsPath, null);
      if (createdDeviceSettings) await this.writeJsonAtomic(this.deviceSettingsPath, { schemaVersion: 1, xinputUser: 0 });
      if (createdDeviceSettings || !await this.readJson(this.activePath, null) || !existsSync(this.executorIniPath)) {
        await this.publishActive(await this.getProfile(index.activeProfileId), await this.readSources());
      }
      return;
    }

    const profile = this.defaultProfile();
    const sources = { schemaVersion: 1, revision: 1, sources: DEFAULT_SOURCES };
    await this.writeJsonAtomic(this.profilePath(profile.profile.id), profile);
    await this.writeJsonAtomic(this.indexPath, { schemaVersion: 1, activeProfileId: profile.profile.id, profiles: [profile.profile] });
    await this.writeJsonAtomic(this.sourcesPath, sources);
    await this.writeJsonAtomic(this.deviceSettingsPath, { schemaVersion: 1, xinputUser: 0 });
    await this.publishActive(profile, sources, 1);
  }

  defaultProfile() {
    return {
      schemaVersion: 1,
      revision: 1,
      profile: { id: "default", name: "默认" },
      bindings: structuredClone(DEFAULT_BINDINGS),
    };
  }

  profilePath(id) {
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) throw new ConfigError("INVALID_PROFILE_ID", "配置档 ID 仅允许小写字母、数字和连字符。");
    return path.join(this.profilesDir, `${id}.json`);
  }

  async status() {
    const index = await this.readIndex();
    const active = await this.getProfile(index.activeProfileId);
    const sources = await this.readSources();
    const snapshot = await this.readJson(this.activePath, null);
    return { activeProfile: active.profile, activeRevision: snapshot?.revision ?? active.revision, sources: sources.sources, device: await this.readDeviceSettings() };
  }

  async readUiPreferences() {
    const data = await this.readJson(this.uiPreferencesPath, null);
    if (!data) {
      const defaults = { schemaVersion: 1, openConfigurationCenterOnStartup: true };
      await this.writeJsonAtomic(this.uiPreferencesPath, defaults);
      return defaults;
    }
    if (data.schemaVersion !== 1 || typeof data.openConfigurationCenterOnStartup !== "boolean") {
      throw new ConfigError("INVALID_UI_PREFERENCES", "配置中心启动偏好无效。", 500);
    }
    return data;
  }

  async saveUiPreferences(candidate) {
    return this.withWriteLock(async () => {
      if (typeof candidate?.openConfigurationCenterOnStartup !== "boolean") {
        throw new ConfigError("INVALID_UI_PREFERENCES", "启动偏好必须为 true 或 false。");
      }
      const next = { schemaVersion: 1, openConfigurationCenterOnStartup: candidate.openConfigurationCenterOnStartup };
      await this.writeJsonAtomic(this.uiPreferencesPath, next);
      return next;
    });
  }

  async readDeviceSettings() {
    const data = await this.readJson(this.deviceSettingsPath, null);
    if (!data || !Number.isInteger(data.xinputUser) || data.xinputUser < 0 || data.xinputUser > 3) throw new ConfigError("INVALID_DEVICE_SETTINGS", "XInput 槽位设置无效。", 500);
    return data;
  }

  async saveDeviceSettings(candidate) {
    return this.withWriteLock(async () => {
      const next = { schemaVersion: 1, xinputUser: Number(candidate?.xinputUser) };
      if (!Number.isInteger(next.xinputUser) || next.xinputUser < 0 || next.xinputUser > 3) throw new ConfigError("INVALID_XINPUT_USER", "XInput 槽位必须为 0 至 3。");
      const current = await this.readDeviceSettings();
      try {
        await this.writeJsonAtomic(this.deviceSettingsPath, next);
        const index = await this.readIndex();
        await this.publishActive(await this.getProfile(index.activeProfileId), await this.readSources());
      } catch (error) {
        await this.writeJsonAtomic(this.deviceSettingsPath, current).catch(() => {});
        throw error;
      }
      return next;
    });
  }

  async listProfiles() {
    return this.readIndex();
  }

  async getProfile(id) {
    const data = await this.readJson(this.profilePath(id), null);
    if (!data) throw new ConfigError("PROFILE_NOT_FOUND", "未找到该配置档。", 404);
    validateProfile(data);
    return data;
  }

  async saveProfile(id, candidate, expectedRevision) {
    return this.withWriteLock(() => this.saveProfileUnlocked(id, candidate, expectedRevision));
  }

  async saveProfileUnlocked(id, candidate, expectedRevision) {
    const current = await this.getProfile(id);
    if (Number(expectedRevision) !== current.revision) {
      throw new ConfigError("CONFIG_REVISION_CONFLICT", "配置档已在其他页面修改，请重新加载后再保存。", 409);
    }
    const next = { ...candidate, schemaVersion: 1, revision: current.revision + 1, profile: { ...current.profile, ...candidate.profile, id } };
    validateProfile(next);
    await this.writeJsonAtomic(this.profilePath(id), next);
    const index = await this.readIndex();
    if (index.activeProfileId === id) await this.publishActive(next, await this.readSources());
    return next;
  }

  async createProfile(name) {
    return this.withWriteLock(() => this.createProfileUnlocked(name));
  }

  async createProfileUnlocked(name) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed || trimmed.length > 40) throw new ConfigError("INVALID_PROFILE_NAME", "配置档名称需为 1 至 40 个字符。");
    const index = await this.readIndex();
    const id = this.nextId(index.profiles);
    const profile = { ...this.defaultProfile(), profile: { id, name: trimmed } };
    await this.writeJsonAtomic(this.profilePath(id), profile);
    index.profiles.push(profile.profile);
    await this.writeJsonAtomic(this.indexPath, index);
    return profile;
  }

  async renameProfile(id, name) {
    return this.withWriteLock(async () => {
      const trimmed = String(name ?? "").trim();
      if (!trimmed || trimmed.length > 40) throw new ConfigError("INVALID_PROFILE_NAME", "配置档名称需为 1 至 40 个字符。");
      const current = await this.getProfile(id);
      const next = { ...current, revision: current.revision + 1, profile: { ...current.profile, name: trimmed } };
      await this.writeJsonAtomic(this.profilePath(id), next);
      const index = await this.readIndex();
      index.profiles = index.profiles.map((profile) => profile.id === id ? next.profile : profile);
      await this.writeJsonAtomic(this.indexPath, index);
      if (index.activeProfileId === id) await this.publishActive(next, await this.readSources());
      return next;
    });
  }

  async deleteProfile(id) {
    return this.withWriteLock(async () => {
      const index = await this.readIndex();
      if (index.activeProfileId === id) throw new ConfigError("ACTIVE_PROFILE_DELETE", "不能删除当前配置档。", 409);
      if (index.profiles.length <= 1) throw new ConfigError("LAST_PROFILE_DELETE", "至少保留一个配置档。", 409);
      await this.getProfile(id);
      await unlink(this.profilePath(id));
      index.profiles = index.profiles.filter((profile) => profile.id !== id);
      await this.writeJsonAtomic(this.indexPath, index);
    });
  }

  async importProfile(candidate) {
    return this.withWriteLock(async () => {
      validateProfile(candidate);
      const index = await this.readIndex();
      const id = this.nextId(index.profiles);
      const profile = { ...candidate, schemaVersion: 1, revision: 1, profile: { id, name: candidate.profile.name } };
      await this.writeJsonAtomic(this.profilePath(id), profile);
      index.profiles.push(profile.profile);
      await this.writeJsonAtomic(this.indexPath, index);
      return profile;
    });
  }

  async activateProfile(id) {
    return this.withWriteLock(() => this.activateProfileUnlocked(id));
  }

  async activateProfileUnlocked(id) {
    const profile = await this.getProfile(id);
    const index = await this.readIndex();
    index.activeProfileId = id;
    await this.writeJsonAtomic(this.indexPath, index);
    const snapshot = await this.publishActive(profile, await this.readSources());
    return { profile: profile.profile, revision: snapshot.revision };
  }

  async readSources() {
    const data = await this.readJson(this.sourcesPath, null);
    if (!data) throw new ConfigError("SOURCES_NOT_FOUND", "未找到背键来源配置。", 500);
    validateSources(data);
    return data;
  }

  async saveSources(candidate, expectedRevision) {
    return this.withWriteLock(() => this.saveSourcesUnlocked(candidate, expectedRevision));
  }

  async saveSourcesUnlocked(candidate, expectedRevision) {
    const current = await this.readSources();
    if (Number(expectedRevision) !== current.revision) {
      throw new ConfigError("SOURCES_REVISION_CONFLICT", "背键来源已在其他页面修改，请重新加载后再保存。", 409);
    }
    const next = { schemaVersion: 1, revision: current.revision + 1, sources: candidate?.sources };
    validateSources(next);
    await this.writeJsonAtomic(this.sourcesPath, next);
    const index = await this.readIndex();
    await this.publishActive(await this.getProfile(index.activeProfileId), next);
    return next;
  }

  async saveConfiguration({ profileId, profile, profileRevision, sources, sourcesRevision }) {
    return this.withWriteLock(async () => {
      const currentProfile = await this.getProfile(profileId);
      const currentSources = await this.readSources();
      if (Number(profileRevision) !== currentProfile.revision || Number(sourcesRevision) !== currentSources.revision) {
        throw new ConfigError("CONFIG_REVISION_CONFLICT", "配置已在其他页面修改，请重新加载后再保存。", 409);
      }
      const nextProfile = { ...profile, schemaVersion: 1, revision: currentProfile.revision + 1, profile: { ...currentProfile.profile, ...profile.profile, id: profileId } };
      const nextSources = { schemaVersion: 1, revision: currentSources.revision + 1, sources: sources?.sources };
      validateProfile(nextProfile); validateSources(nextSources);
      const transaction = { schemaVersion: 1, kind: "configuration-save", profileId, profile: nextProfile, sources: nextSources, createdAt: new Date().toISOString() };
      await this.writeJsonAtomic(this.transactionPath, transaction);
      let runtimePublished = false;
      try {
        await this.writeJsonAtomic(this.profilePath(profileId), nextProfile);
        await this.writeJsonAtomic(this.sourcesPath, nextSources);
        const index = await this.readIndex();
        const activeProfile = index.activeProfileId === profileId ? nextProfile : await this.getProfile(index.activeProfileId);
        await this.publishActive(activeProfile, nextSources);
        runtimePublished = true;
        await unlink(this.transactionPath);
      } catch (error) {
        if (!runtimePublished) {
          await this.writeJsonAtomic(this.profilePath(profileId), currentProfile).catch(() => {});
          await this.writeJsonAtomic(this.sourcesPath, currentSources).catch(() => {});
          await unlink(this.transactionPath).catch(() => {});
        }
        throw error;
      }
      return { profile: nextProfile, sources: nextSources };
    });
  }

  async beginCapture(logical, expectedSource = undefined) {
    return this.withWriteLock(async () => {
      if (!LOGICAL_BACK_KEYS.includes(logical)) throw new ConfigError("INVALID_LOGICAL_KEY", "背键标识无效。");
      if (expectedSource !== undefined && !/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(expectedSource)) throw new ConfigError("INVALID_CAPTURE_EXPECTATION", "验证按键必须是 F1-F24。", 422);
      const previous = await readIni(this.captureRequestPath);
      const previousResult = await readIni(this.captureResultPath);
      const active = previous.capture?.id && Number(previous.capture.expiresAt) > Date.now() && previousResult.capture?.id !== previous.capture.id;
      if (active) throw new ConfigError("CAPTURE_IN_PROGRESS", "已有背键识别会话正在进行。", 409);
      const request = { id: randomUUID(), logical, expectedSource, expiresAt: Date.now() + 20000 };
      await this.writeTextAtomic(this.captureRequestPath, `[capture]\r\nid=${request.id}\r\nlogical=${logical}\r\nexpectedSource=${expectedSource ?? ""}\r\nexpiresAt=${request.expiresAt}\r\n`);
      return request;
    });
  }

  async captureStatus(id) {
    return this.withWriteLock(() => this.captureStatusUnlocked(id));
  }

  async captureStatusUnlocked(id) {
    const request = await readIni(this.captureRequestPath);
    if (request.capture?.id !== id) throw new ConfigError("CAPTURE_NOT_FOUND", "未找到该背键识别会话。", 404);
    const result = await readIni(this.captureResultPath);
    if (result.capture?.id === id) {
      const response = { id, logical: request.capture.logical, status: result.capture.status, source: result.capture.source || undefined, message: result.capture.message || undefined };
      if (response.status !== "success") return response;
      if (!/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(response.source ?? "")) throw new ConfigError("INVALID_CAPTURE_RESULT", "识别结果不是允许的 F1-F24 按键。", 422);
      const current = await this.readSources();
      if (current.sources[response.logical] !== response.source) {
        const next = { schemaVersion: 1, revision: current.revision + 1, sources: { ...current.sources, [response.logical]: response.source } };
        validateSources(next);
        await this.writeJsonAtomic(this.sourcesPath, next);
        const index = await this.readIndex();
        await this.publishActive(await this.getProfile(index.activeProfileId), next);
        response.sources = next;
      } else response.sources = current;
      response.preflight = await this.recordInputVerification(response.logical, response.source);
      return response;
    }
    return Date.now() > Number(request.capture.expiresAt) ? { id, logical: request.capture.logical, status: "timeout" } : { id, logical: request.capture.logical, status: "waiting", expiresAt: Number(request.capture.expiresAt) };
  }

  async publishActive(profile, sources, revision = undefined) {
    const existing = await this.readJson(this.activePath, null);
    const snapshot = {
      schemaVersion: 1,
      revision: revision ?? Math.max(existing?.revision ?? 0, profile.revision, sources.revision) + 1,
      profile: profile.profile,
      sources: sources.sources,
      bindings: profile.bindings,
      xinputUser: (await this.readDeviceSettings()).xinputUser,
    };
    await this.writeJsonAtomic(this.activePath, snapshot);
    await this.writeTextAtomic(this.executorIniPath, serializeExecutorIni(snapshot));
    await this.writeJsonAtomic(this.reloadPath, { revision: snapshot.revision, requestedAt: new Date().toISOString() });
    return snapshot;
  }

  async readIndex() {
    const index = await this.readJson(this.indexPath, null);
    if (!index || !Array.isArray(index.profiles)) throw new ConfigError("INDEX_INVALID", "配置档索引无效。", 500);
    return index;
  }

  async readJson(filePath, fallback) {
    try { return JSON.parse(await readFile(filePath, "utf8")); } catch (error) {
      if (error.code === "ENOENT") return fallback;
      throw error;
    }
  }

  async writeJsonAtomic(filePath, value) {
    await this.writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  async writeTextAtomic(filePath, content) {
    const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, content, "utf8");
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try { await rename(temp, filePath); return; } catch (error) {
        lastError = error;
        if (!["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt === 3) break;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    await unlink(temp).catch(() => {});
    throw lastError;
  }

  async writePreflight(report) {
    await this.writeJsonAtomic(this.preflightPath, report);
  }

  async recordInputVerification(logical, source) {
    const report = await this.readJson(this.preflightPath, null);
    if (!report?.id) return null;
    report.inputVerification ??= {};
    report.inputVerification[logical] = { status: "pass", expected: source, actual: source, verifiedAt: new Date().toISOString() };
    refreshPreflightStatus(report);
    await this.writePreflight(report);
    return report;
  }

  async confirmXOutputPreflight(id) {
    return this.withWriteLock(async () => {
      const report = await this.readJson(this.preflightPath, null);
      if (!report || report.id !== id) throw new ConfigError("PREFLIGHT_NOT_FOUND", "未找到该前置验证记录。", 404);
      report.xoutputConfirmation = { status: "confirmed", confirmedAt: new Date().toISOString() };
      refreshPreflightStatus(report);
      await this.writePreflight(report);
      return report;
    });
  }

  async getPreflight(id) {
    const report = await this.readJson(this.preflightPath, null);
    if (!report || report.id !== id) throw new ConfigError("PREFLIGHT_NOT_FOUND", "未找到该前置验证记录。", 404);
    return report;
  }

  async readLatestPreflight() {
    return this.readJson(this.preflightPath, null);
  }

  async requestReload() {
    return this.withWriteLock(async () => {
      const snapshot = await this.readJson(this.activePath, null);
      if (!snapshot?.revision) throw new ConfigError("ACTIVE_SNAPSHOT_MISSING", "当前执行器快照不存在。", 500);
      const request = { revision: snapshot.revision, requestedAt: new Date().toISOString() };
      await this.writeJsonAtomic(this.reloadPath, request);
      return request;
    });
  }

  async requestExecutorExit() {
    return this.withWriteLock(async () => {
      const request = { requestedAt: new Date().toISOString() };
      await this.writeJsonAtomic(this.exitRequestPath, request);
      return request;
    });
  }

  async clearExecutorExitRequest() {
    return this.withWriteLock(async () => unlink(this.exitRequestPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    }));
  }

  async recoverConfigurationTransaction() {
    const transaction = await this.readJson(this.transactionPath, null);
    if (!transaction) return;
    if (transaction.schemaVersion !== 1 || transaction.kind !== "configuration-save" || !transaction.profileId || !transaction.profile || !transaction.sources) {
      throw new ConfigError("TRANSACTION_INVALID", "发现无效的配置保存恢复记录。", 500);
    }
    validateProfile(transaction.profile);
    validateSources(transaction.sources);
    if (transaction.profile.profile.id !== transaction.profileId) throw new ConfigError("TRANSACTION_INVALID", "配置保存恢复记录的档案不匹配。", 500);
    await this.writeJsonAtomic(this.profilePath(transaction.profileId), transaction.profile);
    await this.writeJsonAtomic(this.sourcesPath, transaction.sources);
    const index = await this.readIndex();
    const activeProfile = index.activeProfileId === transaction.profileId ? transaction.profile : await this.getProfile(index.activeProfileId);
    await this.publishActive(activeProfile, transaction.sources);
    await unlink(this.transactionPath);
  }

  async withWriteLock(operation) {
    const previous = this.writeQueue;
    let release;
    this.writeQueue = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  nextId(existing) {
    const prefix = "profile";
    for (let number = 1; ; number += 1) {
      const id = `${prefix}-${number}`;
      if (!existing.some((profile) => profile.id === id)) return id;
    }
  }
}

async function readIni(filePath) {
  try {
    const bytes = await readFile(filePath);
    const text = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString("utf16le") : bytes.toString("utf8");
    const lines = text.split(/\r?\n/);
    const result = {}; let section;
    for (const line of lines) {
      const match = line.match(/^\[([^\]]+)]$/); if (match) { section = match[1]; result[section] ??= {}; continue; }
      const equals = line.indexOf("="); if (section && equals > 0) result[section][line.slice(0, equals)] = line.slice(equals + 1);
    }
    return result;
  } catch (error) { if (error.code === "ENOENT") return {}; throw error; }
}

function serializeExecutorIni(snapshot) {
  const lines = ["[meta]", `revision=${snapshot.revision}`, `xinputUser=${snapshot.xinputUser}`];
  for (const key of LOGICAL_BACK_KEYS) {
    const binding = snapshot.bindings[key];
    lines.push("", `[${key}]`, `source=${snapshot.sources[key]}`, `mode=${binding.mode}`, `input=${binding.input ?? ""}`);
    if (binding.mode === "repeat") lines.push(`initialDelayMs=${binding.initialDelayMs}`, `intervalMs=${binding.intervalMs}`, `stop=${binding.stop.kind}`, `count=${binding.stop.count ?? 0}`);
    if (binding.mode === "macro") {
      lines.push(`macroStepCount=${binding.steps.length}`);
      binding.steps.forEach((step, index) => lines.push(`macroStep${index + 1}=${step.kind}|${step.kind === "wait" ? step.durationMs : step.input}`));
    }
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function validateProfile(profile) {
  if (profile.schemaVersion !== 1 || !profile.profile?.id || !profile.profile?.name) throw new ConfigError("INVALID_PROFILE", "配置档基本信息无效。");
  for (const key of LOGICAL_BACK_KEYS) validateBinding(profile.bindings?.[key], key);
}

function validateBinding(binding, key) {
  if (!binding || !["tap", "hold", "repeat", "macro"].includes(binding.mode)) throw new ConfigError("INVALID_BINDING", `${key} 的动作类型无效。`);
  if (binding.mode === "macro") {
    if (!Array.isArray(binding.steps) || binding.steps.length === 0 || binding.steps.length > 100) throw new ConfigError("INVALID_MACRO", `${key} 的宏步骤数无效。`);
    const held = new Map();
    let totalWait = 0;
    for (const step of binding.steps) {
      if (step.kind === "wait") { totalWait += step.durationMs; if (!Number.isInteger(step.durationMs) || step.durationMs < 0 || step.durationMs > 10000) throw new ConfigError("INVALID_MACRO", "宏等待时间无效。"); continue; }
      if (!["press", "release"].includes(step.kind) || !XBOX_INPUTS.includes(step.input)) throw new ConfigError("INVALID_MACRO", "宏步骤输入无效。");
      const count = held.get(step.input) ?? 0;
      if (step.kind === "release" && count === 0) throw new ConfigError("INVALID_MACRO", "宏不能释放未按下的输入。");
      held.set(step.input, step.kind === "press" ? count + 1 : count - 1);
    }
    if (totalWait > 60000 || [...held.values()].some(Boolean)) throw new ConfigError("INVALID_MACRO", "宏必须在 60 秒内释放全部输入。");
    return;
  }
  if (!XBOX_INPUTS.includes(binding.input)) throw new ConfigError("INVALID_BINDING", `${key} 的 Xbox 输入无效。`);
  if (binding.mode === "repeat") {
    if (!Number.isInteger(binding.initialDelayMs) || !Number.isInteger(binding.intervalMs) || binding.initialDelayMs < 0 || binding.intervalMs < 0 || binding.initialDelayMs > 10000 || binding.intervalMs > 10000) throw new ConfigError("INVALID_REPEAT", "连发延迟或间隔无效。");
    if (!["whileHeld", "count"].includes(binding.stop?.kind)) throw new ConfigError("INVALID_REPEAT", "连发停止条件无效。");
    if (binding.stop.kind === "count" && (!Number.isInteger(binding.stop.count) || binding.stop.count < 1 || binding.stop.count > 100)) throw new ConfigError("INVALID_REPEAT", "连发次数无效。");
  }
}

function validateSources(data) {
  const seen = new Set();
  for (const key of LOGICAL_BACK_KEYS) {
    const source = data.sources?.[key];
    if (!/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(source) || seen.has(source)) throw new ConfigError("INVALID_SOURCES", "背键来源必须是不重复的 F1-F24。");
    seen.add(source);
  }
}

function refreshPreflightStatus(report) {
  if (report.checks?.some((check) => check.status === "fail")) { report.status = "failed"; return; }
  const allInputsVerified = LOGICAL_BACK_KEYS.every((key) => report.inputVerification?.[key]?.status === "pass");
  if (!allInputsVerified) { report.status = "needs-input-test"; return; }
  report.status = report.xoutputConfirmation?.status === "confirmed" ? "passed" : "ready-for-xoutput";
}
