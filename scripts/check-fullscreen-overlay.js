const { WebSocket } = require('undici');

const port = Number(process.argv[2] ?? 9224);
const deadline = Date.now() + Number(process.argv[3] ?? 10000);

async function getOverlayTarget() {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  return pages.find((page) => page.url.includes('translation-overlay.html'));
}

async function evaluate(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    socket.addEventListener('error', reject, { once: true });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      socket.close();
      resolve(message.result?.result?.value);
    });
    socket.addEventListener('open', () => socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: `({ status: document.querySelector('#overlayStage')?.classList.contains('status') ?? false, fallback: document.querySelector('#overlayFallback')?.textContent ?? '', blocks: document.querySelectorAll('.translation-block').length })`,
        returnByValue: true,
      },
    })), { once: true });
  });
}

(async () => {
  while (Date.now() < deadline) {
    const target = await getOverlayTarget();
    if (target) {
      try {
        const state = await evaluate(target);
        const initialized = state?.status || state?.blocks > 0 || state?.fallback !== '正在加载译文…';
        if (initialized) {
          console.log(JSON.stringify({ target: target.url, state }));
          return;
        }
      } catch {
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Full-screen translation overlay did not initialize.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});