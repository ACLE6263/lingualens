const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeSettings } = require('../lib/settings-store');

test('mergeSettings preserves nested defaults', () => {
  const settings = mergeSettings({ openai: { model: 'custom-model' } });
  assert.equal(settings.openai.model, 'custom-model');
  assert.equal(settings.openai.baseUrl, 'https://api.openai.com/v1');
  assert.equal(settings.hotkey, 'Alt+Shift+T');
});


test('mergeSettings supports independent custom hotkeys and legacy migration', () => {
  const settings = mergeSettings({ hotkey: 'Ctrl+Alt+1', screenTranslationHotkey: 'Ctrl+Alt+2' });
  assert.equal(settings.captureHotkey, 'Ctrl+Alt+1');
  assert.equal(settings.screenTranslationHotkey, 'Ctrl+Alt+2');
  assert.equal(settings.hotkey, 'Ctrl+Alt+1');
});
