import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const indexPath = path.resolve('public/index.html');

test('keeps the page list full width and moves watch directories into settings', async () => {
  const html = await fs.readFile(indexPath, 'utf8');
  const contentArea = html.match(/<section class="content-area"[\s\S]*?<\/section>/)?.[0] || '';
  const overview = html.match(/<section class="overview"[\s\S]*?<section class="content-area"/)?.[0] || '';
  const sideSummary = overview.match(/<aside class="panel side-summary"[\s\S]*?<\/aside>/)?.[0] || '';
  const settingsDrawer = html.match(/<div class="drawer-backdrop" id="settingsBackdrop"[\s\S]*?<div class="modal-backdrop" id="previewBackdrop"/)?.[0] || '';

  assert.match(contentArea, /class="panel table-panel"/);
  assert.doesNotMatch(contentArea, /class="inspector"/);
  assert.doesNotMatch(sideSummary, /id="watchList"/);
  assert.doesNotMatch(sideSummary, /class="side-watch"/);
  assert.doesNotMatch(sideSummary, /读取文件/);
  assert.doesNotMatch(sideSummary, /解析元信息/);
  assert.match(settingsDrawer, /id="watchList"/);
  assert.match(settingsDrawer, /id="addWatchDirectory"/);
  assert.match(settingsDrawer, /登录用户名/);
  assert.match(settingsDrawer, /登录密码/);
  assert.match(settingsDrawer, /后台访问目录/);
  assert.match(settingsDrawer, /id="adminPathInput"/);
  assert.match(settingsDrawer, /id="currentPasswordInput"/);
  assert.match(settingsDrawer, /线上绑定/);
  assert.match(settingsDrawer, /id="remoteSyncEnabledInput"/);
  assert.match(settingsDrawer, /id="remoteSyncUrlInput"/);
  assert.match(settingsDrawer, /id="remoteSyncTokenInput"/);
  assert.match(html, /id="loginBackdrop"/);
  assert.match(html, /TokDoc 本地文档管理器/);
  assert.match(html, /TokDoc 登录/);
  assert.doesNotMatch(html, /tokhtml 登录/);
  assert.match(html, /data-filter="trash"/);
  assert.match(html, /回收站/);
});

test('exposes PDF and Word document upload affordances in the manager UI', async () => {
  const html = await fs.readFile(indexPath, 'utf8');

  assert.match(html, /上传 HTML、PDF 或 Word/);
  assert.match(html, /选择文件/);
  assert.match(html, /accept="\.html,\.htm,\.pdf,\.doc,\.docx,text\/html,application\/pdf"/);
  assert.match(html, /文档列表/);
  assert.match(html, /<th>类型<\/th>/);
  assert.match(html, /id="metaFileType"/);
  assert.match(html, /id="editFromPreview"/);
});
