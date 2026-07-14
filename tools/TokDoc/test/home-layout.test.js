import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const indexPath = path.resolve('public/index.html');
const publicIndexPath = path.resolve('public/index-public.html');
const publicAppPath = path.resolve('public/public-app.js');

test('keeps the page list full width and moves watch directories into settings', async () => {
  const html = await fs.readFile(indexPath, 'utf8');
  const contentArea = html.match(/<section class="content-area"[\s\S]*?<\/section>/)?.[0] || '';
  const overview = html.match(/<section class="overview"[\s\S]*?<section class="content-area"/)?.[0] || '';
  const sideSummary = overview.match(/<aside class="panel side-summary"[\s\S]*?<\/aside>/)?.[0] || '';
  const settingsPage = html.match(/<main class="workspace settings-page" id="settingsPage"[\s\S]*?<\/main>/)?.[0] || '';

  assert.match(contentArea, /class="panel table-panel"/);
  assert.doesNotMatch(contentArea, /class="inspector"/);
  assert.doesNotMatch(sideSummary, /id="watchList"/);
  assert.doesNotMatch(sideSummary, /class="side-watch"/);
  assert.doesNotMatch(sideSummary, /读取文件/);
  assert.doesNotMatch(sideSummary, /解析元信息/);
  assert.match(settingsPage, /id="watchList"/);
  assert.match(settingsPage, /id="addWatchDirectory"/);
  assert.match(settingsPage, /前台网站名称/);
  assert.match(settingsPage, /id="siteNameInput"/);
  assert.match(settingsPage, /后台名称/);
  assert.match(settingsPage, /id="adminNameInput"/);
  assert.match(settingsPage, /前台 SEO/);
  assert.match(settingsPage, /id="publicSeoTitleInput"/);
  assert.match(settingsPage, /id="publicSeoDescriptionInput"/);
  assert.match(settingsPage, /id="publicSeoKeywordsInput"/);
  assert.match(settingsPage, /登录用户名/);
  assert.match(settingsPage, /登录密码/);
  assert.match(settingsPage, /后台访问目录/);
  assert.match(settingsPage, /id="adminPathInput"/);
  assert.match(settingsPage, /id="currentPasswordInput"/);
  assert.match(settingsPage, /公开首页/);
  assert.match(settingsPage, /id="publicHomepageEnabledInput"/);
  assert.match(settingsPage, /线上绑定/);
  assert.match(settingsPage, /id="remoteSyncEnabledInput"/);
  assert.match(settingsPage, /id="remoteSyncUrlInput"/);
  assert.match(settingsPage, /id="remoteSyncTokenInput"/);
  assert.doesNotMatch(html, /id="settingsBackdrop"/);
  assert.match(html, /id="loginBackdrop"/);
  assert.match(html, /TokDoc 本地文档管理器/);
  assert.match(html, /TokDoc 登录/);
  assert.match(html, /id="openPublicHome"/);
  assert.match(html, /<a class="brand brand-link" id="adminHomeLink" href="\/admin" aria-label="返回后台首页">/);
  assert.match(html, /href="\/admin\/settings"/);
  assert.doesNotMatch(html, /tokhtml 登录/);
  assert.match(html, /data-filter="trash"/);
  assert.match(html, /回收站/);
});

test('exposes document upload affordances in the manager UI', async () => {
  const html = await fs.readFile(indexPath, 'utf8');

  assert.match(html, /上传 HTML、Markdown、PDF、Word、PPT、Keynote 或 Excel/);
  assert.match(html, /选择文件/);
  assert.match(html, /accept="\.html,\.htm,\.md,\.markdown,\.pdf,\.doc,\.docx,\.ppt,\.pptx,\.pptm,\.pps,\.ppsx,\.key,\.xls,\.xlsx,\.xlsm,\.xlsb,text\/html,text\/markdown,text\/x-markdown,application\/pdf"/);
  assert.match(html, /id="uploadBackdrop"/);
  assert.match(html, /id="uploadProgressBar"/);
  assert.match(html, /id="uploadReviewRows"/);
  assert.match(html, /id="confirmUpload"/);
  assert.match(html, /id="typeTabs"/);
  assert.match(html, /data-type="html"/);
  assert.match(html, /data-type="markdown"/);
  assert.match(html, /data-type="pdf"/);
  assert.match(html, /data-type="word"/);
  assert.match(html, /data-type="presentation"/);
  assert.match(html, /data-type="keynote"/);
  assert.match(html, /data-type="spreadsheet"/);
  assert.match(html, /aria-pressed="true" data-type="all"/);
  assert.doesNotMatch(html, /role="tablist"/);
  assert.doesNotMatch(html, /role="tab"/);
  assert.match(html, /\.type-tabs-panel\s*\{/);
  assert.match(html, /\.type-tabs\s*\{/);
  assert.match(html, /\.type-tabs button\.is-active\s*\{/);
  assert.match(html, /上传完成后确认名称，确认后写入列表和数据库/);
  assert.match(html, /文档列表/);
  assert.match(html, /<th>类型<\/th>/);
  assert.match(html, /<th>下载数<\/th>/);
  assert.match(html, /<th>访问数<\/th>/);
  assert.doesNotMatch(html, /<th>访问次数<\/th>/);
  assert.match(html, /<th>可见性<\/th>/);
  assert.match(html, /\.col-type\s*\{\s*width:\s*96px;/);
  assert.match(html, /\.col-time\s*\{\s*width:\s*92px;/);
  assert.match(html, /\.col-download\s*\{\s*width:\s*64px;/);
  assert.match(html, /\.type-cell\s*\{/);
  assert.match(html, /id="metaFileType"/);
  assert.match(html, /id="metaVisibility"/);
  assert.match(html, /id="editFromPreview"/);
});

test('defines a standalone public document index page', async () => {
  const html = await fs.readFile(publicIndexPath, 'utf8');

  assert.match(html, /TokDoc 文档索引/);
  assert.match(html, /id="typeTabs"/);
  assert.match(html, /data-type="html"/);
  assert.match(html, /data-type="markdown"/);
  assert.match(html, /data-type="pdf"/);
  assert.match(html, /data-type="word"/);
  assert.match(html, /data-type="presentation"/);
  assert.match(html, /data-type="keynote"/);
  assert.match(html, /data-type="spreadsheet"/);
  assert.match(html, /id="searchInput"/);
  assert.match(html, /id="sortSelect"/);
  assert.match(html, /id="docRows"/);
  assert.match(html, /id="docCards"/);
  assert.match(html, /https:\/\/github\.com\/yaojingang\/yao-open-tools\/tree\/main\/tools\/TokDoc/);
  assert.match(html, /开源地址/);
  assert.doesNotMatch(html, />访问次数</);
  assert.doesNotMatch(html, /访问最多/);
  assert.doesNotMatch(html, /access_desc/);
  assert.match(html, /\/assets\/public-app\.js/);
});

test('opens public documents in a new tab and defaults public pagination to 10', async () => {
  const script = await fs.readFile(publicAppPath, 'utf8');

  assert.match(script, /pageSize:\s*10/);
  assert.match(script, /target="_blank"/);
  assert.match(script, /rel="noopener noreferrer"/);
  assert.match(script, /window\.open\(row\.dataset\.url, '_blank', 'noopener,noreferrer'\)/);
  assert.doesNotMatch(script, /accessCount/);
  assert.doesNotMatch(script, /次访问/);
  assert.doesNotMatch(script, /access_desc/);
});

test('stages uploads with progress before confirming them into the page list', async () => {
  const html = await fs.readFile(indexPath, 'utf8');
  const script = await fs.readFile(path.resolve('public/app.js'), 'utf8');

  assert.match(script, /XMLHttpRequest/);
  assert.match(script, /\/api\/pages\/upload\/prepare/);
  assert.match(script, /\/api\/pages\/upload\/.*confirm/);
  assert.match(script, /uploadReviewDocuments/);
  assert.match(script, /data-upload-field="visibility"/);
  assert.match(script, /data-action="visibility"/);
  assert.match(script, /data-action="download"/);
  assert.match(script, /downloadCount/);
  assert.match(script, /\/api\/pages\/.*\/download/);
  assert.match(script, /typeTabs:\s*document\.querySelector\('#typeTabs'\)/);
  assert.match(script, /function renderTypeTabs\(\)/);
  assert.match(script, /querySelectorAll\('\[data-type\]'\)/);
  assert.match(script, /setAttribute\('aria-pressed'/);
  assert.match(script, /function captureListViewport\(\)/);
  assert.match(script, /function lockListViewport\(viewport\)/);
  assert.match(script, /function restoreListViewport\(viewport\)/);
  assert.match(script, /let loadDataRequestId = 0/);
  assert.match(script, /const requestId = \+\+loadDataRequestId/);
  assert.match(script, /if \(requestId !== loadDataRequestId\) return/);
  assert.match(script, /preserveScroll:\s*true/);
  assert.match(script, /focus\(\{\s*preventScroll:\s*true\s*\}\)/);
  assert.match(html, /\.table-wrap\s*\{[\s\S]*?min-height:\s*380px;/);
  assert.match(script, /确认入库/);
});
