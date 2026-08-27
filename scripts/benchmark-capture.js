const { performance } = require('node:perf_hooks');

const { app, desktopCapturer, screen } = require('electron');

const mode = process.argv[2] ?? 'physical';
const iterations = Math.max(1, Number.parseInt(process.argv[3] ?? '2', 10));
const encoding = process.argv[4] ?? 'data-url';

function requestedSize(display) {
  const physicalWidth = Math.max(1, Math.round(display.bounds.width * display.scaleFactor));
  const physicalHeight = Math.max(1, Math.round(display.bounds.height * display.scaleFactor));

  switch (mode) {
    case 'logical':
      return { width: display.bounds.width, height: display.bounds.height };
    case 'half':
      return {
        width: Math.max(1, Math.round(physicalWidth * 0.5)),
        height: Math.max(1, Math.round(physicalHeight * 0.5)),
      };
    case 'quarter':
      return {
        width: Math.max(1, Math.round(physicalWidth * 0.25)),
        height: Math.max(1, Math.round(physicalHeight * 0.25)),
      };
    case 'none':
      return { width: 0, height: 0 };
    case 'physical':
      return { width: physicalWidth, height: physicalHeight };
    default:
      throw new Error(`Unknown capture benchmark mode: ${mode}`);
  }
}

async function benchmark() {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const thumbnailSize = requestedSize(display);
  const results = [];

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const captureStartedAt = performance.now();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize,
    });
    const captureFinishedAt = performance.now();
    const source = sources.find((item) => String(item.display_id) === String(display.id)) ?? sources[0];
    if (!source) throw new Error('No screen capture source was returned.');

    const encodeStartedAt = performance.now();
    let encodedLength = 0;
    if (!source.thumbnail.isEmpty()) {
      if (encoding === 'jpeg') encodedLength = source.thumbnail.toJPEG(82).length;
      else if (encoding === 'png') encodedLength = source.thumbnail.toPNG().length;
      else encodedLength = source.thumbnail.toDataURL().length;
    }
    const encodeFinishedAt = performance.now();

    results.push({
      iteration,
      sourceCount: sources.length,
      thumbnailSize: source.thumbnail.getSize(),
      captureMs: Math.round((captureFinishedAt - captureStartedAt) * 100) / 100,
      encodeMs: Math.round((encodeFinishedAt - encodeStartedAt) * 100) / 100,
      totalMs: Math.round((encodeFinishedAt - captureStartedAt) * 100) / 100,
      encodedLength,
    });
  }

  process.stdout.write(`${JSON.stringify({
    mode,
    encoding,
    requestedThumbnailSize: thumbnailSize,
    display: {
      id: display.id,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor,
    },
    results,
  }, null, 2)}\n`);
}

app.whenReady()
  .then(benchmark)
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    app.exit(1);
  });