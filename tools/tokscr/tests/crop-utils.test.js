const assert = require("node:assert/strict");
const test = require("node:test");

const {
  clampCropRect,
  createInitialCropRect,
  selectionToNaturalRect
} = require("../crop-utils.js");

test("creates a centered initial crop rect with viewport padding", () => {
  assert.deepEqual(createInitialCropRect(1000, 500, 0.1), {
    x: 100,
    y: 50,
    width: 800,
    height: 400
  });
});

test("clamps a displayed crop rect inside the preview image", () => {
  assert.deepEqual(clampCropRect({
    x: -20,
    y: 460,
    width: 80,
    height: 80
  }, 600, 500, 40), {
    x: 0,
    y: 420,
    width: 80,
    height: 80
  });
});

test("normalizes reverse drag and maps displayed rect to natural pixels", () => {
  assert.deepEqual(selectionToNaturalRect({
    x: 430,
    y: 260,
    width: -300,
    height: -150
  }, {
    displayWidth: 800,
    displayHeight: 400,
    naturalWidth: 2400,
    naturalHeight: 1200
  }), {
    x: 390,
    y: 330,
    width: 900,
    height: 450
  });
});
