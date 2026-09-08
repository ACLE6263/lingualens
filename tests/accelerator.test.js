const test = require('node:test');
const assert = require('node:assert/strict');

const { isValidAccelerator } = require('../lib/accelerator');

test('isValidAccelerator accepts legal combinations', () => {
  for (const value of [
    'Alt+Shift+T', 'Shift+Alt+R', 'Shift+Alt+G', 'Ctrl+Alt+J',
    'CommandOrControl+K', 'ctrl+shift+KeyQ', 'Alt+F4', 'Ctrl+Digit1',
    'Super+P', 'Alt+Plus', 'Ctrl+Space',
  ]) {
    assert.equal(isValidAccelerator(value), true, `${value} 应为合法`);
  }
});

test('isValidAccelerator rejects illegal input', () => {
  for (const value of [
    'qq', '', ' ', 'Ctrl+', '+J', 'Ctrl++', 'A+B+C', 'Ctrl+A+B',
    'Ctrl A', '你好', 'Ctrl+你', 'Alt+Shift+T+extra', 'CtrlF1',
  ]) {
    assert.equal(isValidAccelerator(value), false, `${JSON.stringify(value)} 应为非法`);
  }
});

test('isValidAccelerator tolerates null/undefined input', () => {
  assert.equal(isValidAccelerator(null), false);
  assert.equal(isValidAccelerator(undefined), false);
});
