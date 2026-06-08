import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDb } from '../src/db.js';
import { PageStore } from '../src/page-store.js';

async function createStore(overrides = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokdoc-test-'));
  const watchDir = path.join(dataDir, 'watch');
  const config = {
    name: 'tokdoc',
    rootDir: dataDir,
    host: '127.0.0.1',
    port: 0,
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    generatedDir: path.join(dataDir, 'pages'),
    versionsDir: path.join(dataDir, 'versions'),
    publicDir: path.join(dataDir, 'public'),
    watchDirs: [watchDir],
    allowSourceWrite: false,
    ...overrides,
  };
  const db = createDb(config);
  const store = new PageStore(config, db);
  await store.ensureStorage();
  return { store, db, config, dataDir, watchDir };
}

test('imports uploaded HTML and extracts directory name from relative path', async (t) => {
  const { store, db, dataDir, config } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const page = await store.importBuffer({
    fileName: 'a.html',
    relativePath: 'watch-demo-a/a.html',
    buffer: Buffer.from('<!doctype html><title>目录导入 A</title><h1>备用标题</h1>'),
  });

  assert.equal(page.title, '目录导入 A');
  assert.equal(page.directoryName, 'watch-demo-a');
  assert.equal(page.fileName, 'a.html');
  assert.equal(page.revision, 1);
  assert.match(page.url, /^\/[a-z0-9]{6}$/);
  assert.equal(page.editUrl, `${page.url}?edit=1`);
  assert.equal(path.dirname(page.generatedPath), config.generatedDir);
  assert.match(path.basename(page.generatedPath), new RegExp(`^\\d{8}-a-${page.slug}\\.html$`));
  assert.match(await store.readPageHtml(page), /目录导入 A/);
});

test('imports uploaded PDF as a public readable document asset', async (t) => {
  const { store, db, dataDir, config } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const pdfBytes = Buffer.from('%PDF-1.4\n% tokdoc pdf probe\n');
  const page = await store.importBuffer({
    fileName: 'report.pdf',
    relativePath: 'docs/report.pdf',
    buffer: pdfBytes,
  });

  assert.equal(page.fileType, 'pdf');
  assert.equal(page.mimeType, 'application/pdf');
  assert.equal(page.title, 'report');
  assert.equal(page.directoryName, 'docs');
  assert.equal(page.fileName, 'report.pdf');
  assert.equal(page.editUrl, '');
  assert.match(page.url, /^\/[a-z0-9]{6}$/);
  assert.equal(path.dirname(page.generatedPath), config.generatedDir);
  assert.match(path.basename(page.generatedPath), new RegExp(`^\\d{8}-report-${page.slug}\\.pdf$`));
  assert.deepEqual(await store.readPageFile(page), pdfBytes);
});

test('imports uploaded Word documents by converting them to readable PDF assets', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokdoc-office-'));
  const fakeOffice = path.join(dataDir, 'fake-soffice.mjs');
  await fs.writeFile(
    fakeOffice,
    [
      '#!/usr/bin/env node',
      'import fs from "node:fs";',
      'import path from "node:path";',
      'const outdir = process.argv[process.argv.indexOf("--outdir") + 1];',
      'const source = process.argv.at(-1);',
      'const output = path.join(outdir, path.basename(source).replace(/\\.[^.]+$/, ".pdf"));',
      'fs.writeFileSync(output, `%PDF-1.4\\nconverted:${path.basename(source)}\\n`);',
    ].join('\n'),
  );
  await fs.chmod(fakeOffice, 0o755);

  const { store, db, config } = await createStore({ officeConverterBin: fakeOffice });
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  t.after(() => fs.rm(config.dataDir, { recursive: true, force: true }));

  const page = await store.importBuffer({
    fileName: 'contract.docx',
    relativePath: 'clients/contract.docx',
    buffer: Buffer.from('docx-bytes'),
  });
  const generated = await store.readPageFile(page);

  assert.equal(page.fileType, 'word');
  assert.equal(page.mimeType, 'application/pdf');
  assert.equal(page.title, 'contract');
  assert.equal(page.directoryName, 'clients');
  assert.equal(page.fileName, 'contract.docx');
  assert.equal(path.dirname(page.generatedPath), config.generatedDir);
  assert.match(path.basename(page.generatedPath), new RegExp(`^\\d{8}-contract-${page.slug}\\.pdf$`));
  assert.match(generated.toString('utf8'), /^%PDF-1\.4\nconverted:contract\.docx/);
});

test('imports upload folders with sibling assets and injects a page asset base', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const pages = await store.importUploadFiles([
    {
      fileName: 'index.html',
      relativePath: 'campaign/index.html',
      buffer: Buffer.from(
        '<!doctype html><html><head><title>活动页</title><link rel="stylesheet" href="css/style.css"></head><body><img src="images/logo.png"><h1>活动页</h1></body></html>',
      ),
    },
    {
      fileName: 'style.css',
      relativePath: 'campaign/css/style.css',
      buffer: Buffer.from('body{color:#123}'),
    },
    {
      fileName: 'logo.png',
      relativePath: 'campaign/images/logo.png',
      buffer: Buffer.from('png-bytes'),
    },
  ]);

  assert.equal(pages.length, 1);
  assert.equal(pages[0].directoryName, 'campaign');
  assert.equal(pages[0].fileName, 'index.html');
  assert.match(path.basename(pages[0].generatedPath), new RegExp(`^\\d{8}-index-${pages[0].slug}\\.html$`));
  assert.match(await store.readPageHtml(pages[0]), /<base data-tokdoc-base href="\/page-assets\/[^/]+\/campaign\/">/);
  await fs.access(path.join(path.dirname(pages[0].sourcePath), 'css', 'style.css'));
  await fs.access(path.join(path.dirname(pages[0].sourcePath), 'images', 'logo.png'));
});

test('injects configured tracking code into newly generated HTML pages', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  await store.saveSettings({
    trackingCode: '<script data-test-tracker>window.__tracked = true;</script>',
  });

  const page = await store.importBuffer({
    fileName: 'tracked.html',
    relativePath: 'tracked.html',
    buffer: Buffer.from(
      '<!doctype html><html><head><title>统计页</title><!-- tokhtml-tracking:start --><script>window.oldTracker=true</script><!-- tokhtml-tracking:end --></head><body><h1>统计页</h1></body></html>',
    ),
  });
  const html = await store.readPageHtml(page);

  assert.match(html, /<!-- tokdoc-tracking:start -->/);
  assert.doesNotMatch(html, /tokhtml-tracking/);
  assert.doesNotMatch(html, /oldTracker/);
  assert.match(html, /<script data-test-tracker>window\.__tracked = true;<\/script>/);
  assert.ok(html.indexOf('data-test-tracker') < html.indexOf('</head>'));
  assert.equal((html.match(/data-test-tracker/g) || []).length, 1);
});

test('autosaves content with revision lock and creates restorable versions', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const page = await store.importBuffer({
    fileName: 'landing.html',
    relativePath: 'landing.html',
    buffer: Buffer.from('<!doctype html><html><head><title>原始标题</title></head><body><h1>原始标题</h1></body></html>'),
  });

  const saved = await store.savePageContent(page.id, {
    revision: page.revision,
    reason: 'autosave',
    html: '<!doctype html><html><head><title>新标题</title></head><body><h1>新标题</h1><p>已修改</p></body></html>',
  });

  assert.equal(saved.title, '新标题');
  assert.equal(saved.revision, 2);
  assert.equal(saved.edited, true);
  assert.equal(store.listVersions(page.id).length, 1);

  await assert.rejects(
    () =>
      store.savePageContent(page.id, {
        revision: page.revision,
        html: '<!doctype html><title>旧版本提交</title>',
      }),
    /Revision conflict/,
  );

  const restored = await store.restoreVersion(page.id, store.listVersions(page.id).at(-1).id);
  assert.equal(restored.revision, 3);
  assert.match(await store.readPageHtml(restored), /原始标题/);
});

test('rescans watch directory and upserts HTML files', async (t) => {
  const { store, db, dataDir, watchDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  await fs.mkdir(path.join(watchDir, 'school'), { recursive: true });
  await fs.writeFile(
    path.join(watchDir, 'school', 'admission.html'),
    '<!doctype html><html><head><title>招生页</title></head><body><h1>招生页</h1></body></html>',
  );
  const watch = await store.addWatchDir({ path: watchDir, name: 'html-inbox', createIfMissing: true });
  const scanned = await store.rescanWatchDir(watch.id);
  const pages = store.listPages();

  assert.equal(scanned.htmlCount, 1);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].directoryName, 'school');
  assert.equal(pages[0].sourceType, 'watch');
});

test('marks inaccessible watch directories as errored instead of throwing', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const blocker = path.join(dataDir, 'not-a-directory');
  await fs.writeFile(blocker, 'file');
  const watch = await store.addWatchDir({ path: path.join(blocker, 'watch'), name: 'broken-watch', createIfMissing: false });
  const rescanned = await store.rescanWatchDir(watch.id);

  assert.equal(rescanned.status, 'error');
  assert.equal(rescanned.htmlCount, 0);
  assert.equal(store.listPages().length, 0);
});

test('paginates page list with a default page size of 20', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  for (let index = 1; index <= 25; index += 1) {
    await store.importBuffer({
      fileName: `page-${String(index).padStart(2, '0')}.html`,
      relativePath: `page-${String(index).padStart(2, '0')}.html`,
      buffer: Buffer.from(`<!doctype html><html><head><title>页面 ${index}</title></head><body><h1>页面 ${index}</h1></body></html>`),
    });
  }

  const firstPage = store.listPagesPage();
  const secondPage = store.listPagesPage({ page: 2 });

  assert.equal(firstPage.pages.length, 20);
  assert.equal(firstPage.pagination.pageSize, 20);
  assert.equal(firstPage.pagination.total, 25);
  assert.equal(firstPage.pagination.totalPages, 2);
  assert.equal(secondPage.pages.length, 5);
  assert.equal(secondPage.pagination.page, 2);
});

test('tracks page access count for generated HTML views', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const page = await store.importBuffer({
    fileName: 'view-count.html',
    relativePath: 'view-count.html',
    buffer: Buffer.from('<!doctype html><html><head><title>访问统计</title></head><body><h1>访问统计</h1></body></html>'),
  });

  assert.equal(page.accessCount, 0);
  assert.equal(store.incrementAccessCount(page.id).accessCount, 1);
  assert.equal(store.incrementAccessCount(page.id).accessCount, 2);
  assert.equal(store.getPage(page.id).accessCount, 2);
});

test('moves deleted pages into an inaccessible recycle bin and restores them', async (t) => {
  const { store, db, dataDir, config } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const page = await store.importBuffer({
    fileName: 'trash-me.html',
    relativePath: 'trash-me.html',
    buffer: Buffer.from('<!doctype html><html><head><title>回收站页面</title></head><body><h1>回收站页面</h1></body></html>'),
  });
  const originalGeneratedPath = page.generatedPath;
  await fs.access(originalGeneratedPath);

  const trashed = await store.deletePage(page.id);
  assert.equal(trashed.deletedAt.length > 0, true);
  assert.equal(trashed.status, 'trashed');
  assert.equal(store.listPages().length, 0);
  assert.equal(store.listPages({ scope: 'trash' }).length, 1);
  await assert.rejects(() => fs.access(originalGeneratedPath));
  await fs.access(trashed.generatedPath);
  assert.match(trashed.generatedPath, new RegExp(`${path.sep}trash${path.sep}`.replace(/\\/g, '\\\\')));

  const restored = await store.restoreDeletedPage(page.id);
  assert.equal(restored.deletedAt, '');
  assert.equal(restored.status, 'published');
  assert.equal(path.dirname(restored.generatedPath), config.generatedDir);
  assert.match(path.basename(restored.generatedPath), new RegExp(`^\\d{8}-trash-me-${page.slug}\\.html$`));
  assert.equal(store.listPages().length, 1);
  assert.equal(store.listPages({ scope: 'trash' }).length, 0);
  await fs.access(restored.generatedPath);
});
