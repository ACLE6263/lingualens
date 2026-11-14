const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createFrameSignature,
  frameDifference,
  hasMeaningfulFrameChange,
} = require('../lib/frame-signature');

function solidBitmap(width, height, value) {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return { data, width, height };
}

test('identical frames have zero difference', () => {
  const first = createFrameSignature(solidBitmap(8, 8, 42));
  const second = createFrameSignature(solidBitmap(8, 8, 42));
  assert.equal(frameDifference(first, second), 0);
  assert.equal(hasMeaningfulFrameChange(first, second, 0.02), false);
});

test('uniform brightness changes are detected', () => {
  const dark = createFrameSignature(solidBitmap(8, 8, 0));
  const light = createFrameSignature(solidBitmap(8, 8, 255));
  assert.equal(frameDifference(dark, light), 1);
  assert.equal(hasMeaningfulFrameChange(dark, light, 0.02), true);
});

test('localized changes produce proportional frame difference', () => {
  const firstBitmap = solidBitmap(8, 8, 0);
  const secondBitmap = solidBitmap(8, 8, 0);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const offset = (y * 8 + x) * 4;
      secondBitmap.data[offset] = 255;
      secondBitmap.data[offset + 1] = 255;
      secondBitmap.data[offset + 2] = 255;
    }
  }
  const first = createFrameSignature(firstBitmap);
  const second = createFrameSignature(secondBitmap);
  assert.equal(frameDifference(first, second), 0.25);
});

test('detects a subtitle-sized update between the old sample rows', () => {
  const before = createFrameSignature(solidBitmap(1920, 1080, 255));
  const after = createFrameSignature(solidBitmap(1920, 1080, 255));
  for (let y = 106; y < 136; y += 1) after.data.fill(0, (y * 1920 + 10) * 4, (y * 1920 + 220) * 4);
  assert.ok(frameDifference(before, after) < 0.025);
  assert.equal(hasMeaningfulFrameChange(before, after), true);
});

test('detects a changed small digit and ignores a thin blinking caret', () => {
  const before = createFrameSignature(solidBitmap(320, 240, 0));
  const caret = createFrameSignature(solidBitmap(320, 240, 0));
  const digit = createFrameSignature(solidBitmap(320, 240, 0));
  for (let y = 5; y < 21; y += 1) {
    caret.data.fill(255, (y * 320 + 8) * 4, (y * 320 + 10) * 4);
    if (y < 9 || y > 16) digit.data.fill(255, (y * 320 + 8) * 4, (y * 320 + 16) * 4);
  }
  assert.equal(hasMeaningfulFrameChange(before, caret), false);
  assert.equal(hasMeaningfulFrameChange(before, digit), true);
});
