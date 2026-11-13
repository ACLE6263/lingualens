const image = document.querySelector('#screenImage');
const canvas = document.querySelector('#selectionCanvas');
const sizeBadge = document.querySelector('#sizeBadge');
const reuseHint = document.querySelector('#reuseHint');
const context = canvas.getContext('2d');

let displayBounds = null;
let previousSelection = null;
let startPoint = null;
let currentPoint = null;
let dragPointerId = null;
let ready = false;

function reusableSelection() {
  if (!previousSelection) return null;
  const { x, y, width, height } = previousSelection;
  return x + width <= window.innerWidth && y + height <= window.innerHeight ? previousSelection : null;
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  reuseHint.hidden = !reusableSelection();
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
  const selection = normalizedSelection() ?? reusableSelection();
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
  if (!ready || event.button !== 0 || dragPointerId !== null) return;
  dragPointerId = event.pointerId;
  startPoint = pointFromEvent(event);
  currentPoint = startPoint;
  canvas.setPointerCapture(event.pointerId);
  sizeBadge.hidden = false;
  drawSelection();
});

canvas.addEventListener('pointermove', (event) => {
  if (event.pointerId !== dragPointerId) return;
  currentPoint = pointFromEvent(event);
  const selection = normalizedSelection();
  sizeBadge.textContent = `${Math.round(selection.width)} × ${Math.round(selection.height)}`;
  sizeBadge.style.left = `${Math.min(window.innerWidth - 90, currentPoint.x + 12)}px`;
  sizeBadge.style.top = `${Math.min(window.innerHeight - 34, currentPoint.y + 12)}px`;
  drawSelection();
});

function resetDrag() {
  dragPointerId = null;
  startPoint = null;
  currentPoint = null;
  sizeBadge.hidden = true;
}

function submitSelection(selection) {
  ready = false;
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
}

canvas.addEventListener('pointerup', (event) => {
  if (!ready) return;
  if (dragPointerId === null) {
    const selection = reusableSelection();
    if (event.button === 2 && selection) submitSelection(selection);
    return;
  }
  if (event.pointerId !== dragPointerId) return;
  currentPoint = pointFromEvent(event);
  const selection = normalizedSelection();
  resetDrag();
  if (event.button === 0 && selection.width >= 8 && selection.height >= 8) {
    submitSelection(selection);
  } else {
    drawSelection();
  }
});

canvas.addEventListener('lostpointercapture', (event) => {
  if (event.pointerId !== dragPointerId) return;
  resetDrag();
  drawSelection();
});

window.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  ready = false;
  displayBounds = null;
  window.linguaLens.cancelCapture();
});
window.addEventListener('resize', resizeCanvas);
window.linguaLens.onCaptureInit((payload) => {
  ready = false;
  resetDrag();
  displayBounds = payload.displayBounds;
  previousSelection = payload.previousSelection;
  resizeCanvas();
  image.src = payload.screenshot;
  image.decode().then(() => {
    if (displayBounds === payload.displayBounds) ready = true;
  }).catch(() => {});
});
