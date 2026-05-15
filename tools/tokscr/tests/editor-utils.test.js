const assert = require("node:assert/strict");
const test = require("node:test");

const {
  annotationBounds,
  createTextAnnotation,
  getEditorCropTransition,
  hitTestAnnotations,
  mapDisplayToNaturalPoint,
  normalizeEditorRect,
  resizeTextAnnotation
} = require("../editor-utils.js");

test("maps displayed editor point to natural image point", () => {
  assert.deepEqual(mapDisplayToNaturalPoint({
    x: 200,
    y: 100
  }, {
    displayWidth: 800,
    displayHeight: 400,
    naturalWidth: 2400,
    naturalHeight: 1200
  }), {
    x: 600,
    y: 300
  });
});

test("normalizes reverse-dragged editor rectangles", () => {
  assert.deepEqual(normalizeEditorRect({
    x: 400,
    y: 240,
    width: -120,
    height: -80
  }), {
    x: 280,
    y: 160,
    width: 120,
    height: 80
  });
});

test("calculates bounds for brush annotations", () => {
  assert.deepEqual(annotationBounds({
    type: "brush",
    points: [
      { x: 20, y: 40 },
      { x: 80, y: 10 },
      { x: 55, y: 90 }
    ]
  }), {
    x: 20,
    y: 10,
    width: 60,
    height: 80
  });
});

test("calculates bounds for ellipse mosaic annotations", () => {
  assert.deepEqual(annotationBounds({
    type: "mosaic",
    shape: "ellipse",
    cx: 140,
    cy: 90,
    rx: 60,
    ry: 35
  }), {
    x: 80,
    y: 55,
    width: 120,
    height: 70
  });
});

test("creates text annotations from inline editor top-left points", () => {
  assert.deepEqual(createTextAnnotation({
    id: "text-1",
    text: "  老姚  ",
    point: { x: 120, y: 80 },
    color: "#d93025",
    fontSize: 32
  }), {
    id: "text-1",
    type: "text",
    text: "老姚",
    x: 120,
    y: 112,
    color: "#d93025",
    fontSize: 32
  });
});

test("resizes text annotations horizontally from side handles without changing font size", () => {
  const resized = resizeTextAnnotation({
    id: "text-1",
    type: "text",
    text: "老姚",
    x: 120,
    y: 112,
    color: "#d93025",
    fontSize: 32
  }, {
    x: 120,
    y: 80,
    width: 100,
    height: 43
  }, "e");

  assert.equal(resized.fontSize, 32);
  assert.equal(resized.boxWidth, 100);
  assert.equal(resized.x, 120);
  assert.equal(resized.y, 112);
});

test("resizes text annotations uniformly from vertical handles", () => {
  const resized = resizeTextAnnotation({
    id: "text-1",
    type: "text",
    text: "老姚",
    x: 120,
    y: 112,
    color: "#d93025",
    fontSize: 32
  }, {
    x: 120,
    y: 80,
    width: 40,
    height: 54
  }, "s");

  assert.equal(resized.fontSize, 40);
  assert.equal(resized.boxWidth, undefined);
  assert.equal(resized.x, 120);
  assert.equal(resized.y, 120);
});

test("resizes widened text annotations without collapsing their frame width", () => {
  const resized = resizeTextAnnotation({
    id: "text-1",
    type: "text",
    text: "老姚",
    x: 120,
    y: 112,
    color: "#d93025",
    fontSize: 32,
    boxWidth: 100
  }, {
    x: 120,
    y: 80,
    width: 100,
    height: 54
  }, "s");

  assert.equal(resized.fontSize, 40);
  assert.equal(resized.boxWidth, 125);
  assert.equal(resized.x, 120);
  assert.equal(resized.y, 120);
});

test("switching from editor to crop applies pending annotations first", () => {
  assert.equal(getEditorCropTransition({ annotationCount: 2 }), "apply-then-crop");
  assert.equal(getEditorCropTransition({ annotationCount: 0 }), "exit-then-crop");
});

test("hit-tests annotations from topmost to bottom", () => {
  const annotations = [
    { id: "first", type: "cover", x: 10, y: 10, width: 160, height: 100 },
    { id: "second", type: "rect", x: 40, y: 30, width: 80, height: 50 }
  ];

  assert.equal(hitTestAnnotations(annotations, { x: 55, y: 40 }), "second");
});
