const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = Object.freeze({
  captureHotkey: 'Alt+Shift+T',
  screenTranslationHotkey: 'Shift+Alt+G',
  hotkey: 'Alt+Shift+T',
  targetLanguage: 'zh-CN',
  translationProvider: 'free',
  ocrLanguages: 'eng+chi_sim+jpn+kor',
  liveIntervalMs: 1500,
  frameChangeThreshold: 0.025,
  google: { endpoint: 'https://translate.googleapis.com/translate_a/single' },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    apiKeyEncrypted: '',
  },
  ollama: {
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen2.5:3b',
  },
});

function mergeSettings(input = {}) {
  const captureHotkey = String(
    input.captureHotkey ?? input.hotkey ?? DEFAULT_SETTINGS.captureHotkey,
  ).trim();
  const screenTranslationHotkey = String(
    input.screenTranslationHotkey ?? DEFAULT_SETTINGS.screenTranslationHotkey,
  ).trim();

  return {
    ...DEFAULT_SETTINGS,
    ...input,
    captureHotkey,
    screenTranslationHotkey,
    hotkey: captureHotkey,
    google: { ...DEFAULT_SETTINGS.google, ...input.google },
    openai: { ...DEFAULT_SETTINGS.openai, ...input.openai },
    ollama: { ...DEFAULT_SETTINGS.ollama, ...input.ollama },
  };
}

class SettingsStore {
  constructor({ filePath, safeStorage }) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.settings = this.load();
  }

  load() {
    try {
      return mergeSettings(JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
    } catch {
      return mergeSettings();
    }
  }

  write(settings) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, this.filePath);
  }

  encryptSecret(secret) {
    if (!secret) return '';
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('系统安全存储不可用，无法保存 API Key。');
    }
    return this.safeStorage.encryptString(secret).toString('base64');
  }

  decryptSecret(encrypted) {
    if (!encrypted) return '';
    try {
      return this.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      return '';
    }
  }

  save(input = {}) {
    const current = this.settings;
    const apiKey = String(input.openai?.apiKey ?? '').trim();
    const captureHotkey = String(
      input.captureHotkey ?? input.hotkey ?? current.captureHotkey ?? DEFAULT_SETTINGS.captureHotkey,
    ).trim();
    const screenTranslationHotkey = String(
      input.screenTranslationHotkey
        ?? current.screenTranslationHotkey
        ?? DEFAULT_SETTINGS.screenTranslationHotkey,
    ).trim();
    const next = mergeSettings({
      ...input,
      captureHotkey,
      screenTranslationHotkey,
      hotkey: captureHotkey,
      targetLanguage: String(input.targetLanguage ?? DEFAULT_SETTINGS.targetLanguage),
      translationProvider: String(input.translationProvider ?? DEFAULT_SETTINGS.translationProvider),
      ocrLanguages: String(input.ocrLanguages ?? DEFAULT_SETTINGS.ocrLanguages),
      liveIntervalMs: Math.max(500, Number(input.liveIntervalMs ?? DEFAULT_SETTINGS.liveIntervalMs)),
      frameChangeThreshold: Math.max(0.005, Math.min(0.25, Number(input.frameChangeThreshold ?? DEFAULT_SETTINGS.frameChangeThreshold))),
      openai: {
        ...current.openai,
        ...input.openai,
        apiKeyEncrypted: apiKey ? this.encryptSecret(apiKey) : current.openai.apiKeyEncrypted,
      },
    });
    delete next.openai.apiKey;
    delete next.openai.hasApiKey;
    this.write(next);
    this.settings = next;
    return this.getRuntimeSettings();
  }

  getPublicSettings() {
    const publicSettings = {
      ...this.settings,
      openai: {
        ...this.settings.openai,
        hasApiKey: Boolean(this.settings.openai.apiKeyEncrypted),
      },
    };
    delete publicSettings.openai.apiKeyEncrypted;
    return publicSettings;
  }

  getRuntimeSettings() {
    return {
      ...this.settings,
      openai: {
        ...this.settings.openai,
        apiKey: this.decryptSecret(this.settings.openai.apiKeyEncrypted),
      },
    };
  }
}

module.exports = { DEFAULT_SETTINGS, SettingsStore, mergeSettings };


