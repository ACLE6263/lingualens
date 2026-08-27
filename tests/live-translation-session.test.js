const test = require('node:test');
const assert = require('node:assert/strict');

const { LiveTranslationSession } = require('../lib/live-translation-session');

function createScheduler() {
  return {
    callback: null,
    cleared: false,
    setInterval(callback) {
      this.callback = callback;
      return 7;
    },
    clearInterval(handle) {
      assert.equal(handle, 7);
      this.cleared = true;
    },
  };
}

test('live session skips unchanged frames and processes changed frames', async () => {
  const frames = [
    { signature: Uint8Array.from([0, 0]), imageDataUrl: 'first' },
    { signature: Uint8Array.from([0, 0]), imageDataUrl: 'same' },
    { signature: Uint8Array.from([255, 0]), imageDataUrl: 'changed' },
  ];
  const processed = [];
  const results = [];
  const scheduler = createScheduler();
  const session = new LiveTranslationSession({
    captureFrame: async () => frames.shift(),
    processFrame: async (frame) => {
      processed.push(frame.imageDataUrl);
      return { translatedText: frame.imageDataUrl };
    },
    onResult: (result) => results.push(result.translatedText),
    changeThreshold: 0.1,
    scheduler,
  });

  session.start({ x: 10, y: 20, width: 100, height: 50 });
  assert.equal((await session.refreshOnce()).status, 'updated');
  assert.equal((await session.refreshOnce()).status, 'unchanged');
  assert.equal((await session.refreshOnce()).status, 'updated');
  assert.deepEqual(processed, ['first', 'changed']);
  assert.deepEqual(results, ['first', 'changed']);
});

test('stopped live session does not capture frames', async () => {
  let captures = 0;
  const scheduler = createScheduler();
  const session = new LiveTranslationSession({
    captureFrame: async () => { captures += 1; },
    processFrame: async () => ({}),
    scheduler,
  });

  session.start({ x: 0, y: 0, width: 1, height: 1 });
  session.stop();
  assert.equal((await session.refreshOnce()).status, 'idle');
  assert.equal(captures, 0);
  assert.equal(scheduler.cleared, true);
});
test('live session can skip the unchanged initial frame', async () => {
  let processed = 0;
  const session = new LiveTranslationSession({
    captureFrame: async () => ({ signature: Uint8Array.from([4, 8]), imageDataUrl: 'same' }),
    processFrame: async () => { processed += 1; },
    scheduler: createScheduler(),
  });

  session.start(
    { x: 0, y: 0, width: 100, height: 50 },
    { initialSignature: Uint8Array.from([4, 8]) },
  );

  assert.equal((await session.refreshOnce()).status, 'unchanged');
  assert.equal(processed, 0);
});

test('stopping a live session discards an in-flight result', async () => {
  let finishCapture;
  let processed = 0;
  const captureReady = new Promise((resolve) => { finishCapture = resolve; });
  const session = new LiveTranslationSession({
    captureFrame: async () => captureReady,
    processFrame: async () => { processed += 1; },
    scheduler: createScheduler(),
  });

  session.start({ x: 0, y: 0, width: 100, height: 50 });
  const refresh = session.refreshOnce();
  session.stop();
  finishCapture({ signature: Uint8Array.from([255]), imageDataUrl: 'late' });

  assert.equal((await refresh).status, 'cancelled');
  assert.equal(processed, 0);
});
