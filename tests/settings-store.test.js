const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeSettings } = require('../lib/settings-store');

test('mergeSettings preserves nested defaults', () => {
  const settings = mergeSettings({ openai: { model: 'custom-model' } });
  assert.equal(settings.openai.model, 'custom-model');
  assert.equal(settings.openai.baseUrl, 'https://api.openai.com/v1');
  assert.equal(settings.hotkey, 'Alt+Shift+T');
  assert.equal(settings.retranslateHotkey, 'Shift+Alt+V');
});


test('mergeSettings supports four independent custom hotkeys', () => {
  const settings = mergeSettings({
    hotkey: 'Ctrl+Alt+1',
    fullScreenHotkey: 'Ctrl+Alt+2',
    inputHotkey: 'Ctrl+Alt+3',
    retranslateHotkey: 'Ctrl+Alt+4',
  });
  assert.equal(settings.hotkey, 'Ctrl+Alt+1');
  assert.equal(settings.fullScreenHotkey, 'Ctrl+Alt+2');
  assert.equal(settings.inputHotkey, 'Ctrl+Alt+3');
  assert.equal(settings.retranslateHotkey, 'Ctrl+Alt+4');
  assert.equal(settings.inputPanelTargetLanguage, 'en');
});

test('captureProtection 默认关闭（避免触发 NVIDIA ShadowPlay 停录）', () => {
  assert.equal(mergeSettings().captureProtection, false);
  assert.equal(mergeSettings({ captureProtection: true }).captureProtection, true);
});

test('部分保存保留窗口防截屏保护和重译快捷键', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { SettingsStore } = require('../lib/settings-store');
  const fakeSafeStorage = {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.from(''),
    decryptString: () => '',
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingualens-test-'));
  const filePath = path.join(dir, 'settings.json');
  const store = new SettingsStore({ filePath, safeStorage: fakeSafeStorage });
  store.save({
    captureProtection: true,
    retranslateHotkey: 'Ctrl+Alt+V',
    google: { endpoint: 'https://example.test/translate' },
    ollama: { baseUrl: 'http://localhost:12345', model: 'custom-model' },
  });
  const reopened = new SettingsStore({ filePath, safeStorage: fakeSafeStorage });
  assert.equal(reopened.getRuntimeSettings().captureProtection, true);
  assert.equal(reopened.getRuntimeSettings().retranslateHotkey, 'Ctrl+Alt+V');
  reopened.save({ inputPanelTargetLanguage: 'ja', ollama: { model: 'new-model' } });
  assert.equal(reopened.getRuntimeSettings().captureProtection, true);
  assert.equal(reopened.getRuntimeSettings().retranslateHotkey, 'Ctrl+Alt+V');
  assert.equal(reopened.getRuntimeSettings().google.endpoint, 'https://example.test/translate');
  assert.deepEqual(reopened.getRuntimeSettings().ollama, { baseUrl: 'http://localhost:12345', model: 'new-model' });
  fs.rmSync(dir, { recursive: true, force: true });
});
