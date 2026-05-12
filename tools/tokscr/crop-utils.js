(function initCropUtils(root, factory) {
  const utils = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = utils;
  }

  root.TokscrCropUtils = utils;
})(typeof globalThis !== "undefined" ? globalThis : window, () => {
  const DEFAULT_MIN_SIZE = 24;

  function toFiniteNumber(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function clamp(value, min, max) {
    if (max < min) {
      return min;
    }

    return Math.min(Math.max(value, min), max);
  }

  function normalizeRect(rect) {
    const x = toFiniteNumber(rect.x, 0);
    const y = toFiniteNumber(rect.y, 0);
    const width = toFiniteNumber(rect.width, 0);
    const height = toFiniteNumber(rect.height, 0);
    const left = Math.min(x, x + width);
    const top = Math.min(y, y + height);
    const right = Math.max(x, x + width);
    const bottom = Math.max(y, y + height);

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    };
  }

  function roundRect(rect) {
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function clampCropRect(rect, maxWidth, maxHeight, minSize = DEFAULT_MIN_SIZE) {
    const boundsWidth = Math.max(1, Math.round(toFiniteNumber(maxWidth, 1)));
    const boundsHeight = Math.max(1, Math.round(toFiniteNumber(maxHeight, 1)));
    const minimum = Math.max(1, Math.round(Math.min(minSize, boundsWidth, boundsHeight)));
    const normalized = normalizeRect(rect);
    const width = clamp(normalized.width, minimum, boundsWidth);
    const height = clamp(normalized.height, minimum, boundsHeight);
    const x = clamp(normalized.x, 0, boundsWidth - width);
    const y = clamp(normalized.y, 0, boundsHeight - height);

    return roundRect({ x, y, width, height });
  }

  function createInitialCropRect(displayWidth, displayHeight, paddingRatio = 0.08) {
    const width = Math.max(1, Math.round(toFiniteNumber(displayWidth, 1)));
    const height = Math.max(1, Math.round(toFiniteNumber(displayHeight, 1)));
    const ratio = clamp(toFiniteNumber(paddingRatio, 0.08), 0, 0.45);
    const cropWidth = Math.max(DEFAULT_MIN_SIZE, width * (1 - ratio * 2));
    const cropHeight = Math.max(DEFAULT_MIN_SIZE, height * (1 - ratio * 2));

    return clampCropRect({
      x: (width - cropWidth) / 2,
      y: (height - cropHeight) / 2,
      width: cropWidth,
      height: cropHeight
    }, width, height, DEFAULT_MIN_SIZE);
  }

  function selectionToNaturalRect(rect, dimensions) {
    const displayWidth = Math.max(1, toFiniteNumber(dimensions.displayWidth, 1));
    const displayHeight = Math.max(1, toFiniteNumber(dimensions.displayHeight, 1));
    const naturalWidth = Math.max(1, Math.round(toFiniteNumber(dimensions.naturalWidth, 1)));
    const naturalHeight = Math.max(1, Math.round(toFiniteNumber(dimensions.naturalHeight, 1)));
    const displayRect = clampCropRect(rect, displayWidth, displayHeight, 1);
    const scaleX = naturalWidth / displayWidth;
    const scaleY = naturalHeight / displayHeight;
    const x = clamp(Math.round(displayRect.x * scaleX), 0, naturalWidth - 1);
    const y = clamp(Math.round(displayRect.y * scaleY), 0, naturalHeight - 1);
    const right = clamp(Math.round((displayRect.x + displayRect.width) * scaleX), x + 1, naturalWidth);
    const bottom = clamp(Math.round((displayRect.y + displayRect.height) * scaleY), y + 1, naturalHeight);

    return {
      x,
      y,
      width: right - x,
      height: bottom - y
    };
  }

  return {
    clampCropRect,
    createInitialCropRect,
    selectionToNaturalRect
  };
});
