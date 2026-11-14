const test = require('node:test');
const assert = require('node:assert/strict');
const { getForegroundCaptureBounds } = require('../lib/capture-bounds');

test('clips a window spanning displays and maps the visible part to negative DIP coordinates', () => {
  const displayBounds = { x: -1280, y: 0, width: 1280, height: 720 };
  const displayPixels = { x: -1920, y: 0, width: 1920, height: 1080 };
  const foregroundPixels = { x: -300, y: 150, width: 800, height: 450 };
  assert.deepEqual(getForegroundCaptureBounds(displayBounds, displayPixels, foregroundPixels), {
    x: -200, y: 100, width: 200, height: 300,
  });
});

test('returns no capture when the foreground window is on another display', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.equal(getForegroundCaptureBounds(display, display, {
    x: -600, y: 0, width: 600, height: 800,
  }), null);
});
