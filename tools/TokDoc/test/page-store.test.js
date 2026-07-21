import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createDb } from '../src/db.js';
import { managedFileType } from '../src/html.js';
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

test('detects managed document types across office-like formats', () => {
  assert.equal(managedFileType('index.html'), 'html');
  assert.equal(managedFileType('notes.md'), 'markdown');
  assert.equal(managedFileType('notes.markdown'), 'markdown');
  assert.equal(managedFileType('report.pdf'), 'pdf');
  assert.equal(managedFileType('contract.doc'), 'word');
  assert.equal(managedFileType('contract.docx'), 'word');
  assert.equal(managedFileType('deck.ppt'), 'presentation');
  assert.equal(managedFileType('deck.pptx'), 'presentation');
  assert.equal(managedFileType('deck.pptm'), 'presentation');
  assert.equal(managedFileType('deck.pps'), 'presentation');
  assert.equal(managedFileType('deck.ppsx'), 'presentation');
  assert.equal(managedFileType('slides.key'), 'keynote');
  assert.equal(managedFileType('budget.xls'), 'spreadsheet');
  assert.equal(managedFileType('budget.xlsx'), 'spreadsheet');
  assert.equal(managedFileType('budget.xlsm'), 'spreadsheet');
  assert.equal(managedFileType('budget.xlsb'), 'spreadsheet');
});

test('opens legacy databases by adding columns without deleting pages or settings', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokdoc-legacy-upgrade-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const generatedDir = path.join(dataDir, 'pages');
  const generatedPath = path.join(generatedDir, 'legacy-page.html');
  await fs.mkdir(generatedDir, { recursive: true });
  await fs.writeFile(generatedPath, '<!doctype html><title>旧页面</title><h1>旧页面</h1>');

  const dbPath = path.join(dataDir, 'tokhtml.db');
  const legacyDb = new DatabaseSync(dbPath);
  legacyDb.exec(`
    CREATE TABLE pages (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_path TEXT,
      directory_name TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'published',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      generated_path TEXT NOT NULL,
      raw_mtime_ms INTEGER,
      checksum TEXT NOT NULL,
      edited INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  legacyDb
    .prepare(
      `INSERT INTO pages (
        id, slug, file_name, title, source_type, source_path, directory_name, size, status,
        created_at, updated_at, revision, generated_path, raw_mtime_ms, checksum, edited
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'legacy-page-1',
      'ab12cd',
      'legacy-page.html',
      '旧页面',
      'upload',
      null,
      '',
      49,
      'published',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      1,
      generatedPath,
      null,
      'legacy-checksum',
      0,
    );
  legacyDb
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
    .run('auth_username', 'legacy-owner', '2026-01-01T00:00:00.000Z');
  legacyDb.close();

  const config = {
    name: 'tokdoc',
    rootDir: dataDir,
    host: '127.0.0.1',
    port: 0,
    dataDir,
    dbPath,
    uploadsDir: path.join(dataDir, 'uploads'),
    generatedDir,
    trashDir: path.join(dataDir, 'trash'),
    versionsDir: path.join(dataDir, 'versions'),
    publicDir: path.join(dataDir, 'public'),
    watchDirs: [],
    allowSourceWrite: false,
    initialAuthUsername: 'new-owner',
    initialAuthPassword: 'new-secret',
  };
  const db = createDb(config);
  t.after(() => db.close());
  const store = new PageStore(config, db);
  await store.ensureStorage();

  const columns = db.prepare('PRAGMA table_info(pages)').all().map((column) => column.name);
  for (const column of ['access_count', 'download_count', 'deleted_at', 'deleted_path', 'file_type', 'mime_type', 'visibility']) {
    assert.equal(columns.includes(column), true);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM pages').get().count, 1);

  const page = store.getPage('legacy-page-1');
  assert.equal(page.title, '旧页面');
  assert.equal(page.fileType, 'html');
  assert.equal(page.mimeType, 'text/html; charset=utf-8');
  assert.equal(page.visibility, 'public');
  assert.equal(page.accessCount, 0);
  assert.equal(page.downloadCount, 0);
  assert.equal(page.deletedAt, '');
  assert.match(await fs.readFile(generatedPath, 'utf8'), /旧页面/);
  assert.equal(store.getAuthSettings().authUsername, 'legacy-owner');
});

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

test('imports uploaded Markdown as a public readable HTML document', async (t) => {
  const { store, db, dataDir, config } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const page = await store.importBuffer({
    fileName: 'guide.md',
    relativePath: 'docs/guide.md',
    buffer: Buffer.from('# Markdown 指南\n\n这是 **TokDoc** 的 Markdown 文档。\n\n<script>alert("x")</script>\n'),
  });

  const html = await store.readPageHtml(page);
  assert.equal(page.fileType, 'markdown');
  assert.equal(page.mimeType, 'text/html; charset=utf-8');
  assert.equal(page.title, 'Markdown 指南');
  assert.equal(page.directoryName, 'docs');
  assert.equal(page.fileName, 'guide.md');
  assert.equal(page.editUrl, `${page.url}?edit=1`);
  assert.match(page.url, /^\/[a-z0-9]{6}$/);
  assert.equal(path.dirname(page.generatedPath), config.generatedDir);
  assert.match(path.basename(page.generatedPath), new RegExp(`^\\d{8}-guide-${page.slug}\\.html$`));
  assert.match(html, /<h1>Markdown 指南<\/h1>/);
  assert.match(html, /<strong>TokDoc<\/strong>/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
});

test('reads generated assets after Docker absolute paths move to the local data directory', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const pdfBytes = Buffer.from('%PDF-1.4\nportable path report\n');
  const page = await store.importBuffer({
    fileName: 'portable-report.pdf',
    relativePath: 'docs/portable-report.pdf',
    buffer: pdfBytes,
  });
  const dockerPath = `/app/data/pages/${path.basename(page.generatedPath)}`;
  db.prepare('UPDATE pages SET generated_path = ? WHERE id = ?').run(dockerPath, page.id);

  const stalePage = store.getPage(page.id);
  assert.equal(stalePage.generatedPath, dockerPath);
  assert.deepEqual(await store.readPageFile(stalePage), pdfBytes);
});

test('keeps legacy Word PDF records non-editable when mime type defaulted to HTML', async (t) => {
  const { store, db, dataDir, config } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const pdfBytes = Buffer.from('%PDF-1.4\nlegacy word pdf\n');
  const generatedPath = path.join(config.generatedDir, '20260608-legacy-word-abc123.pdf');
  await fs.writeFile(generatedPath, pdfBytes);
  const createdAt = new Date().toISOString();
  store.insertPage({
    id: 'legacy-word-pdf',
    slug: 'abc123',
    fileName: 'legacy.docx',
    title: 'legacy',
    fileType: 'word',
    mimeType: 'text/html; charset=utf-8',
    sourceType: 'upload',
    sourcePath: null,
    directoryName: '',
    size: pdfBytes.length,
    status: 'published',
    createdAt,
    updatedAt: createdAt,
    revision: 1,
    generatedPath,
    rawMtimeMs: null,
    checksum: 'legacy',
    edited: 0,
    accessCount: 0,
    visibility: 'public',
  });

  const page = store.getPage('legacy-word-pdf');
  assert.equal(page.mimeType, 'application/pdf');
  assert.equal(page.editUrl, '');
  assert.deepEqual(await store.readPageFile(page), pdfBytes);
});

test('imports uploaded spreadsheets as table-like HTML document assets', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokdoc-spreadsheet-'));
  const fakeOffice = path.join(dataDir, 'fake-soffice-html.mjs');
  await fs.writeFile(
    fakeOffice,
    [
      '#!/usr/bin/env node',
      'import fs from "node:fs";',
      'import path from "node:path";',
      'const outdir = process.argv[process.argv.indexOf("--outdir") + 1];',
      'const source = process.argv.at(-1);',
      'fs.mkdirSync(outdir, { recursive: true });',
      'const html = "<!doctype html><html><body><style>body{display:none}</style><table><tr><td>项目</td><td>金额</td></tr><tr><td>服务器</td><td>1800</td></tr><tr><td><a href=\\"javascript:alert(1)\\" onclick=\\"alert(2)\\">危险链接</a></td><td><script>alert(3)</script></td></tr></table></body></html>";',
      'fs.writeFileSync(path.join(outdir, path.basename(source).replace(/\\.[^.]+$/, ".html")), html);',
    ].join('\n'),
  );
  await fs.chmod(fakeOffice, 0o755);

  const { store, db, config } = await createStore({ officeConverterBin: fakeOffice });
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  t.after(() => fs.rm(config.dataDir, { recursive: true, force: true }));

  const page = await store.importBuffer({
    fileName: 'budget.xlsx',
    relativePath: 'clients/budget.xlsx',
    buffer: Buffer.from('xlsx-bytes'),
  });
  const generated = await store.readPageHtml(page);

  assert.equal(page.fileType, 'spreadsheet');
  assert.equal(page.mimeType, 'text/html; charset=utf-8');
  assert.equal(page.title, 'budget');
  assert.equal(page.directoryName, 'clients');
  assert.equal(page.fileName, 'budget.xlsx');
  assert.equal(page.editUrl, '');
  assert.match(page.url, /^\/[a-z0-9]{6}$/);
  assert.equal(path.dirname(page.generatedPath), config.generatedDir);
  assert.match(path.basename(page.generatedPath), new RegExp(`^\\d{8}-budget-${page.slug}\\.html$`));
  assert.match(generated, /class="sheet-app"/);
  assert.match(generated, /aria-label="TokDoc 表格阅读器"/);
  assert.match(generated, /class="sheet-toolbar"/);
  assert.match(generated, /class="sheet-formula"/);
  assert.match(generated, /class="sheet-tabs"/);
  assert.match(generated, /class="sheet-grid"/);
  assert.match(generated, /class="sheet-column-head">A<\/th>/);
  assert.match(generated, /class="sheet-column-head">B<\/th>/);
  assert.match(generated, /class="sheet-row-head">1<\/th>/);
  assert.match(generated, /data-sheet-address="A1"/);
  assert.match(generated, /工作表 1/);
  assert.match(generated, /表格阅读页/);
  assert.match(generated, /服务器/);
  assert.match(generated, /1800/);
  assert.doesNotMatch(generated, /body\{display:none\}/);
  assert.doesNotMatch(generated, /<script>alert\(3\)<\/script>/);
  assert.doesNotMatch(generated, /javascript:alert/);
  assert.doesNotMatch(generated, /onclick=/);
});

test('imports uploaded office-like documents by converting them to readable PDF assets', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokdoc-office-'));
  const fakeOffice = path.join(dataDir, 'fake-soffice.mjs');
  const fakeOfficeLog = path.join(dataDir, 'fake-office.log');
  await fs.writeFile(
    fakeOffice,
    [
      '#!/usr/bin/env node',
      'import fs from "node:fs";',
      'import path from "node:path";',
      'const outdir = process.argv[process.argv.indexOf("--outdir") + 1];',
      'const convertTo = process.argv[process.argv.indexOf("--convert-to") + 1];',
      'const source = process.argv.at(-1);',
      'if (process.env.TOKDOC_FAKE_OFFICE_LOG) fs.appendFileSync(process.env.TOKDOC_FAKE_OFFICE_LOG, JSON.stringify({ convertTo, source: path.basename(source) }) + "\\n");',
      'fs.mkdirSync(outdir, { recursive: true });',
      'if (convertTo === "html") {',
      '  fs.writeFileSync(path.join(outdir, "word-image.png"), "image-bytes");',
      '  const output = path.join(outdir, path.basename(source).replace(/\\.[^.]+$/, ".html"));',
      '  fs.writeFileSync(output, `<!doctype html><html><head><style>p{color:#111}</style></head><body><h1>Word 标题</h1><p>converted:${path.basename(source)}</p><img src="word-image.png"></body></html>`);',
      '} else {',
      '  const output = path.join(outdir, path.basename(source).replace(/\\.[^.]+$/, ".pdf"));',
      '  fs.writeFileSync(output, `%PDF-1.4\\nconverted:${path.basename(source)}\\nfilter:${convertTo}\\n`);',
      '}',
    ].join('\n'),
  );
  await fs.chmod(fakeOffice, 0o755);
  const previousLog = process.env.TOKDOC_FAKE_OFFICE_LOG;
  process.env.TOKDOC_FAKE_OFFICE_LOG = fakeOfficeLog;

  const { store, db, config } = await createStore({ officeConverterBin: fakeOffice });
  t.after(() => db.close());
  t.after(() => {
    if (previousLog == null) delete process.env.TOKDOC_FAKE_OFFICE_LOG;
    else process.env.TOKDOC_FAKE_OFFICE_LOG = previousLog;
  });
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  t.after(() => fs.rm(config.dataDir, { recursive: true, force: true }));

  const wordPage = await store.importBuffer({
    fileName: 'contract.docx',
    relativePath: 'clients/contract.docx',
    buffer: Buffer.from('contract.docx-bytes'),
  });
  const wordHtml = await store.readPageHtml(wordPage);
  assert.equal(wordPage.fileType, 'word');
  assert.equal(wordPage.mimeType, 'text/html; charset=utf-8');
  assert.equal(wordPage.title, 'contract');
  assert.equal(wordPage.directoryName, 'clients');
  assert.equal(wordPage.fileName, 'contract.docx');
  assert.match(wordPage.editUrl, /^\/[a-z0-9]{6}\?edit=1$/);
  assert.equal(path.dirname(wordPage.generatedPath), config.generatedDir);
  assert.match(path.basename(wordPage.generatedPath), new RegExp(`^\\d{8}-contract-${wordPage.slug}\\.html$`));
  assert.match(wordHtml, /class="tokdoc-word-shell"/);
  assert.match(wordHtml, /Word 标题/);
  assert.match(wordHtml, /converted:contract\.docx/);
  assert.match(wordHtml, /src="\/page-assets\/[^"]+\/word-image\.png"/);
  await fs.access(path.join(path.dirname(wordPage.sourcePath), `${path.basename(wordPage.generatedPath, '.html')}-assets`, 'word-image.png'));

  const cases = [
    ['deck.pptx', 'presentation', 'pdf:impress_pdf_Export'],
    ['slides.key', 'keynote', 'pdf:impress_pdf_Export'],
  ];

  for (const [fileName, fileType, expectedFilter] of cases) {
    const page = await store.importBuffer({
      fileName,
      relativePath: `clients/${fileName}`,
      buffer: Buffer.from(`${fileName}-bytes`),
    });
    const generated = await store.readPageFile(page);
    const title = path.basename(fileName).replace(/\.[^.]+$/, '');

    assert.equal(page.fileType, fileType);
    assert.equal(page.mimeType, 'application/pdf');
    assert.equal(page.title, title);
    assert.equal(page.directoryName, 'clients');
    assert.equal(page.fileName, fileName);
    assert.equal(path.dirname(page.generatedPath), config.generatedDir);
    assert.match(path.basename(page.generatedPath), new RegExp(`^\\d{8}-${title}-${page.slug}\\.pdf$`));
    assert.match(generated.toString('utf8'), new RegExp(`^%PDF-1\\.4\\nconverted:${fileName}\\nfilter:${expectedFilter}`));
  }

  const calls = (await fs.readFile(fakeOfficeLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(
    calls.map((call) => [call.source, call.convertTo]),
    [['contract.docx', 'html'], ...cases.map(([fileName, , expectedFilter]) => [fileName, expectedFilter])],
  );
});

test('does not insert confirmed uploads when document conversion fails', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokdoc-office-fail-'));
  const fakeOffice = path.join(dataDir, 'fake-soffice-fail.mjs');
  await fs.writeFile(
    fakeOffice,
    ['#!/usr/bin/env node', 'console.error("conversion failed intentionally");', 'process.exit(9);'].join('\n'),
  );
  await fs.chmod(fakeOffice, 0o755);

  const { store, db, config } = await createStore({ officeConverterBin: fakeOffice });
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  t.after(() => fs.rm(config.dataDir, { recursive: true, force: true }));

  const staged = await store.stageUploadFiles([
    {
      fileName: 'broken-deck.pptx',
      relativePath: 'uploads/broken-deck.pptx',
      buffer: Buffer.from('pptx-bytes'),
    },
  ]);

  assert.equal(staged.documents.length, 1);
  assert.equal(staged.documents[0].fileType, 'presentation');
  await assert.rejects(
    () =>
      store.confirmStagedUpload(staged.uploadId, {
        documents: [{ id: staged.documents[0].id, title: '无法转换', fileName: 'broken-deck.pptx' }],
      }),
    (error) => error.code === 'DOCUMENT_CONVERSION_FAILED',
  );
  assert.equal(store.listPages().length, 0);
});

test('rolls back earlier batch records when a later document conversion fails', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokdoc-batch-fail-'));
  const fakeOffice = path.join(dataDir, 'fake-soffice-fail.mjs');
  await fs.writeFile(
    fakeOffice,
    ['#!/usr/bin/env node', 'console.error("conversion failed intentionally");', 'process.exit(9);'].join('\n'),
  );
  await fs.chmod(fakeOffice, 0o755);

  const { store, db, config } = await createStore({ officeConverterBin: fakeOffice });
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  t.after(() => fs.rm(config.dataDir, { recursive: true, force: true }));

  await assert.rejects(
    () =>
      store.importUploadFiles([
        {
          fileName: 'ok.html',
          relativePath: 'batch/ok.html',
          buffer: Buffer.from('<!doctype html><html><head><title>先成功</title></head><body><h1>先成功</h1></body></html>'),
        },
        {
          fileName: 'broken-deck.pptx',
          relativePath: 'batch/broken-deck.pptx',
          buffer: Buffer.from('pptx-bytes'),
        },
      ]),
    (error) => error.code === 'DOCUMENT_CONVERSION_FAILED',
  );

  assert.equal(store.listPages().length, 0);
  assert.deepEqual(await fs.readdir(config.generatedDir), []);
  assert.deepEqual(await fs.readdir(config.uploadsDir), []);
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

test('stages uploads without inserting pages until confirmed and allows metadata edits', async (t) => {
  const { store, db, dataDir, config } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const staged = await store.stageUploadFiles([
    {
      fileName: 'index.html',
      relativePath: 'launch/index.html',
      buffer: Buffer.from('<!doctype html><html><head><title>原始标题</title></head><body><h1>原始标题</h1><img src="assets/logo.png"></body></html>'),
    },
    {
      fileName: 'logo.png',
      relativePath: 'launch/assets/logo.png',
      buffer: Buffer.from('logo-bytes'),
    },
  ]);

  assert.equal(store.listPages().length, 0);
  assert.equal(staged.documents.length, 1);
  assert.equal(staged.assetCount, 1);
  assert.equal(staged.documents[0].title, '原始标题');
  assert.equal(staged.documents[0].visibility, 'public');
  await fs.access(path.join(config.dataDir, 'pending-uploads', staged.uploadId, 'launch', 'index.html'));
  await assert.rejects(() => fs.access(path.join(config.uploadsDir, '.pending', staged.uploadId, 'launch', 'index.html')));

  const confirmed = await store.confirmStagedUpload(staged.uploadId, {
    documents: [
      {
        id: staged.documents[0].id,
        title: '确认后的标题',
        fileName: 'campaign-final.html',
        visibility: 'private',
      },
    ],
  });

  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0].title, '确认后的标题');
  assert.equal(confirmed[0].fileName, 'campaign-final.html');
  assert.equal(confirmed[0].visibility, 'private');
  assert.equal(confirmed[0].directoryName, 'launch');
  assert.match(path.basename(confirmed[0].generatedPath), new RegExp(`^\\d{8}-campaign-final-${confirmed[0].slug}\\.html$`));
  assert.match(await store.readPageHtml(confirmed[0]), /<base data-tokdoc-base href="\/page-assets\/[^/]+\/launch\/">/);
  assert.equal(store.listPages().length, 1);
  await assert.rejects(() => store.confirmStagedUpload(staged.uploadId, {}), /Upload batch not found/);
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

test('autosaves generated Markdown and Word HTML documents', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokdoc-edit-docs-'));
  const fakeOffice = path.join(dataDir, 'fake-soffice-word-html.mjs');
  await fs.writeFile(
    fakeOffice,
    [
      '#!/usr/bin/env node',
      'import fs from "node:fs";',
      'import path from "node:path";',
      'const outdir = process.argv[process.argv.indexOf("--outdir") + 1];',
      'const source = process.argv.at(-1);',
      'fs.mkdirSync(outdir, { recursive: true });',
      'fs.writeFileSync(path.join(outdir, path.basename(source).replace(/\\.[^.]+$/, ".html")), "<!doctype html><html><body><h1>Word 原文</h1><p>转换内容</p></body></html>");',
    ].join('\n'),
  );
  await fs.chmod(fakeOffice, 0o755);

  const { store, db, config } = await createStore({ officeConverterBin: fakeOffice });
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  t.after(() => fs.rm(config.dataDir, { recursive: true, force: true }));

  const markdownPage = await store.importBuffer({
    fileName: 'notes.md',
    relativePath: 'docs/notes.md',
    buffer: Buffer.from('# Markdown 原文\n\n段落内容'),
  });
  const savedMarkdown = await store.savePageContent(markdownPage.id, {
    revision: markdownPage.revision,
    html: '<!doctype html><html><head><title>Markdown 新标题</title></head><body><main><h1>Markdown 新标题</h1><p>已在线修改</p></main></body></html>',
  });
  assert.equal(savedMarkdown.fileType, 'markdown');
  assert.equal(savedMarkdown.revision, 2);
  assert.equal(savedMarkdown.edited, true);
  assert.match(await store.readPageHtml(savedMarkdown), /已在线修改/);

  const wordPage = await store.importBuffer({
    fileName: 'brief.docx',
    relativePath: 'docs/brief.docx',
    buffer: Buffer.from('docx-bytes'),
  });
  const savedWord = await store.savePageContent(wordPage.id, {
    revision: wordPage.revision,
    html: '<!doctype html><html><head><title>Word 新标题</title></head><body><main><h1>Word 新标题</h1><p>已在线修改 Word</p></main></body></html>',
  });
  assert.equal(savedWord.fileType, 'word');
  assert.equal(savedWord.mimeType, 'text/html; charset=utf-8');
  assert.equal(savedWord.revision, 2);
  assert.equal(savedWord.edited, true);
  assert.match(await store.readPageHtml(savedWord), /已在线修改 Word/);
});

test('saves Markdown source editor changes and regenerates the readable page', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const [page] = await store.importUploadFiles([
    {
      fileName: 'guide.md',
      relativePath: 'bundle/docs/guide.md',
      buffer: Buffer.from('# 原始标题\n\n![图](images/logo.png)\n\n原始段落'),
    },
    {
      fileName: 'logo.png',
      relativePath: 'bundle/docs/images/logo.png',
      buffer: Buffer.from('image-bytes'),
    },
  ]);
  const source = await store.readMarkdownSource(page.id);
  assert.equal(source.markdown, '# 原始标题\n\n![图](images/logo.png)\n\n原始段落');
  assert.equal(source.sourceOutOfSync, false);
  assert.match(await store.readPageHtml(page), /<base data-tokdoc-base href="\/page-assets\/[^"]+\/bundle\/docs\/">/);

  const saved = await store.saveMarkdownSource(page.id, {
    revision: page.revision,
    reason: 'manual-source',
    markdown: '# 新源码标题\n\n这是 **编辑器修改** 后的正文。\n\n![图](images/logo.png)',
  });

  assert.equal(saved.title, '新源码标题');
  assert.equal(saved.revision, 2);
  assert.equal(saved.edited, true);
  assert.equal(store.listVersions(page.id).length, 1);
  assert.equal(await fs.readFile(page.sourcePath, 'utf8'), '# 新源码标题\n\n这是 **编辑器修改** 后的正文。\n\n![图](images/logo.png)');
  const html = await store.readPageHtml(saved);
  assert.match(html, /<h1>新源码标题<\/h1>/);
  assert.match(html, /<strong>编辑器修改<\/strong>/);
  assert.match(html, /<base data-tokdoc-base href="\/page-assets\/[^"]+\/bundle\/docs\/">/);
  assert.equal((await store.readMarkdownSource(page.id)).sourceOutOfSync, false);

  await assert.rejects(
    () =>
      store.saveMarkdownSource(page.id, {
        revision: page.revision,
        markdown: '# 旧版本提交',
      }),
    /Revision conflict/,
  );
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

test('builds a public page list with type filters and public-only fields', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const htmlPage = await store.importBuffer({
    fileName: 'public-html.html',
    relativePath: 'docs/public-html.html',
    buffer: Buffer.from('<!doctype html><html><head><title>公开 HTML</title></head><body><h1>公开 HTML</h1></body></html>'),
  });
  const pdfPage = await store.importBuffer({
    fileName: 'public-pdf.pdf',
    relativePath: 'docs/public-pdf.pdf',
    buffer: Buffer.from('%PDF-1.4\npublic pdf\n'),
  });
  const privatePage = await store.importBuffer({
    fileName: 'private-html.html',
    relativePath: 'docs/private-html.html',
    buffer: Buffer.from('<!doctype html><html><head><title>私有 HTML</title></head><body><h1>私有 HTML</h1></body></html>'),
    visibility: 'private',
  });
  const trashed = await store.importBuffer({
    fileName: 'trashed.html',
    relativePath: 'trash/trashed.html',
    buffer: Buffer.from('<!doctype html><html><head><title>不公开</title></head><body><h1>不公开</h1></body></html>'),
  });
  await store.deletePage(trashed.id);
  store.incrementAccessCount(htmlPage.id);
  store.incrementAccessCount(htmlPage.id);

  const all = store.listPublicPagesPage();
  assert.equal(all.pages.length, 2);
  assert.equal(all.pagination.pageSize, 10);
  assert.deepEqual(all.stats, { all: 2, html: 1, markdown: 0, pdf: 1, word: 0, presentation: 0, keynote: 0, spreadsheet: 0 });
  assert.equal(all.pages.some((page) => page.slug === privatePage.slug), false);
  assert.equal(all.pages[0].url.startsWith('/'), true);
  assert.equal(Object.hasOwn(all.pages[0], 'id'), false);
  assert.equal(Object.hasOwn(all.pages[0], 'sourcePath'), false);
  assert.equal(Object.hasOwn(all.pages[0], 'generatedPath'), false);
  assert.equal(Object.hasOwn(all.pages[0], 'editUrl'), false);
  assert.equal(Object.hasOwn(all.pages[0], 'downloadUrl'), false);
  assert.equal(Object.hasOwn(all.pages[0], 'revision'), false);
  assert.equal(Object.hasOwn(all.pages[0], 'visibility'), false);

  const privateList = store.listPages({ visibility: 'private' });
  assert.equal(privateList.length, 1);
  assert.equal(privateList[0].slug, privatePage.slug);

  const html = store.listPublicPagesPage({ type: 'html' });
  assert.equal(html.pages.length, 1);
  assert.equal(html.pages[0].fileType, 'html');
  assert.equal(Object.hasOwn(html.pages[0], 'accessCount'), false);
  assert.equal(Object.hasOwn(html.pages[0], 'downloadCount'), false);

  const pdf = store.listPublicPagesPage({ type: 'pdf' });
  assert.equal(pdf.pages.length, 1);
  assert.equal(pdf.pages[0].fileType, 'pdf');

  db.prepare('UPDATE pages SET updated_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', htmlPage.id);
  db.prepare('UPDATE pages SET updated_at = ? WHERE id = ?').run('2026-01-02T00:00:00.000Z', pdfPage.id);
  const blockedAccessSort = store.listPublicPagesPage({ sort: 'access_desc' });
  assert.equal(blockedAccessSort.pages[0].slug, pdfPage.slug);
});

test('paginates the public document list with a default page size of 10', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  for (let index = 1; index <= 12; index += 1) {
    await store.importBuffer({
      fileName: `public-${String(index).padStart(2, '0')}.html`,
      relativePath: `public-${String(index).padStart(2, '0')}.html`,
      buffer: Buffer.from(`<!doctype html><html><head><title>公开文档 ${index}</title></head><body><h1>公开文档 ${index}</h1></body></html>`),
    });
  }

  const firstPage = store.listPublicPagesPage();
  const secondPage = store.listPublicPagesPage({ page: 2 });

  assert.equal(firstPage.pages.length, 10);
  assert.equal(firstPage.pagination.pageSize, 10);
  assert.equal(firstPage.pagination.total, 12);
  assert.equal(firstPage.pagination.totalPages, 2);
  assert.equal(secondPage.pages.length, 2);
  assert.equal(secondPage.pagination.page, 2);
});

test('stores the public homepage setting with an enabled default', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  assert.equal(store.getSettings().publicHomepageEnabled, true);
  await store.saveSettings({ publicHomepageEnabled: false });
  assert.equal(store.getSettings().publicHomepageEnabled, false);
  await store.saveSettings({ publicHomepageEnabled: true });
  assert.equal(store.getSettings().publicHomepageEnabled, true);
});

test('builds management analytics without mutating document records', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const htmlPage = await store.importBuffer({
    fileName: 'analytics-html.html',
    relativePath: 'reports/analytics-html.html',
    buffer: Buffer.from('<!doctype html><html><head><title>分析 HTML</title></head><body><h1>分析 HTML</h1></body></html>'),
  });
  const pdfPage = await store.importBuffer({
    fileName: 'analytics-pdf.pdf',
    relativePath: 'pdf/analytics-pdf.pdf',
    buffer: Buffer.from('%PDF-1.4\nanalytics pdf\n'),
  });
  await store.importBuffer({
    fileName: 'private-markdown.md',
    relativePath: 'notes/private-markdown.md',
    buffer: Buffer.from('# 私有 Markdown\n\n用于分析。'),
    visibility: 'private',
  });
  const trashPage = await store.importBuffer({
    fileName: 'analytics-trash.html',
    relativePath: 'trash/analytics-trash.html',
    buffer: Buffer.from('<!doctype html><html><head><title>分析回收站</title></head><body><h1>分析回收站</h1></body></html>'),
  });
  await store.deletePage(trashPage.id);

  store.incrementAccessCount(htmlPage.id);
  store.incrementAccessCount(htmlPage.id);
  store.incrementAccessCount(pdfPage.id);
  store.incrementDownloadCount(htmlPage.id);
  store.incrementDownloadCount(pdfPage.id);
  store.incrementDownloadCount(pdfPage.id);
  db.prepare('UPDATE pages SET edited = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), htmlPage.id);

  const beforeCount = db.prepare('SELECT COUNT(*) AS count FROM pages').get().count;
  const analytics = store.getAnalytics();
  const afterCount = db.prepare('SELECT COUNT(*) AS count FROM pages').get().count;

  assert.equal(beforeCount, afterCount);
  assert.equal(analytics.summary.activeDocuments, 3);
  assert.equal(analytics.summary.publicDocuments, 2);
  assert.equal(analytics.summary.privateDocuments, 1);
  assert.equal(analytics.summary.trashDocuments, 1);
  assert.equal(analytics.summary.editableDocuments, 2);
  assert.equal(analytics.summary.totalAccess, 3);
  assert.equal(analytics.summary.totalDownloads, 3);
  assert.equal(analytics.trend.length, 14);
  assert.deepEqual(Object.keys(analytics.trend[0]).sort(), ['key', 'label', 'updates', 'uploads']);
  assert.equal(analytics.byType.find((item) => item.type === 'html').count, 1);
  assert.equal(analytics.byType.find((item) => item.type === 'html').access, 2);
  assert.equal(analytics.byType.find((item) => item.type === 'pdf').downloads, 2);
  assert.equal(analytics.status.find((item) => item.key === 'edited').count, 1);
  assert.equal(analytics.status.find((item) => item.key === 'trash').count, 1);
  assert.equal(analytics.topAccess.length, 2);
  assert.equal(analytics.topDownloads.length, 2);
  assert.equal(analytics.topAccess[0].slug, htmlPage.slug);
  assert.equal(analytics.topDownloads[0].slug, pdfPage.slug);
  assert.equal(analytics.topAccess.some((item) => item.fileName === 'private-markdown.md'), false);
  assert.equal(analytics.topDownloads.some((item) => item.fileName === 'private-markdown.md'), false);
});

test('tracks page access and download counts for generated HTML views', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const page = await store.importBuffer({
    fileName: 'view-count.html',
    relativePath: 'view-count.html',
    buffer: Buffer.from('<!doctype html><html><head><title>访问统计</title></head><body><h1>访问统计</h1></body></html>'),
  });

  assert.equal(page.accessCount, 0);
  assert.equal(page.downloadCount, 0);
  assert.equal(store.incrementAccessCount(page.id).accessCount, 1);
  assert.equal(store.incrementAccessCount(page.id).accessCount, 2);
  assert.equal(store.getPage(page.id).accessCount, 2);
  assert.equal(store.incrementDownloadCount(page.id).downloadCount, 1);
  assert.equal(store.incrementDownloadCount(page.id).downloadCount, 2);
  assert.equal(store.getPage(page.id).downloadCount, 2);
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
