function createFrameSignature(frame, gridSize = 16) {
  const width = Number(frame?.width);
  const height = Number(frame?.height);
  const data = frame?.data;
  if (!data || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('Frame bitmap is invalid.');
  }
  const size = Math.max(2, Math.floor(gridSize));
  const signature = new Uint8Array(size * size);
  let outputIndex = 0;
  for (let gridY = 0; gridY < size; gridY += 1) {
    const y = Math.min(height - 1, Math.floor(((gridY + 0.5) * height) / size));
    for (let gridX = 0; gridX < size; gridX += 1) {
      const x = Math.min(width - 1, Math.floor(((gridX + 0.5) * width) / size));
      const offset = (y * width + x) * 4;
      const blue = data[offset];
      const green = data[offset + 1];
      const red = data[offset + 2];
      signature[outputIndex] = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722);
      outputIndex += 1;
    }
  }
  return signature;
}

function frameDifference(first, second) {
  if (!first || !second || first.length !== second.length || first.length === 0) return 1;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference += Math.abs(first[index] - second[index]);
  }
  return difference / (first.length * 255);
}

function hasMeaningfulFrameChange(first, second, threshold = 0.025) {
  if (!first) return true;
  return frameDifference(first, second) > threshold;
}

module.exports = { createFrameSignature, frameDifference, hasMeaningfulFrameChange };
