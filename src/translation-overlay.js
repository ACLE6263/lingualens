const overlayBlocks = document.querySelector('#overlayBlocks');
const overlayFallback = document.querySelector('#overlayFallback');
const liveBadge = document.querySelector('#liveBadge');
const overlayStage = document.querySelector('#overlayStage');

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function hasValidGeometry(block) {
  const relative = block?.relative;
  return relative && [relative.x, relative.y, relative.width, relative.height]
    .every((value) => Number.isFinite(value));
}

function render(payload = {}) {
  const blocks = Array.isArray(payload.blocks) ? payload.blocks.filter(hasValidGeometry) : [];
  liveBadge.hidden = !payload.liveRunning;
  overlayStage.classList.toggle('status', Boolean(payload.status));
  overlayBlocks.replaceChildren();

  if (blocks.length === 0) {
    overlayFallback.hidden = false;
    overlayFallback.textContent = payload.status || payload.text || '暂无译文';
    return;
  }

  overlayFallback.hidden = true;
  for (const block of blocks) {
    const relative = block.relative;
    const left = clamp(relative.x * 100, 0, 99);
    const top = clamp(relative.y * 100, 0, 99);
    const availableWidth = Math.max(1, 100 - left);
    const width = Math.min(availableWidth, Math.max(relative.width * 100, 8));
    const height = Math.max(relative.height * 100, 2);
    const fontSize = clamp(relative.height * window.innerHeight * 0.78, 11, 32);
    const element = document.createElement('div');
    element.className = 'translation-block';
    element.textContent = block.translatedText || block.text;
    element.title = block.translationError || block.text || '';
    element.style.left = `${left}%`;
    element.style.top = `${top}%`;
    element.style.width = `${width}%`;
    element.style.minHeight = `${height}%`;
    element.style.fontSize = `${fontSize}px`;
    overlayBlocks.append(element);
  }
}

document.querySelector('#closeOverlayButton').addEventListener('click', () => {
  window.linguaLens.closeOverlay();
});

// 窗口默认整体鼠标穿透（forward 保留 hover 事件），只有鼠标进入工具栏时
// 恢复交互，离开后重新穿透——底层应用在覆盖层显示期间仍可正常点击。
const overlayToolbar = document.querySelector('.overlay-toolbar');
overlayToolbar.addEventListener('mouseenter', () => {
  window.linguaLens.setOverlayMouseEvents(false);
});
overlayToolbar.addEventListener('mouseleave', () => {
  window.linguaLens.setOverlayMouseEvents(true);
});
window.addEventListener('blur', () => {
  window.linguaLens.setOverlayMouseEvents(true);
});
window.addEventListener('resize', () => {
  for (const element of overlayBlocks.children) {
    const heightPercent = Number.parseFloat(element.style.minHeight);
    element.style.fontSize = `${clamp((heightPercent / 100) * window.innerHeight * 0.78, 11, 32)}px`;
  }
});
window.linguaLens.onOverlayInit(render);
window.linguaLens.onOverlayUpdate(render);