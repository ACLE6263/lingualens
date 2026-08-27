const path = require('node:path');

const util = require('node:util');

const { app, BrowserWindow } = require('electron');
const { OcrService } = require('../lib/ocr-service');

function createSafeWriter(stream) {
  let unavailable = false;

  const markUnavailable = (error) => {
    unavailable = true;
    if (error?.code !== 'EPIPE' && error?.code !== 'ERR_STREAM_DESTROYED') {
      process.exitCode = 1;
    }
  };

  stream.on('error', markUnavailable);

  return (...values) => {
    if (unavailable || stream.destroyed || stream.writableEnded) return;
    try {
      stream.write(`${util.format(...values)}\n`, (error) => {
        if (error) markUnavailable(error);
      });
    } catch (error) {
      markUnavailable(error);
    }
  };
}

const safeLog = createSafeWriter(process.stdout);
const safeError = createSafeWriter(process.stderr);

async function run() {
  await app.whenReady();

  let window;
  let service;
  try {
    window = new BrowserWindow({
      width: 900,
      height: 260,
      show: false,
      webPreferences: { offscreen: true },
    });
    const html = `<!doctype html><html><body style="margin:0;background:white;color:black;font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><div style="font-size:54px;font-weight:700">Hello screen translation</div></body></html>`;
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const image = await window.webContents.capturePage();
    service = new OcrService({ cachePath: path.join(app.getPath('userData'), 'ocr-cache-smoke') });
    const result = await service.recognize(image.toDataURL(), 'eng', (progress) => {
      if (progress.value === 1) safeLog(progress.label);
    });
    safeLog(JSON.stringify(result));
  } finally {
    if (service) {
      try {
        await service.terminate();
      } catch (error) {
        safeError(error?.stack ?? error);
        process.exitCode = 1;
      }
    }
    if (window && !window.isDestroyed()) window.destroy();
    app.quit();
  }
}

run().catch((error) => {
  safeError(error?.stack ?? error);
  process.exitCode = 1;
  if (app.isReady()) app.quit();
});
