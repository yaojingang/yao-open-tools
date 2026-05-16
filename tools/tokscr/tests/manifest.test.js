const assert = require("node:assert/strict");
const test = require("node:test");
const manifest = require("../manifest.json");

test("manifest only requests permissions used by the extension", () => {
  assert.equal(manifest.version, "0.4.7");
  assert.deepEqual(manifest.permissions, [
    "activeTab",
    "clipboardWrite",
    "downloads",
    "offscreen",
    "scripting"
  ]);
});
