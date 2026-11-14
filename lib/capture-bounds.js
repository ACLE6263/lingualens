function getForegroundCaptureBounds(displayBounds, displayPixels, foregroundPixels) {
  const left = Math.max(displayPixels.x, foregroundPixels.x);
  const top = Math.max(displayPixels.y, foregroundPixels.y);
  const right = Math.min(displayPixels.x + displayPixels.width, foregroundPixels.x + foregroundPixels.width);
  const bottom = Math.min(displayPixels.y + displayPixels.height, foregroundPixels.y + foregroundPixels.height);
  if (right <= left || bottom <= top) return null;

  const scaleX = displayBounds.width / displayPixels.width;
  const scaleY = displayBounds.height / displayPixels.height;
  return {
    x: displayBounds.x + (left - displayPixels.x) * scaleX,
    y: displayBounds.y + (top - displayPixels.y) * scaleY,
    width: (right - left) * scaleX,
    height: (bottom - top) * scaleY,
  };
}

module.exports = { getForegroundCaptureBounds };
