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
  const elements = [];
  for (const block of blocks) {
    const relative = block.relative;
    const left = clamp(relative.x * 100, 0, 99);
    const top = clamp(relative.y * 100, 0, 99);
    const availableWidth = Math.max(1, 100 - left);
    const width = Math.min(availableWidth, Math.max(relative.width * 100, 8));
    const height = Math.max(relative.height * 100, 2);
    const fontSize = clamp(relative.height * window.innerHeight * 0.78, 10, 36);
    const element = document.createElement('div');
    element.className = 'translation-block';
    element.textContent = block.translatedText || block.text;
    element.title = block.translationError || block.text || '';
    // flat 模式 = 背景可无缝还原（QQ 截图翻译风格）：填背景色、去边框阴影、
    // 用对比文字色；否则保持深色半透明块。
    const background = block.background;
    if (background?.mode === 'flat' && background.color) {
      element.classList.add('flat');
      element.style.background = background.color;
      element.style.color = background.textColor || '#f8faff';
      element.style.textShadow = 'none';
    }
    element.style.left = `${left}%`;
    element.style.top = `${top}%`;
    element.style.width = `${width}%`;
    element.style.minHeight = `${height}%`;
    element.style.fontSize = `${fontSize}px`;
    if (background?.mode === 'flat' && background.color) {
      // 外扩一点覆盖范围，避免原文字形从块的下缘露出来。
      const expand = height * 0.14;
      element.style.top = `${clamp(top - expand * 0.5, 0, 99)}%`;
      element.style.minHeight = `${height + expand}%`;
    }
    overlayBlocks.append(element);
    elements.push({ element, left, top: background?.mode === 'flat' ? top - height * 0.07 : top, width });
  }
  fitBlocks(elements);
  resolveOverlaps(elements);
}

// 译文往往比原文行更长：超出块高度时逐步缩小字号（不小于 10px），
// 尽量让译文保持在原位区域内。
function fitBlocks(entries) {
  for (const { element } of entries) {
    let size = Number.parseFloat(element.style.fontSize);
    for (let attempt = 0; attempt < 8 && element.scrollHeight > element.clientHeight + 2 && size > 10; attempt += 1) {
      size = Math.max(10, Math.floor(size * 0.9));
      element.style.fontSize = `${size}px`;
    }
  }
}

// 仍然溢出的块按自上而下顺序做防重叠重排：与上方已放置的块在水平上
// 重叠时，向下顺移到其下缘之后。牺牲精确对位换取可读性。
function resolveOverlaps(entries) {
  // 从上到下处理：先遇到的块优先保持原位，后面的块向下顺移；
  // 顺移后超出屏幕底部的块改为向上收（保证完整可见，不被裁掉）。
  const sorted = [...entries].sort((a, b) => a.top - b.top);
  const placed = [];
  for (const entry of sorted) {
    const heightPercent = (entry.element.offsetHeight / window.innerHeight) * 100;
    let top = entry.top;
    for (const item of placed) {
      const horizontalOverlap = Math.min(entry.left + entry.width, item.left + item.width)
        - Math.max(entry.left, item.left);
      if (horizontalOverlap > Math.min(entry.width, item.width) * 0.15) {
        top = Math.max(top, item.bottom);
      }
    }
    if (top + heightPercent > 99) {
      top = Math.max(0, 99 - heightPercent);
      for (const item of placed) {
        const horizontalOverlap = Math.min(entry.left + entry.width, item.left + item.width)
          - Math.max(entry.left, item.left);
        if (horizontalOverlap > Math.min(entry.width, item.width) * 0.15) {
          top = Math.max(0, Math.min(top, item.top - heightPercent));
        }
      }
    }
    entry.bottom = top + heightPercent;
    entry.element.style.top = `${clamp(top, 0, 99)}%`;
    placed.push(entry);
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
let lastPayload = null;
window.addEventListener('resize', () => {
  if (lastPayload) render(lastPayload);
});
window.linguaLens.onOverlayInit((payload) => {
  lastPayload = payload;
  render(payload);
});
window.linguaLens.onOverlayUpdate((payload) => {
  lastPayload = payload;
  render(payload);
});