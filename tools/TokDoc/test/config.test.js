import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

test('loads TokDoc defaults with new environment variable names', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokdoc-config-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const config = loadConfig({
    TOKDOC_DATA_DIR: dataDir,
    TOKDOC_WATCH_DIRS: path.join(dataDir, 'watch-a'),
    TOKDOC_ALLOW_SOURCE_WRITE: 'true',
    TOKDOC_SOFFICE_BIN: '/usr/bin/soffice',
    HOST: '0.0.0.0',
    PORT: '18082',
  });

  assert.equal(config.name, 'tokdoc');
  assert.equal(config.dataDir, dataDir);
  assert.equal(config.dbPath, path.join(dataDir, 'tokdoc.db'));
  assert.deepEqual(config.watchDirs, [path.join(dataDir, 'watch-a')]);
  assert.equal(config.allowSourceWrite, true);
  assert.equal(config.officeConverterBin, '/usr/bin/soffice');
});

test('keeps legacy TokHtml env and database paths compatible', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokdoc-legacy-config-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'tokhtml.db'), '');

  const config = loadConfig({
    TOKHTML_DATA_DIR: dataDir,
    TOKHTML_WATCH_DIRS: path.join(dataDir, 'legacy-watch'),
    TOKHTML_ALLOW_SOURCE_WRITE: '1',
    TOKHTML_SOFFICE_BIN: '/legacy/soffice',
  });

  assert.equal(config.name, 'tokdoc');
  assert.equal(config.dataDir, dataDir);
  assert.equal(config.dbPath, path.join(dataDir, 'tokhtml.db'));
  assert.deepEqual(config.watchDirs, [path.join(dataDir, 'legacy-watch')]);
  assert.equal(config.allowSourceWrite, true);
  assert.equal(config.officeConverterBin, '/legacy/soffice');
});

test('auto-detects sibling TokHtml data directory left by a git rename', async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokdoc-root-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const tokdocRoot = path.join(rootDir, 'TokDoc');
  const legacyDataDir = path.join(rootDir, 'TokHtml', 'data');
  await fs.mkdir(path.join(tokdocRoot, 'data'), { recursive: true });
  await fs.mkdir(legacyDataDir, { recursive: true });
  await fs.writeFile(path.join(legacyDataDir, 'tokhtml.db'), '');

  const config = loadConfig({}, tokdocRoot);

  assert.equal(config.dataDir, legacyDataDir);
  assert.equal(config.dbPath, path.join(legacyDataDir, 'tokhtml.db'));
  assert.equal(config.uploadsDir, path.join(legacyDataDir, 'uploads'));
  assert.equal(config.generatedDir, path.join(legacyDataDir, 'pages'));
});
