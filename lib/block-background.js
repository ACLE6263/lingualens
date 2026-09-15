// QQ 式"无缝覆盖"的关键：与其用深色块盖住原文，不如把文本块的背景恢复成
// 原始背景色，再在上面渲染译文。这里从截图的 BGRA 位图中对每个文本块的
// 边缘环带采样，估计背景主色与复杂度：
//   - 背景平坦（环带亮度方差小）→ mode 'flat'，返回背景色和对比文字色；
//   - 背景复杂（图片、杂色）→ mode 'dark'，渲染层回退深色半透明块。
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function toHex(red, green, blue) {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

// bitmap 是 BGRA 位图。blocks 需带 relative 坐标。返回新的 blocks 数组，
// 每项附加 background: { mode, color, textColor }。
function computeBlockBackgrounds(bitmap, width, height, blocks) {
  if (!bitmap || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return blocks;
  }
  return blocks.map((block) => {
    const relative = block?.relative;
    if (!relative) return block;
    const x0 = Math.max(0, Math.floor(relative.x * width));
    const y0 = Math.max(0, Math.floor(relative.y * height));
    const x1 = Math.min(width - 1, Math.ceil((relative.x + relative.width) * width));
    const y1 = Math.min(height - 1, Math.ceil((relative.y + relative.height) * height));
    if (x1 <= x0 || y1 <= y0) return block;

    const blockHeight = y1 - y0;
    // 采样环带：文本框向外扩 ~12% 高度（至少 3px），环带里的像素大多来自背景。
    const pad = Math.max(3, Math.round(blockHeight * 0.12));
    const sx0 = Math.max(0, x0 - pad);
    const sy0 = Math.max(0, y0 - pad);
    const sx1 = Math.min(width - 1, x1 + pad);
    const sy1 = Math.min(height - 1, y1 + pad);

    const reds = [];
    const greens = [];
    const blues = [];
    const luminances = [];
    const step = Math.max(1, Math.floor(((sx1 - sx0) + (sy1 - sy0)) / 120));
    for (let y = sy0; y <= sy1; y += step) {
      for (let x = sx0; x <= sx1; x += step) {
        const insideText = x >= x0 && x <= x1 && y >= y0 && y <= y1;
        if (insideText) continue;
        const offset = (y * width + x) * 4;
        const blue = bitmap[offset];
        const green = bitmap[offset + 1];
        const red = bitmap[offset + 2];
        reds.push(red);
        greens.push(green);
        blues.push(blue);
        luminances.push(red * 0.299 + green * 0.587 + blue * 0.114);
      }
    }
    if (reds.length < 16) return block;

    const bgRed = median(reds);
    const bgGreen = median(greens);
    const bgBlue = median(blues);
    const mean = luminances.reduce((sum, value) => sum + value, 0) / luminances.length;
    const variance = luminances.reduce((sum, value) => sum + (value - mean) ** 2, 0) / luminances.length;
    const stddev = Math.sqrt(variance);

    // 方差小 → 背景平坦，可以无缝填充；否则回退深色块。
    const mode = stddev < 22 ? 'flat' : 'dark';
    const bgLuminance = bgRed * 0.299 + bgGreen * 0.587 + bgBlue * 0.114;
    return {
      ...block,
      background: {
        mode,
        color: toHex(bgRed, bgGreen, bgBlue),
        textColor: bgLuminance > 140 ? '#111111' : '#f8faff',
      },
    };
  });
}

module.exports = { computeBlockBackgrounds, median };
