const { WebSocket } = require('undici');

async function main() {
  const port = Number(process.argv[2] ?? 9224);
  const mode = process.argv[3] ?? 'read';
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const pages = Array.isArray(targets) ? targets : [targets];
  const targetTitle = mode === 'preview' ? '选择翻译区域' : 'LinguaLens';
  const target = pages.find((page) => page.title === targetTitle);
  if (!target) throw new Error(`${targetTitle} CDP target not found.`);
  const expressions = {
    instrument: `window.__captureClicks = 0;
      document.querySelector('#captureButton').addEventListener('click', () => {
        window.__captureClicks += 1;
      });
      window.__captureClicks`,
    read: 'window.__captureClicks',
    invoke: 'window.linguaLens.startCapture()',
    fullscreen: 'window.linguaLens.startFullScreenTranslation()',
    'fullscreen-start': 'void window.linguaLens.startFullScreenTranslation(); true',
    'close-overlay': 'window.linguaLens.closeOverlay(); true',
    click: "document.querySelector('#captureButton').click(); true",
    cancel: 'window.linguaLens.cancelCapture(); true',
    status: "document.querySelector('#statusText')?.textContent",
    preview: `new Promise((resolve) => {
      const image = document.querySelector('#screenImage');
      const report = (error = '') => resolve({
        loaded: image.complete && image.naturalWidth > 0,
        width: image.naturalWidth,
        height: image.naturalHeight,
        format: image.currentSrc.startsWith('data:image/jpeg;base64,') ? 'jpeg' : 'other',
        error,
      });
      if (image.complete) {
        report();
        return;
      }
      const timeout = setTimeout(() => report('preview load timed out'), 2000);
      image.addEventListener('load', () => {
        clearTimeout(timeout);
        report();
      }, { once: true });
      image.addEventListener('error', () => {
        clearTimeout(timeout);
        report('preview failed to load');
      }, { once: true });
    })`,
    listeners: "getEventListeners(document.querySelector('#captureButton')).click?.length ?? 0",
  };
  const expression = expressions[mode];
  if (!expression) throw new Error(`Unknown mode: ${mode}`);

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const result = await new Promise((resolve, reject) => {
    socket.addEventListener('error', reject, { once: true });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id === 1) resolve(message);
    });
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    }, { once: true });
  });
  socket.close();
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});