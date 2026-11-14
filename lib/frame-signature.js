const TILE_SIZE = 32;

function createFrameSignature({ width, height, data }) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0
    || !Buffer.isBuffer(data) || data.length !== width * height * 4) {
    throw new Error('Frame bitmap is invalid.');
  }
  return { width, height, data };
}

function compareFrames(first, second, localThreshold = Infinity) {
  if (!first || !second || first.width !== second.width || first.height !== second.height) return 1;
  const { width, height, data: before } = first;
  const { data: after } = second;
  if (before.equals(after)) return 0;

  let total = 0;
  // Use the largest color-channel change so saturated colored text is still detected.
  // Ignore very small channel differences and require a two-dimensional change locally.
  const localMinimum = Math.max(10, TILE_SIZE ** 2 * localThreshold) * 255;
  for (let top = 0; top < height; top += TILE_SIZE) {
    const bottom = Math.min(height, top + TILE_SIZE);
    for (let left = 0; left < width; left += TILE_SIZE) {
      const right = Math.min(width, left + TILE_SIZE);
      let local = 0;
      let minX = right;
      let maxX = left;
      let minY = bottom;
      let maxY = top;
      for (let y = top; y < bottom; y += 1) {
        let offset = (y * width + left) * 4;
        for (let x = left; x < right; x += 1, offset += 4) {
          const delta = Math.max(
            Math.abs(before[offset] - after[offset]),
            Math.abs(before[offset + 1] - after[offset + 1]),
            Math.abs(before[offset + 2] - after[offset + 2]),
          );
          total += delta;
          if (delta < 16) continue;
          local += delta;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
      if (local > localMinimum && maxX - minX >= 2 && maxY - minY >= 2) {
        return local / (TILE_SIZE ** 2 * 255);
      }
    }
  }
  return total / (width * height * 255);
}

function frameDifference(first, second) {
  return compareFrames(first, second);
}

function hasMeaningfulFrameChange(first, second, threshold = 0.025) {
  return compareFrames(first, second, threshold) > threshold;
}

module.exports = { createFrameSignature, frameDifference, hasMeaningfulFrameChange };
