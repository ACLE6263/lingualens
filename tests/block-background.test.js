const test = require('node:test');
const assert = require('node:assert/strict');
const { computeBlockBackgrounds } = require('../lib/block-background');

test('flat white background yields flat mode with dark text', () => {
  const w = 200, h = 100;
  const bmp = Buffer.alloc(w * h * 4, 255);
  for (let y = 40; y < 60; y++) for (let x = 60; x < 140; x++) {
    const o = (y * w + x) * 4; bmp[o] = 17; bmp[o+1] = 17; bmp[o+2] = 17; bmp[o+3] = 255;
  }
  const out = computeBlockBackgrounds(bmp, w, h, [{ relative: { x: 0.3, y: 0.4, width: 0.4, height: 0.2 } }]);
  assert.equal(out[0].background.mode, 'flat');
  assert.equal(out[0].background.color, '#ffffff');
  assert.equal(out[0].background.textColor, '#111111');
});

test('noisy background falls back to dark mode', () => {
  const w = 200, h = 100;
  const bmp = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    const value = (i % 2) * 255;
    bmp[o] = value; bmp[o+1] = 255 - value; bmp[o+2] = value; bmp[o+3] = 255;
  }
  const out = computeBlockBackgrounds(bmp, w, h, [{ relative: { x: 0.3, y: 0.4, width: 0.4, height: 0.2 } }]);
  assert.equal(out[0].background.mode, 'dark');
});

test('invalid geometry returns block unchanged', () => {
  const out = computeBlockBackgrounds(Buffer.alloc(16), 2, 2, [{}]);
  assert.equal(out[0].background, undefined);
});
