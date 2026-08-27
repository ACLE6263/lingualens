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
  const first = createFrameSignature(solidBitmap(8, 8, 42), 4);
  const second = createFrameSignature(solidBitmap(8, 8, 42), 4);
  assert.equal(frameDifference(first, second), 0);
  assert.equal(hasMeaningfulFrameChange(first, second, 0.02), false);
});

test('uniform brightness changes are detected', () => {
  const dark = createFrameSignature(solidBitmap(8, 8, 0), 4);
  const light = createFrameSignature(solidBitmap(8, 8, 255), 4);
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
  const first = createFrameSignature(firstBitmap, 4);
  const second = createFrameSignature(secondBitmap, 4);
  assert.equal(frameDifference(first, second), 0.25);
});
