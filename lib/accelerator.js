// Electron accelerator（全局快捷键）格式校验。globalShortcut.register 对
// 非法 accelerator 会同步抛异常，必须在校验层提前拒绝。
const ACCELERATOR_MODIFIERS = new Set([
  'command', 'cmd', 'commandorcontrol', 'cmdorctrl', 'control', 'ctrl',
  'alt', 'option', 'altgr', 'shift', 'super', 'meta',
]);
const ACCELERATOR_KEY = /^(Key[A-Z]|Digit\d|[A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Plus|Space|Tab|Capslock|Numlock|Scrolllock|Backspace|Delete|Insert|Return|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|VolumeUp|VolumeDown|VolumeMute|PrintScreen)$/i;

function isValidAccelerator(accelerator) {
  const parts = String(accelerator ?? '').split('+').map((part) => part.trim());
  if (parts.length < 2 || parts.some((part) => !part)) return false;
  const key = parts.pop();
  if (!ACCELERATOR_MODIFIERS.has(key.toLowerCase()) && !ACCELERATOR_KEY.test(key)) return false;
  return parts.every((part) => ACCELERATOR_MODIFIERS.has(part.toLowerCase()));
}

module.exports = { isValidAccelerator };
