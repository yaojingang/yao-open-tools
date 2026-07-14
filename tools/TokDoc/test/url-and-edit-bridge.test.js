import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { buildManagedSlug, removeEditBridge } from '../src/html.js';
import { editableElementSelector, injectEditBridge, movableModuleSelector } from '../src/edit-bridge.js';

test('buildManagedSlug creates a short six-character URL slug for uploads', () => {
  const slug = buildManagedSlug({
    code: 'f812c6',
  });

  assert.equal(slug, 'f812c6');
  assert.match(slug, /^[a-z0-9]{6}$/);
});

test('editableElementSelector covers common text modules beyond paragraphs', () => {
  const { document } = parseHTML(`
    <main>
      <div class="card">卡片文案</div>
      <span>标签文案</span>
      <a href="#">链接文案</a>
      <button>按钮文案</button>
      <p>段落文案</p>
    </main>
  `);

  const editableTexts = Array.from(document.querySelectorAll(editableElementSelector)).map((node) => node.textContent.trim());

  assert.deepEqual(editableTexts, ['卡片文案', '标签文案', '链接文案', '按钮文案', '段落文案']);
});

test('movableModuleSelector covers common layout modules', () => {
  const { document } = parseHTML(`
    <main>
      <section>章节</section>
      <article>文章</article>
      <div class="card">卡片</div>
      <div class="module">模块</div>
      <div data-module="hero">数据模块</div>
    </main>
  `);

  const movableTexts = Array.from(document.querySelectorAll(movableModuleSelector)).map((node) => node.textContent.trim());

  assert.deepEqual(movableTexts, ['章节', '文章', '卡片', '模块', '数据模块']);
});

test('injectEditBridge uses a structured kami-style floating toolbar', () => {
  const html = injectEditBridge(
    { id: 'page-1', slug: 'f812c6', revision: 1, fileType: 'html' },
    '<!doctype html><html><head><title>页面</title></head><body><h1>页面</h1></body></html>',
    '/ops-console',
  );

  assert.match(html, /tokdoc-edit-panel/);
  assert.match(html, /tokdoc-edit-panel__brand/);
  assert.match(html, /tokdoc-edit-panel__status/);
  assert.match(html, /tokdoc-edit-panel__actions/);
  assert.match(html, /tokdoc-module-handle/);
  assert.match(html, /data-tokdoc-free-handle/);
  assert.match(html, /mountModuleHandle/);
  assert.match(html, /smallestModuleAt/);
  assert.match(html, /positionModuleControls/);
  assert.match(html, /styleWidthFromBorderBox/);
  assert.match(html, /styleHeightFromBorderBox/);
  assert.match(html, /inside-right/);
  assert.match(html, /inside-left/);
  assert.match(html, /startFreeDrag/);
  assert.match(html, /startResizeDrag/);
  assert.match(html, /data-tokdoc-resize-handle/);
  assert.match(html, /tokdoc-resize-handle--right/);
  assert.match(html, /tokdoc-module--free-positioned/);
  assert.match(html, /tokdoc-module--resizing/);
  assert.doesNotMatch(html, /tokdoc-module-sort-handle/);
  assert.doesNotMatch(html, /data-tokdoc-drag-handle/);
  assert.doesNotMatch(html, /event\.altKey/);
  assert.doesNotMatch(html, /Alt\/Option/);
  assert.match(html, /const isMarkdownPage = false/);
  assert.match(html, /href="\/f812c6"/);
  assert.match(html, /href="\/ops-console"/);
  assert.match(html, /\/ops-console\/api\/pages\/page-1\/content/);
  assert.doesNotMatch(html, /href="\/">管理器/);
  assert.doesNotMatch(html, /href="\/pages\/f812c6\.html"/);
});

test('injectEditBridge adds Markdown editor mode for Markdown pages', () => {
  const html = injectEditBridge(
    { id: 'markdown-1', slug: 'm812c6', revision: 2, fileType: 'markdown' },
    '<!doctype html><html><head><title>Markdown</title></head><body><main><h1>Markdown</h1></main></body></html>',
    '/ops-console',
  );

  assert.match(html, /编辑器修改/);
  assert.match(html, /tokdoc-edit-panel--markdown/);
  assert.match(html, /tokdoc-source-editor/);
  assert.match(html, /data-tokdoc-source-input/);
  assert.match(html, /data-tokdoc-md-format="bold"/);
  assert.match(html, /data-tokdoc-md-format="table"/);
  assert.match(html, /data-tokdoc-source-view="preview"/);
  assert.match(html, /data-tokdoc-source-view="split"/);
  assert.match(html, /data-tokdoc-source-preview/);
  assert.match(html, /data-tokdoc-source-save/);
  assert.match(html, /\/ops-console\/api\/pages\/markdown-1\/source/);
  assert.match(html, /saveMarkdownSourceNow/);
  assert.match(html, /renderMarkdownPreview/);
  assert.match(html, /applyMarkdownFormat/);
  assert.match(html, /openMarkdownSourceEditor\(\)/);
  assert.match(html, /sourceOutOfSync/);
  assert.match(html, /window\.location\.href = '\/m812c6\?edit=1'/);

  const script = html.match(/<script data-tokdoc-bridge="script">([\s\S]*?)<\/script>/)?.[1] || '';
  assert.ok(script.includes('renderMarkdownPreview'));
  assert.doesNotThrow(() => new vm.Script(script));
});

test('removeEditBridge strips drag sorting runtime markers before saving', () => {
  const cleaned = removeEditBridge(`
    <!doctype html>
    <html>
      <body>
        <section
          data-tokhtml-module="true"
          data-tokhtml-free-positioned="true"
          draggable="true"
          class="hero tokhtml-draggable-module tokhtml-adjustable-active tokhtml-module--free-positioned tokhtml-module--free-dragging tokhtml-module--resizing"
          style="position:absolute;inset:32px auto auto 24px;width:300px;height:180px;z-index:10"
        >
          <button data-tokhtml-bridge="drag-handle" data-tokhtml-free-handle="true">↔</button>
          <span data-tokhtml-bridge="resize-handle" data-tokhtml-resize-handle="right"></span>
          <h1 data-tokhtml-editable="true" contenteditable="true" class="tokhtml-editable">标题</h1>
        </section>
        <article
          data-tokdoc-module="true"
          data-tokdoc-free-positioned="true"
          draggable="true"
          class="note tokdoc-draggable-module tokdoc-adjustable-active tokdoc-module--free-positioned tokdoc-module--free-dragging tokdoc-module--resizing"
        >
          <button data-tokdoc-bridge="drag-handle" data-tokdoc-free-handle="true">↔</button>
          <span data-tokdoc-bridge="resize-handle" data-tokdoc-resize-handle="right"></span>
          <p data-tokdoc-editable="true" contenteditable="true" class="tokdoc-editable">说明</p>
        </article>
      </body>
    </html>
  `);

  assert.doesNotMatch(cleaned, /data-tokhtml-module/);
  assert.doesNotMatch(cleaned, /data-tokhtml-free-positioned/);
  assert.doesNotMatch(cleaned, /data-tokhtml-bridge/);
  assert.doesNotMatch(cleaned, /data-tokhtml-free-handle/);
  assert.doesNotMatch(cleaned, /data-tokhtml-resize-handle/);
  assert.doesNotMatch(cleaned, /data-tokdoc-module/);
  assert.doesNotMatch(cleaned, /data-tokdoc-free-positioned/);
  assert.doesNotMatch(cleaned, /data-tokdoc-bridge/);
  assert.doesNotMatch(cleaned, /data-tokdoc-free-handle/);
  assert.doesNotMatch(cleaned, /data-tokdoc-resize-handle/);
  assert.doesNotMatch(cleaned, /contenteditable/);
  assert.doesNotMatch(cleaned, /tokhtml-editable/);
  assert.doesNotMatch(cleaned, /tokhtml-draggable-module/);
  assert.doesNotMatch(cleaned, /tokhtml-adjustable-active/);
  assert.doesNotMatch(cleaned, /tokhtml-module--free-positioned/);
  assert.doesNotMatch(cleaned, /tokhtml-module--free-dragging/);
  assert.doesNotMatch(cleaned, /tokhtml-module--resizing/);
  assert.doesNotMatch(cleaned, /tokdoc-editable/);
  assert.doesNotMatch(cleaned, /tokdoc-draggable-module/);
  assert.doesNotMatch(cleaned, /tokdoc-adjustable-active/);
  assert.doesNotMatch(cleaned, /tokdoc-module--free-positioned/);
  assert.doesNotMatch(cleaned, /tokdoc-module--free-dragging/);
  assert.doesNotMatch(cleaned, /tokdoc-module--resizing/);
  assert.match(cleaned, /class="hero"/);
  assert.match(cleaned, /class="note"/);
  assert.match(cleaned, /position:absolute/);
  assert.match(cleaned, /left:24px/);
  assert.match(cleaned, /top:32px/);
  assert.match(cleaned, /height:180px/);
  assert.doesNotMatch(cleaned, /inset:/);
  assert.match(cleaned, /标题/);
  assert.match(cleaned, /说明/);
});
