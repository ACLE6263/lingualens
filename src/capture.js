const image = document.querySelector('#screenImage');
const canvas = document.querySelector('#selectionCanvas');
const sizeBadge = document.querySelector('#sizeBadge');
const context = canvas.getContext('2d');

let displayBounds = null;
let startPoint = null;
let currentPoint = null;
let dragging = false;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  drawSelection();
}

function normalizedSelection() {
  if (!startPoint || !currentPoint) return null;
  return {
    x: Math.min(startPoint.x, currentPoint.x),
    y: Math.min(startPoint.y, currentPoint.y),
    width: Math.abs(currentPoint.x - startPoint.x),
    height: Math.abs(currentPoint.y - startPoint.y),
  };
}

function drawSelection() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(7, 11, 18, 0.48)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const selection = normalizedSelection();
  if (!selection || selection.width < 1 || selection.height < 1) return;

  context.clearRect(selection.x, selection.y, selection.width, selection.height);
  context.strokeStyle = '#7ea1ff';
  context.lineWidth = 2;
  context.strokeRect(selection.x + 1, selection.y + 1, Math.max(0, selection.width - 2), Math.max(0, selection.height - 2));
  context.fillStyle = '#ffffff';
  for (const [x, y] of [
    [selection.x, selection.y],
    [selection.x + selection.width, selection.y],
    [selection.x, selection.y + selection.height],
    [selection.x + selection.width, selection.y + selection.height],
  ]) {
    context.fillRect(x - 3, y - 3, 6, 6);
  }
}

function pointFromEvent(event) {
  return {
    x: Math.max(0, Math.min(window.innerWidth, event.clientX)),
    y: Math.max(0, Math.min(window.innerHeight, event.clientY)),
  };
}

canvas.addEventListener('pointerdown', (event) => {
  dragging = true;
  startPoint = pointFromEvent(event);
  currentPoint = startPoint;
  canvas.setPointerCapture(event.pointerId);
  sizeBadge.hidden = false;
  drawSelection();
});

canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  currentPoint = pointFromEvent(event);
  const selection = normalizedSelection();
  sizeBadge.textContent = `${Math.round(selection.width)} × ${Math.round(selection.height)}`;
  sizeBadge.style.left = `${Math.min(window.innerWidth - 90, currentPoint.x + 12)}px`;
  sizeBadge.style.top = `${Math.min(window.innerHeight - 34, currentPoint.y + 12)}px`;
  drawSelection();
});

canvas.addEventListener('pointerup', (event) => {
  if (!dragging) return;
  dragging = false;
  currentPoint = pointFromEvent(event);
  const selection = normalizedSelection();
  if (selection.width < 8 || selection.height < 8) {
    startPoint = null;
    currentPoint = null;
    sizeBadge.hidden = true;
    drawSelection();
    return;
  }

  const scaleX = image.naturalWidth / window.innerWidth;
  const scaleY = image.naturalHeight / window.innerHeight;
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = Math.max(1, Math.round(selection.width * scaleX));
  cropCanvas.height = Math.max(1, Math.round(selection.height * scaleY));
  cropCanvas.getContext('2d').drawImage(
    image,
    selection.x * scaleX,
    selection.y * scaleY,
    selection.width * scaleX,
    selection.height * scaleY,
    0,
    0,
    cropCanvas.width,
    cropCanvas.height,
  );
  window.linguaLens.finishCapture({
    imageDataUrl: cropCanvas.toDataURL('image/png'),
    bounds: {
      x: displayBounds.x + selection.x,
      y: displayBounds.y + selection.y,
      width: selection.width,
      height: selection.height,
    },
  });
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.linguaLens.cancelCapture();
});
window.addEventListener('resize', resizeCanvas);
window.linguaLens.onCaptureInit((payload) => {
  displayBounds = payload.displayBounds;
  image.addEventListener('load', resizeCanvas, { once: true });
  image.src = payload.screenshot;
});
