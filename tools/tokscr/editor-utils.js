(function initEditorUtils(root, factory) {
  const utils = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = utils;
  }

  root.TokscrEditorUtils = utils;
})(typeof globalThis !== "undefined" ? globalThis : window, () => {
  const TEXT_WIDTH_RATIO = 0.62;
  const TEXT_HEIGHT_RATIO = 1.35;

  function toFiniteNumber(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function clamp(value, min, max) {
    if (max < min) {
      return min;
    }

    return Math.min(Math.max(value, min), max);
  }

  function normalizeEditorRect(rect) {
    const x = toFiniteNumber(rect.x, 0);
    const y = toFiniteNumber(rect.y, 0);
    const width = toFiniteNumber(rect.width, 0);
    const height = toFiniteNumber(rect.height, 0);
    const left = Math.min(x, x + width);
    const top = Math.min(y, y + height);
    const right = Math.max(x, x + width);
    const bottom = Math.max(y, y + height);

    return {
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(right - left),
      height: Math.round(bottom - top)
    };
  }

  function mapDisplayToNaturalPoint(point, dimensions) {
    const displayWidth = Math.max(1, toFiniteNumber(dimensions.displayWidth, 1));
    const displayHeight = Math.max(1, toFiniteNumber(dimensions.displayHeight, 1));
    const naturalWidth = Math.max(1, toFiniteNumber(dimensions.naturalWidth, 1));
    const naturalHeight = Math.max(1, toFiniteNumber(dimensions.naturalHeight, 1));

    return {
      x: Math.round(clamp(point.x, 0, displayWidth) * (naturalWidth / displayWidth)),
      y: Math.round(clamp(point.y, 0, displayHeight) * (naturalHeight / displayHeight))
    };
  }

  function pointsBounds(points) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const right = Math.max(...xs);
    const bottom = Math.max(...ys);

    return normalizeEditorRect({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    });
  }

  function annotationBounds(annotation) {
    if (annotation.type === "brush") {
      return pointsBounds(annotation.points || [{ x: 0, y: 0 }]);
    }

    if (annotation.type === "mosaic" && annotation.shape === "ellipse") {
      const radiusX = Math.abs(toFiniteNumber(annotation.rx, 0));
      const radiusY = Math.abs(toFiniteNumber(annotation.ry, 0));
      const centerX = toFiniteNumber(annotation.cx, 0);
      const centerY = toFiniteNumber(annotation.cy, 0);

      return normalizeEditorRect({
        x: centerX - radiusX,
        y: centerY - radiusY,
        width: radiusX * 2,
        height: radiusY * 2
      });
    }

    if (annotation.type === "arrow") {
      return pointsBounds([
        { x: annotation.x1, y: annotation.y1 },
        { x: annotation.x2, y: annotation.y2 }
      ]);
    }

    if (annotation.type === "text") {
      const text = annotation.text || "";
      const fontSize = Math.max(1, annotation.fontSize || 24);
      const naturalWidth = Math.max(fontSize, text.length * fontSize * TEXT_WIDTH_RATIO);
      const boxWidth = Math.max(naturalWidth, toFiniteNumber(annotation.boxWidth, naturalWidth));

      return {
        x: Math.round(annotation.x || 0),
        y: Math.round((annotation.y || 0) - fontSize),
        width: Math.round(boxWidth),
        height: Math.round(fontSize * TEXT_HEIGHT_RATIO)
      };
    }

    return normalizeEditorRect(annotation);
  }

  function createTextAnnotation(options) {
    const fontSize = Math.max(1, toFiniteNumber(options.fontSize, 24));
    const point = options.point || { x: 0, y: 0 };
    const text = String(options.text || "").trim();

    return {
      id: options.id,
      type: "text",
      text,
      x: Math.round(toFiniteNumber(point.x, 0)),
      y: Math.round(toFiniteNumber(point.y, 0) + fontSize),
      color: options.color,
      fontSize
    };
  }

  function resizeTextAnnotation(annotation, rect, handle) {
    const normalized = normalizeEditorRect(rect);
    const textLength = Math.max(1, String(annotation.text || "").length);
    const widthFontSize = normalized.width / Math.max(1, textLength * TEXT_WIDTH_RATIO);
    const heightFontSize = normalized.height / TEXT_HEIGHT_RATIO;
    const usesHorizontal = handle.includes("e") || handle.includes("w");
    const usesVertical = handle.includes("n") || handle.includes("s");
    const previousFontSize = Math.max(1, annotation.fontSize || 24);
    let fontSize = previousFontSize;

    if (usesHorizontal && !usesVertical) {
      return {
        ...annotation,
        x: normalized.x,
        boxWidth: normalized.width
      };
    }

    if (usesHorizontal && usesVertical) {
      fontSize = Math.min(widthFontSize, heightFontSize);
    } else if (usesVertical) {
      fontSize = heightFontSize;
    }

    fontSize = Math.round(clamp(fontSize, 10, 260));
    const scale = fontSize / previousFontSize;
    const scaledBoxWidth = Number.isFinite(annotation.boxWidth)
      ? Math.round(annotation.boxWidth * scale)
      : undefined;

    return {
      ...annotation,
      x: normalized.x,
      y: normalized.y + fontSize,
      fontSize,
      boxWidth: scaledBoxWidth
    };
  }

  function getEditorCropTransition(options) {
    return (options.annotationCount || 0) > 0 ? "apply-then-crop" : "exit-then-crop";
  }

  function rectContainsPoint(rect, point, padding = 0) {
    return point.x >= rect.x - padding
      && point.x <= rect.x + rect.width + padding
      && point.y >= rect.y - padding
      && point.y <= rect.y + rect.height + padding;
  }

  function hitTestAnnotations(annotations, point, padding = 8) {
    for (let index = annotations.length - 1; index >= 0; index -= 1) {
      const annotation = annotations[index];

      if (rectContainsPoint(annotationBounds(annotation), point, padding)) {
        return annotation.id || null;
      }
    }

    return null;
  }

  return {
    annotationBounds,
    createTextAnnotation,
    getEditorCropTransition,
    hitTestAnnotations,
    mapDisplayToNaturalPoint,
    normalizeEditorRect,
    resizeTextAnnotation
  };
});
