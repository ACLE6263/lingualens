const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeSettings } = require('../lib/settings-store');

test('mergeSettings preserves nested defaults', () => {
  const settings = mergeSettings({ openai: { model: 'custom-model' } });
  assert.equal(settings.openai.model, 'custom-model');
  assert.equal(settings.openai.baseUrl, 'https://api.openai.com/v1');
  assert.equal(settings.hotkey, 'Alt+Shift+T');
});


test('mergeSettings supports three independent custom hotkeys', () => {
  const settings = mergeSettings({
    hotkey: 'Ctrl+Alt+1',
    fullScreenHotkey: 'Ctrl+Alt+2',
    inputHotkey: 'Ctrl+Alt+3',
  });
  assert.equal(settings.hotkey, 'Ctrl+Alt+1');
  assert.equal(settings.fullScreenHotkey, 'Ctrl+Alt+2');
  assert.equal(settings.inputHotkey, 'Ctrl+Alt+3');
  assert.equal(settings.inputPanelTargetLanguage, 'en');
});
