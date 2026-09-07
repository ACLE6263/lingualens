const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = Object.freeze({
  hotkey: 'Alt+Shift+T',
  inputHotkey: 'Shift+Alt+R',
  fullScreenHotkey: 'Shift+Alt+G',
  targetLanguage: 'zh-CN',
  inputPanelTargetLanguage: 'en',
  translationProvider: 'free',
  ocrLanguages: 'eng',
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
  return {
    ...DEFAULT_SETTINGS,
    ...input,
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
      const raw = fs.readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, '');
      return mergeSettings(JSON.parse(raw));
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
    // 所有字段缺省时保留现值、空白时回退默认：支持只改一个字段的部分保存
    // （如主界面切换目标语言），不会意外重置其余设置。
    const hotkey = String(input.hotkey ?? current.hotkey).trim() || DEFAULT_SETTINGS.hotkey;
    const inputHotkey = String(input.inputHotkey ?? current.inputHotkey).trim() || DEFAULT_SETTINGS.inputHotkey;
    const fullScreenHotkey = String(input.fullScreenHotkey ?? current.fullScreenHotkey).trim()
      || DEFAULT_SETTINGS.fullScreenHotkey;
    const apiKey = String(input.openai?.apiKey ?? '').trim();
    const next = mergeSettings({
      ...input,
      hotkey,
      inputHotkey,
      fullScreenHotkey,
      targetLanguage: String(input.targetLanguage ?? current.targetLanguage) || DEFAULT_SETTINGS.targetLanguage,
      inputPanelTargetLanguage: String(input.inputPanelTargetLanguage ?? current.inputPanelTargetLanguage)
        || DEFAULT_SETTINGS.inputPanelTargetLanguage,
      translationProvider: String(input.translationProvider ?? current.translationProvider),
      ocrLanguages: String(input.ocrLanguages ?? current.ocrLanguages),
      liveIntervalMs: Math.max(500, Number(input.liveIntervalMs ?? current.liveIntervalMs)),
      frameChangeThreshold: Math.max(0.005, Math.min(0.25, Number(input.frameChangeThreshold ?? current.frameChangeThreshold))),
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


