const assert = require("node:assert/strict");
const test = require("node:test");
const manifest = require("../manifest.json");
const zhCNMessages = require("../_locales/zh_CN/messages.json");

function message(id) {
  assert.ok(zhCNMessages[id], `missing zh_CN message: ${id}`);
  assert.equal(typeof zhCNMessages[id].message, "string");
  return zhCNMessages[id].message;
}

test("manifest only requests permissions used by the extension", () => {
  assert.equal(manifest.version, "0.4.8");
  assert.deepEqual(manifest.permissions, [
    "activeTab",
    "clipboardWrite",
    "downloads",
    "offscreen",
    "scripting"
  ]);
});

test("manifest uses Simplified Chinese store metadata", () => {
  assert.equal(manifest.default_locale, "zh_CN");
  assert.equal(manifest.name, "__MSG_appName__");
  assert.equal(manifest.short_name, "__MSG_appShortName__");
  assert.equal(manifest.description, "__MSG_appDescription__");
  assert.equal(manifest.action.default_title, "__MSG_actionTitle__");

  assert.equal(message("appName"), "tokscr - 网页截图、长截图、区域截图工具");
  assert.equal(message("appShortName"), "tokscr");
  assert.equal(
    message("appDescription"),
    "干净本地优先的 Chrome 网页截图工具，支持完整长截图、可见区域、框选区域、主体去噪、标注编辑，以及 PNG/JPEG/PDF/复制/打印导出。"
  );
  assert.equal(message("actionTitle"), "tokscr 网页截图");

  assert.ok([...message("appName")].length <= 75);
  assert.ok([...message("appDescription")].length <= 132);
});
