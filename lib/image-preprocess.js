// 彩色文字（典型如深色背景上的红色、黄色文字）直接送入 Tesseract 时，
// 灰度转换会抹掉颜色对比度，导致识别不到文字。这里在 OCR 之前做预处理：
// 1. 对"亮度 / RGB 最大通道 / RGB 最小通道"三种灰度方案计算全局 Otsu 类间方差，
//    选出文字与背景分离度最高的一种（例如红字/黑底会选中最大通道）。
//    选中的是"亮度"时说明画面本身没有颜色对比度问题（passthroughOnLuminance
//    时返回 null 交回调用方走原流程）。
// 2. 分块自适应阈值：每个小块独立求 Otsu 阈值，只有文字与背景灰度差足够大、
//    文字占比不过半的块才有效；纯背景块（渐变、平坦区域）由最近的有效块
//    填充，再按像素双线性插值。渐变、明暗不均的背景在单个小块内近似纯色，
//    全局阈值切不开的文字（如渐变底上的红字）在这里能被正确分离。
// 3. mode = 'binary'：按局部阈值硬二值化；mode = 'adaptive-gray'：以局部
//    阈值为中心做软对比度归一化（阈值附近平滑过渡、两侧饱和），保留抗锯齿
//    小字的边缘细节。两者都把极性统一成"深色文字、浅色背景"。
const METRICS = [
  { name: 'luminance', valueAt: (red, green, blue) => Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722) },
  { name: 'max-channel', valueAt: (red, green, blue) => Math.max(red, green, blue) },
  { name: 'min-channel', valueAt: (red, green, blue) => Math.min(red, green, blue) },
];

const TILE_SIZE = 48;
// 块内文字与背景的平均灰度差低于该值时，视为无文字块。
const MIN_TEXT_SEPARATION = 24;
// 文字像素占比超过该值的块被视为"满屏文字块"，其阈值不可靠。
const MAX_TEXT_FRACTION = 0.45;
// adaptive-gray 模式：距局部阈值多少灰度级内做平滑过渡。
const SOFTNESS = 36;

function otsuThreshold(histogram, totalPixels) {
  let totalSum = 0;
  for (let value = 0; value < 256; value += 1) totalSum += value * histogram[value];

  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = 0;
  let bestThresholdLow = 128;
  let bestThresholdHigh = 128;
  let bestMeanBelow = 0;
  let bestMeanAbove = 0;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value];
    if (backgroundWeight === 0) continue;
    const foregroundWeight = totalPixels - backgroundWeight;
    if (foregroundWeight === 0) break;
    backgroundSum += value * histogram[value];
    const meanBelow = backgroundSum / backgroundWeight;
    const meanAbove = (totalSum - backgroundSum) / foregroundWeight;
    const meanDifference = meanBelow - meanAbove;
    const variance = backgroundWeight * foregroundWeight * meanDifference * meanDifference;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestThresholdLow = value;
      bestThresholdHigh = value;
      bestMeanBelow = meanBelow;
      bestMeanAbove = meanAbove;
    } else if (variance > 0 && variance === bestVariance) {
      // 两类之间的空隙里方差不变：记下平台末端，最终取平台中点，
      // 避免阈值贴着某一类的边缘（纯色文字会正好落回阈值上）。
      bestThresholdHigh = value;
    }
  }
  return {
    threshold: Math.round((bestThresholdLow + bestThresholdHigh) / 2),
    variance: bestVariance / (totalPixels * totalPixels),
    meanBelow: bestMeanBelow,
    meanAbove: bestMeanAbove,
  };
}

// 一次遍历构建三种灰度平面与全局直方图。
function buildGrayPlanes(bitmap, pixelCount) {
  const planes = METRICS.map(() => new Uint8Array(pixelCount));
  const histograms = METRICS.map(() => new Uint32Array(256));
  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 4) {
    const blue = bitmap[offset];
    const green = bitmap[offset + 1];
    const red = bitmap[offset + 2];
    for (let index = 0; index < METRICS.length; index += 1) {
      const value = METRICS[index].valueAt(red, green, blue);
      planes[index][pixel] = value;
      histograms[index][value] += 1;
    }
  }
  return { planes, histograms };
}

function selectMetric(histograms, pixelCount) {
  let bestIndex = 0;
  let best = null;
  for (let index = 0; index < METRICS.length; index += 1) {
    const selection = otsuThreshold(histograms[index], pixelCount);
    if (!best || selection.variance > best.variance) {
      best = selection;
      bestIndex = index;
    }
  }
  return { index: bestIndex, global: best };
}

// 分块求 Otsu 阈值；不满足文字判据的块记为无效（NaN）。
function computeTileThresholds(plane, width, height) {
  const tileSize = Math.min(TILE_SIZE, width, height);
  const step = Math.max(4, Math.floor(tileSize / 2));
  const columns = Math.max(1, Math.ceil((width - tileSize) / step) + 1);
  const rows = Math.max(1, Math.ceil((height - tileSize) / step) + 1);
  const thresholds = new Float32Array(columns * rows).fill(Number.NaN);

  const histogram = new Uint32Array(256);
  for (let row = 0; row < rows; row += 1) {
    const startRow = Math.min(row * step, height - tileSize);
    for (let column = 0; column < columns; column += 1) {
      const startColumn = Math.min(column * step, width - tileSize);
      histogram.fill(0);
      for (let y = startRow; y < startRow + tileSize; y += 1) {
        const planeRow = y * width + startColumn;
        for (let x = 0; x < tileSize; x += 1) histogram[plane[planeRow + x]] += 1;
      }
      const tilePixels = tileSize * tileSize;
      const selection = otsuThreshold(histogram, tilePixels);
      let belowWeight = 0;
      for (let value = 0; value <= selection.threshold; value += 1) belowWeight += histogram[value];
      const minorityFraction = Math.min(belowWeight, tilePixels - belowWeight) / tilePixels;
      const separation = Math.abs(selection.meanAbove - selection.meanBelow);
      const hasText = separation >= MIN_TEXT_SEPARATION && minorityFraction <= MAX_TEXT_FRACTION;
      if (selection.variance > 0 && hasText) thresholds[row * columns + column] = selection.threshold;
    }
  }
  return { thresholds, columns, rows, step, tileSize };
}

function tileCenters(count, tileSize, step, extent) {
  const centers = new Array(count);
  for (let index = 0; index < count; index += 1) {
    centers[index] = Math.min(index * step, extent - tileSize) + tileSize / 2;
  }
  return centers;
}

// 无效块（纯背景、无文字）不能直接回退全局阈值——那会让远离文字的背景
// 用全局阈值自我分类，在渐变背景上产生大片误判。这里把每个无效块替换为
// 距离最近的有效块的阈值，让"文字块阈值"平滑传播到整个画面。
function fillInvalidTiles(grid) {
  const { thresholds, columns, rows } = grid;
  const valid = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (!Number.isNaN(thresholds[row * columns + column])) valid.push([column, row]);
    }
  }
  if (valid.length === 0) return false;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (!Number.isNaN(thresholds[row * columns + column])) continue;
      let bestDistance = Infinity;
      let bestThreshold = 0;
      for (const [validColumn, validRow] of valid) {
        const dx = validColumn - column;
        const dy = validRow - row;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          bestThreshold = thresholds[validRow * columns + validColumn];
        }
      }
      thresholds[row * columns + column] = bestThreshold;
    }
  }
  return true;
}

// 预计算每个像素坐标对应的两个网格下标与插值权重，避免热循环里重复计算。
function buildLerpTables(centers, step, extent, count) {
  const index0 = new Uint16Array(extent);
  const index1 = new Uint16Array(extent);
  const weight = new Float32Array(extent);
  for (let position = 0; position < extent; position += 1) {
    const gridPosition = Math.min(Math.max((position + 0.5 - centers[0]) / step, 0), count - 1);
    const base = Math.floor(gridPosition);
    index0[position] = base;
    index1[position] = Math.min(base + 1, count - 1);
    weight[position] = gridPosition - base;
  }
  return { index0, index1, weight };
}

// 输入是 nativeImage.toBitmap() 的 BGRA 像素，返回处理后的 BGRA Buffer。
// 图像接近纯色、未选中颜色通道（passthroughOnLuminance）或数据无效时返回
// null，由调用方回退到原图。
function preprocessBgraBitmap(bitmap, width, height, options = {}) {
  const { mode = 'adaptive-gray', passthroughOnLuminance = false } = options;
  const pixelCount = width * height;
  const requiredLength = pixelCount * 4;
  if (!Number.isFinite(pixelCount) || pixelCount <= 0 || !bitmap || bitmap.length < requiredLength) {
    return null;
  }

  const { planes, histograms } = buildGrayPlanes(bitmap, pixelCount);
  const { index: metricIndex, global: globalSelection } = selectMetric(histograms, pixelCount);
  if (!globalSelection || globalSelection.variance <= 0) return null;
  if (passthroughOnLuminance && metricIndex === 0) return null;

  const plane = planes[metricIndex];
  const output = Buffer.alloc(requiredLength);
  const grid = computeTileThresholds(plane, width, height);
  const hasValidTiles = fillInvalidTiles(grid);
  const columnCenters = tileCenters(grid.columns, grid.tileSize, grid.step, width);
  const rowCenters = tileCenters(grid.rows, grid.tileSize, grid.step, height);
  const columnTable = buildLerpTables(columnCenters, grid.step, width, grid.columns);
  const rowTable = buildLerpTables(rowCenters, grid.step, height, grid.rows);
  const fallbackThreshold = globalSelection.threshold;

  // 第一遍：按局部阈值分类，统计明暗两侧数量，确定背景极性。
  const isBright = new Uint8Array(pixelCount);
  let darkCount = 0;
  for (let y = 0; y < height; y += 1) {
    const row0 = rowTable.index0[y];
    const row1 = rowTable.index1[y];
    const weightY = rowTable.weight[y];
    const rowBase0 = row0 * grid.columns;
    const rowBase1 = row1 * grid.columns;
    for (let x = 0; x < width; x += 1) {
      const column0 = columnTable.index0[x];
      const column1 = columnTable.index1[x];
      const weightX = columnTable.weight[x];
      const threshold00 = grid.thresholds[rowBase0 + column0];
      const threshold10 = grid.thresholds[rowBase0 + column1];
      const threshold01 = grid.thresholds[rowBase1 + column0];
      const threshold11 = grid.thresholds[rowBase1 + column1];
      let threshold;
      if (hasValidTiles) {
        const top = weightX * (threshold10 - threshold00) + threshold00;
        const bottom = weightX * (threshold11 - threshold01) + threshold01;
        threshold = weightY * (bottom - top) + top;
      } else {
        threshold = fallbackThreshold;
      }

      if (plane[y * width + x] <= threshold) darkCount += 1;
      else isBright[y * width + x] = 1;
    }
  }

  // 背景通常占多数像素：把多数一侧映射为白色背景、少数一侧映射为黑色文字。
  const darkIsBackground = darkCount * 2 > pixelCount;

  // 第二遍：写输出。
  if (mode === 'binary') {
    for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 4) {
      const pixelIsText = darkIsBackground ? isBright[pixel] === 1 : isBright[pixel] === 0;
      const channel = pixelIsText ? 0 : 255;
      outputSet(output, offset, channel);
    }
  } else {
    // adaptive-gray：以局部阈值为中心做软对比度归一化。阈值附近 SOFTNESS
    // 范围内平滑过渡（保留抗锯齿边缘），之外饱和成纯黑/纯白。
    const direction = darkIsBackground ? -1 : 1;
    const scale = 127.5 / SOFTNESS;
    for (let y = 0; y < height; y += 1) {
      const row0 = rowTable.index0[y];
      const row1 = rowTable.index1[y];
      const weightY = rowTable.weight[y];
      const rowBase0 = row0 * grid.columns;
      const rowBase1 = row1 * grid.columns;
      for (let x = 0; x < width; x += 1) {
        const column0 = columnTable.index0[x];
        const column1 = columnTable.index1[x];
        const weightX = columnTable.weight[x];
        const threshold00 = grid.thresholds[rowBase0 + column0];
        const threshold10 = grid.thresholds[rowBase0 + column1];
        const threshold01 = grid.thresholds[rowBase1 + column0];
        const threshold11 = grid.thresholds[rowBase1 + column1];
        let threshold;
        if (hasValidTiles) {
          const top = weightX * (threshold10 - threshold00) + threshold00;
          const bottom = weightX * (threshold11 - threshold01) + threshold01;
          threshold = weightY * (bottom - top) + top;
        } else {
          threshold = fallbackThreshold;
        }

        const normalized = 127.5 + direction * (plane[y * width + x] - threshold) * scale;
        const channel = normalized <= 0 ? 0 : normalized >= 255 ? 255 : Math.round(normalized);
        const offset = (y * width + x) * 4;
        output[offset] = channel;
        output[offset + 1] = channel;
        output[offset + 2] = channel;
        output[offset + 3] = 255;
      }
    }
  }
  return { bitmap: output, metric: METRICS[metricIndex].name, threshold: globalSelection.threshold };
}

function outputSet(output, offset, channel) {
  output[offset] = channel;
  output[offset + 1] = channel;
  output[offset + 2] = channel;
  output[offset + 3] = 255;
}

module.exports = { preprocessBgraBitmap };
