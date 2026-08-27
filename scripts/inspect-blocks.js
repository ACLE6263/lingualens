const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { createWorker } = require('tesseract.js');

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 900, height: 300, show: false, webPreferences: { offscreen: true } });
  const html = '<!doctype html><html><body style="margin:20px;background:white;color:black;font:700 42px Arial"><div>Hello screen translation</div><div style="font-size:28px">Second line here</div></body></html>';
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const image = await window.webContents.capturePage();
  const worker = await createWorker('eng', 1, { cachePath: path.join(app.getPath('userData'), 'ocr-cache-smoke') });
  const result = await worker.recognize(image.toPNG(), {}, { text: true, tsv: true });
  console.log(JSON.stringify({ text: result.data.text, tsv: result.data.tsv }, null, 2));
  await worker.terminate();
  window.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });

