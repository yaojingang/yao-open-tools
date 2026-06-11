import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildApp } from '../src/server.js';

async function createApp(overrides = {}) {
  const dataDir = overrides.dataDir || (await fs.mkdtemp(path.join(os.tmpdir(), 'tokdoc-auth-')));
  const config = {
    name: 'tokdoc',
    rootDir: dataDir,
    host: '127.0.0.1',
    port: 0,
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    generatedDir: path.join(dataDir, 'pages'),
    versionsDir: path.join(dataDir, 'versions'),
    publicDir: path.join(process.cwd(), 'public'),
    watchDirs: [path.join(dataDir, 'watch')],
    allowSourceWrite: false,
    ...overrides,
  };
  const app = await buildApp(config);
  return { app, dataDir, config };
}

function sessionCookie(response) {
  const cookie = response.headers['set-cookie'];
  const raw = Array.isArray(cookie) ? cookie[0] : cookie;
  return raw?.split(';')[0] || '';
}

function legacySessionCookie(response) {
  return sessionCookie(response).replace(/^tokdoc_session=/, 'tokhtml_session=');
}

test('requires login for management APIs and keeps a long-lived session cookie', async (t) => {
  const { app, dataDir } = await createApp();
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const root = await app.inject({ method: 'GET', url: '/' });
  assert.equal(root.statusCode, 200);
  assert.match(root.body, /TokDoc 文档索引/);

  const admin = await app.inject({ method: 'GET', url: '/admin' });
  assert.equal(admin.statusCode, 200);
  assert.match(admin.body, /TokDoc 登录/);

  const adminSettings = await app.inject({ method: 'GET', url: '/admin/settings' });
  assert.equal(adminSettings.statusCode, 200);
  assert.match(adminSettings.body, /id="settingsPage"/);

  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().name, 'tokdoc');

  const healthz = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(healthz.statusCode, 200);
  assert.equal(healthz.json().name, 'tokdoc');

  const denied = await app.inject({ method: 'GET', url: '/api/pages' });
  assert.equal(denied.statusCode, 401);

  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: 'admin', password: 'tokdoc' },
  });
  assert.equal(login.statusCode, 200);
  assert.match(String(login.headers['set-cookie']), /tokdoc_session=/);
  assert.match(String(login.headers['set-cookie']), /Max-Age=315360000/);

  const pages = await app.inject({ method: 'GET', url: '/api/pages', headers: { cookie: sessionCookie(login) } });
  assert.equal(pages.statusCode, 200);

  const legacyPages = await app.inject({ method: 'GET', url: '/api/pages', headers: { cookie: legacySessionCookie(login) } });
  assert.equal(legacyPages.statusCode, 200);

  const mixedCookiePages = await app.inject({
    method: 'GET',
    url: '/api/pages',
    headers: { cookie: `tokdoc_session=invalid; ${legacySessionCookie(login)}` },
  });
  assert.equal(mixedCookiePages.statusCode, 200);

  const logout = await app.inject({ method: 'POST', url: '/api/logout', headers: { cookie: sessionCookie(login) } });
  assert.equal(logout.statusCode, 200);
  const logoutCookies = String(logout.headers['set-cookie']);
  assert.match(logoutCookies, /tokdoc_session=.*Max-Age=0/);
  assert.match(logoutCookies, /tokhtml_session=.*Max-Age=0/);
});

test('uses initial login credentials for a fresh database without overriding existing settings', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokdoc-auth-initial-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const first = await createApp({
    dataDir,
    initialAuthUsername: 'owner',
    initialAuthPassword: 'first-secret',
  });
  const oldDefaultLogin = await first.app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: 'admin', password: 'tokdoc' },
  });
  assert.equal(oldDefaultLogin.statusCode, 401);

  const initialLogin = await first.app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: 'owner', password: 'first-secret' },
  });
  assert.equal(initialLogin.statusCode, 200);
  await first.app.close();

  const second = await createApp({
    dataDir,
    initialAuthUsername: 'other',
    initialAuthPassword: 'other-secret',
  });
  t.after(() => second.app.close());

  const existingLogin = await second.app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: 'owner', password: 'first-secret' },
  });
  assert.equal(existingLogin.statusCode, 200);

  const newInitialLogin = await second.app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: 'other', password: 'other-secret' },
  });
  assert.equal(newInitialLogin.statusCode, 401);
});

test('moves the management console and APIs under a custom admin path', async (t) => {
  const { app, dataDir } = await createApp();
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const login = await app.inject({
    method: 'POST',
    url: '/admin/api/login',
    payload: { username: 'admin', password: 'tokdoc' },
  });
  assert.equal(login.statusCode, 200);
  const cookie = sessionCookie(login);

  const missingPassword = await app.inject({
    method: 'PATCH',
    url: '/admin/api/settings',
    headers: { cookie },
    payload: { adminPath: '/tok-ops' },
  });
  assert.equal(missingPassword.statusCode, 400);
  assert.match(missingPassword.json().error, /当前密码/);

  const reservedPath = await app.inject({
    method: 'PATCH',
    url: '/admin/api/settings',
    headers: { cookie },
    payload: { adminPath: '/api', currentPassword: 'tokdoc' },
  });
  assert.equal(reservedPath.statusCode, 400);

  const reservedPublicPath = await app.inject({
    method: 'PATCH',
    url: '/admin/api/settings',
    headers: { cookie },
    payload: { adminPath: '/public', currentPassword: 'tokdoc' },
  });
  assert.equal(reservedPublicPath.statusCode, 400);

  const reservedTypePath = await app.inject({
    method: 'PATCH',
    url: '/admin/api/settings',
    headers: { cookie },
    payload: { adminPath: '/type', currentPassword: 'tokdoc' },
  });
  assert.equal(reservedTypePath.statusCode, 400);

  const saved = await app.inject({
    method: 'PATCH',
    url: '/admin/api/settings',
    headers: { cookie },
    payload: { adminPath: '/tok-ops', currentPassword: 'tokdoc' },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().settings.adminPath, '/tok-ops');

  const hiddenRoot = await app.inject({ method: 'GET', url: '/' });
  assert.equal(hiddenRoot.statusCode, 200);
  assert.match(hiddenRoot.body, /TokDoc 文档索引/);

  const oldAdmin = await app.inject({ method: 'GET', url: '/admin' });
  assert.equal(oldAdmin.statusCode, 404);

  const oldAdminSettings = await app.inject({ method: 'GET', url: '/admin/settings' });
  assert.equal(oldAdminSettings.statusCode, 404);

  const oldLogin = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: 'admin', password: 'tokdoc' },
  });
  assert.equal(oldLogin.statusCode, 404);

  const oldApi = await app.inject({ method: 'GET', url: '/api/pages', headers: { cookie } });
  assert.equal(oldApi.statusCode, 404);

  const customAdmin = await app.inject({ method: 'GET', url: '/tok-ops' });
  assert.equal(customAdmin.statusCode, 200);
  assert.match(customAdmin.body, /TokDoc 登录/);

  const customSettings = await app.inject({ method: 'GET', url: '/tok-ops/settings' });
  assert.equal(customSettings.statusCode, 200);
  assert.match(customSettings.body, /id="settingsPage"/);

  const customLogin = await app.inject({
    method: 'POST',
    url: '/tok-ops/api/login',
    payload: { username: 'admin', password: 'tokdoc' },
  });
  assert.equal(customLogin.statusCode, 200);
  const customCookie = sessionCookie(customLogin);

  const customPages = await app.inject({ method: 'GET', url: '/tok-ops/api/pages', headers: { cookie: customCookie } });
  assert.equal(customPages.statusCode, 200);

  const page = await app.store.importBuffer({
    fileName: 'custom-admin-page.html',
    relativePath: 'custom-admin-page.html',
    buffer: Buffer.from('<!doctype html><html><head><title>自定义后台</title></head><body><h1>自定义后台</h1></body></html>'),
  });

  const publicView = await app.inject({ method: 'GET', url: page.url });
  assert.equal(publicView.statusCode, 200);
  assert.match(publicView.body, /自定义后台/);

  const editView = await app.inject({ method: 'GET', url: `${page.url}?edit=1`, headers: { cookie: customCookie } });
  assert.equal(editView.statusCode, 200);
  assert.match(editView.body, new RegExp(`/tok-ops/api/pages/${page.id}/content`));
  assert.match(editView.body, /href="\/tok-ops"/);
});

test('serves a public document index and filters public API fields without login', async (t) => {
  const { app, dataDir } = await createApp();
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const htmlPage = await app.store.importBuffer({
    fileName: 'public-index-html.html',
    relativePath: 'docs/public-index-html.html',
    buffer: Buffer.from('<!doctype html><html><head><title>公开索引 HTML</title></head><body><h1>公开索引 HTML</h1></body></html>'),
  });
  const pdfPage = await app.store.importBuffer({
    fileName: 'public-index-pdf.pdf',
    relativePath: 'pdf/public-index-pdf.pdf',
    buffer: Buffer.from('%PDF-1.4\npublic index pdf\n'),
  });
  const privatePage = await app.store.importBuffer({
    fileName: 'private-index-html.html',
    relativePath: 'docs/private-index-html.html',
    buffer: Buffer.from('<!doctype html><html><head><title>私有索引 HTML</title></head><body><h1>私有索引 HTML</h1></body></html>'),
    visibility: 'private',
  });
  const trashPage = await app.store.importBuffer({
    fileName: 'public-index-trash.html',
    relativePath: 'trash/public-index-trash.html',
    buffer: Buffer.from('<!doctype html><html><head><title>公开索引回收站</title></head><body><h1>公开索引回收站</h1></body></html>'),
  });
  await app.store.deletePage(trashPage.id);

  const publicHome = await app.inject({ method: 'GET', url: '/' });
  assert.equal(publicHome.statusCode, 200);
  assert.match(publicHome.body, /id="typeTabs"/);
  assert.match(publicHome.body, /\/assets\/public-app\.js/);

  const typePage = await app.inject({ method: 'GET', url: '/type/html' });
  assert.equal(typePage.statusCode, 200);
  assert.match(typePage.body, /TokDoc 文档索引/);

  const publicApi = await app.inject({ method: 'GET', url: '/public/api/pages' });
  assert.equal(publicApi.statusCode, 200);
  const body = publicApi.json();
  assert.equal(body.pagination.total, 2);
  assert.deepEqual(body.stats, { all: 2, html: 1, pdf: 1, word: 0 });
  assert.equal(body.pages.some((page) => page.slug === htmlPage.slug), true);
  assert.equal(body.pages.some((page) => page.slug === pdfPage.slug), true);
  assert.equal(body.pages.some((page) => page.slug === privatePage.slug), false);
  assert.equal(body.pages.some((page) => page.slug === trashPage.slug), false);
  assert.equal(Object.hasOwn(body.pages[0], 'id'), false);
  assert.equal(Object.hasOwn(body.pages[0], 'sourcePath'), false);
  assert.equal(Object.hasOwn(body.pages[0], 'generatedPath'), false);
  assert.equal(Object.hasOwn(body.pages[0], 'editUrl'), false);
  assert.equal(Object.hasOwn(body.pages[0], 'canEdit'), false);
  assert.equal(Object.hasOwn(body.pages[0], 'revision'), false);
  assert.equal(Object.hasOwn(body.pages[0], 'visibility'), false);

  const htmlApi = await app.inject({ method: 'GET', url: '/public/api/pages?type=html' });
  assert.equal(htmlApi.statusCode, 200);
  assert.equal(htmlApi.json().pages.length, 1);
  assert.equal(htmlApi.json().pages[0].fileType, 'html');

  const searched = await app.inject({ method: 'GET', url: '/public/api/pages?q=PDF' });
  assert.equal(searched.statusCode, 200);
  assert.equal(searched.json().pages.length, 1);
  assert.equal(searched.json().pages[0].slug, pdfPage.slug);
});

test('can disable the public homepage while keeping document short links available', async (t) => {
  const { app, dataDir } = await createApp();
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const page = await app.store.importBuffer({
    fileName: 'public-disabled.html',
    relativePath: 'public-disabled.html',
    buffer: Buffer.from('<!doctype html><html><head><title>公开关闭后短链</title></head><body><h1>公开关闭后短链</h1></body></html>'),
  });
  await app.store.saveSettings({ publicHomepageEnabled: false });

  const publicHome = await app.inject({ method: 'GET', url: '/' });
  assert.equal(publicHome.statusCode, 404);

  const publicApi = await app.inject({ method: 'GET', url: '/public/api/pages' });
  assert.equal(publicApi.statusCode, 404);

  const shortLink = await app.inject({ method: 'GET', url: page.url });
  assert.equal(shortLink.statusCode, 200);
  assert.match(shortLink.body, /公开关闭后短链/);
});

test('allows public generated page views but protects edit mode', async (t) => {
  const { app, dataDir } = await createApp();
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const page = await app.store.importBuffer({
    fileName: 'public-page.html',
    relativePath: 'public-page.html',
    buffer: Buffer.from('<!doctype html><html><head><title>公开页面</title></head><body><h1>公开页面</h1></body></html>'),
  });

  const publicView = await app.inject({ method: 'GET', url: page.url });
  assert.equal(publicView.statusCode, 200);
  assert.match(publicView.body, /公开页面/);
  assert.match(page.url, /^\/[a-z0-9]{6}$/);

  const legacyPublicView = await app.inject({ method: 'GET', url: `/pages/${page.slug}.html` });
  assert.equal(legacyPublicView.statusCode, 200);
  assert.match(legacyPublicView.body, /公开页面/);

  const editDenied = await app.inject({ method: 'GET', url: `${page.url}?edit=1` });
  assert.equal(editDenied.statusCode, 401);

  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: 'admin', password: 'tokdoc' },
  });
  const editAllowed = await app.inject({ method: 'GET', url: `${page.url}?edit=1`, headers: { cookie: sessionCookie(login) } });
  assert.equal(editAllowed.statusCode, 200);
  assert.match(editAllowed.body, /tokdoc/);
});

test('hides private documents from the public frontend while allowing logged-in backend views', async (t) => {
  const { app, dataDir } = await createApp();
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const [page] = await app.store.importUploadFiles([
    {
      fileName: 'index.html',
      relativePath: 'private/index.html',
      buffer: Buffer.from('<!doctype html><html><head><title>私有页面</title></head><body><h1>私有页面</h1><img src="assets/logo.png"></body></html>'),
      visibility: 'private',
    },
    {
      fileName: 'logo.png',
      relativePath: 'private/assets/logo.png',
      buffer: Buffer.from('private-logo'),
    },
  ]);
  const uploadRootId = path.relative(app.config.uploadsDir, page.sourcePath).split(path.sep)[0];
  const assetUrl = `/page-assets/${uploadRootId}/private/assets/logo.png`;

  const publicApi = await app.inject({ method: 'GET', url: '/public/api/pages' });
  assert.equal(publicApi.statusCode, 200);
  assert.equal(publicApi.json().pages.some((item) => item.slug === page.slug), false);

  const publicView = await app.inject({ method: 'GET', url: page.url });
  assert.equal(publicView.statusCode, 404);
  const publicAsset = await app.inject({ method: 'GET', url: assetUrl });
  assert.equal(publicAsset.statusCode, 404);

  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: 'admin', password: 'tokdoc' },
  });
  const cookie = sessionCookie(login);
  const backendView = await app.inject({ method: 'GET', url: page.url, headers: { cookie } });
  assert.equal(backendView.statusCode, 200);
  assert.match(backendView.body, /私有页面/);
  const backendAsset = await app.inject({ method: 'GET', url: assetUrl, headers: { cookie } });
  assert.equal(backendAsset.statusCode, 200);
  assert.equal(backendAsset.body, 'private-logo');

  const update = await app.inject({
    method: 'PATCH',
    url: `/api/pages/${page.id}`,
    headers: { cookie },
    payload: { visibility: 'public' },
  });
  assert.equal(update.statusCode, 200);
  assert.equal(update.json().page.visibility, 'public');

  const publicViewAfterUpdate = await app.inject({ method: 'GET', url: page.url });
  assert.equal(publicViewAfterUpdate.statusCode, 200);
  assert.match(publicViewAfterUpdate.body, /私有页面/);
  const publicAssetAfterUpdate = await app.inject({ method: 'GET', url: assetUrl });
  assert.equal(publicAssetAfterUpdate.statusCode, 200);
  assert.equal(publicAssetAfterUpdate.body, 'private-logo');
});

test('protects private folder assets in mixed public and private upload batches', async (t) => {
  const { app, dataDir } = await createApp();
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const [publicPage, privatePage] = await app.store.importUploadFiles([
    {
      fileName: 'index.html',
      relativePath: 'public/index.html',
      buffer: Buffer.from('<!doctype html><html><head><title>公开批次</title></head><body><h1>公开批次</h1><img src="assets/logo.png"></body></html>'),
      visibility: 'public',
    },
    {
      fileName: 'public-logo.png',
      relativePath: 'public/assets/logo.png',
      buffer: Buffer.from('public-logo'),
    },
    {
      fileName: 'index.html',
      relativePath: 'private/index.html',
      buffer: Buffer.from('<!doctype html><html><head><title>私有批次</title></head><body><h1>私有批次</h1><img src="assets/logo.png"></body></html>'),
      visibility: 'private',
    },
    {
      fileName: 'private-logo.png',
      relativePath: 'private/assets/logo.png',
      buffer: Buffer.from('private-logo'),
    },
  ]);
  const uploadRootId = path.relative(app.config.uploadsDir, publicPage.sourcePath).split(path.sep)[0];
  assert.equal(path.relative(app.config.uploadsDir, privatePage.sourcePath).split(path.sep)[0], uploadRootId);
  const publicAssetUrl = `/page-assets/${uploadRootId}/public/assets/logo.png`;
  const privateAssetUrl = `/page-assets/${uploadRootId}/private/assets/logo.png`;

  const publicView = await app.inject({ method: 'GET', url: publicPage.url });
  assert.equal(publicView.statusCode, 200);
  assert.match(publicView.body, /公开批次/);
  const privateView = await app.inject({ method: 'GET', url: privatePage.url });
  assert.equal(privateView.statusCode, 404);

  const publicAsset = await app.inject({ method: 'GET', url: publicAssetUrl });
  assert.equal(publicAsset.statusCode, 200);
  assert.equal(publicAsset.body, 'public-logo');
  const privateAsset = await app.inject({ method: 'GET', url: privateAssetUrl });
  assert.equal(privateAsset.statusCode, 404);

  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: 'admin', password: 'tokdoc' },
  });
  const backendPrivateAsset = await app.inject({ method: 'GET', url: privateAssetUrl, headers: { cookie: sessionCookie(login) } });
  assert.equal(backendPrivateAsset.statusCode, 200);
  assert.equal(backendPrivateAsset.body, 'private-logo');
});

test('serves uploaded PDF documents publicly and blocks edit mode for non-HTML assets', async (t) => {
  const { app, dataDir } = await createApp();
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const page = await app.store.importBuffer({
    fileName: 'public-report.pdf',
    relativePath: 'reports/public-report.pdf',
    buffer: Buffer.from('%PDF-1.4\npublic report\n'),
  });

  const publicView = await app.inject({ method: 'GET', url: page.url });
  assert.equal(publicView.statusCode, 200);
  assert.match(publicView.headers['content-type'], /application\/pdf/);
  assert.match(publicView.headers['content-disposition'], /inline/);
  assert.match(publicView.body, /^%PDF-1\.4/);

  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: 'admin', password: 'tokdoc' },
  });
  const editDenied = await app.inject({ method: 'GET', url: `${page.url}?edit=1`, headers: { cookie: sessionCookie(login) } });
  assert.equal(editDenied.statusCode, 400);
  assert.equal(editDenied.json().error, 'Document assets cannot be edited online');
  assert.doesNotMatch(editDenied.body, /tokdoc-edit-panel/);
});

test('serves generated documents when stored paths still point to Docker data directories', async (t) => {
  const { app, dataDir } = await createApp();
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const page = await app.store.importBuffer({
    fileName: 'docker-path-report.pdf',
    relativePath: 'reports/docker-path-report.pdf',
    buffer: Buffer.from('%PDF-1.4\ndocker path report\n'),
  });
  app.store.db.prepare('UPDATE pages SET generated_path = ? WHERE id = ?').run(`/app/data/pages/${path.basename(page.generatedPath)}`, page.id);

  const publicView = await app.inject({ method: 'GET', url: page.url });
  assert.equal(publicView.statusCode, 200);
  assert.match(publicView.headers['content-type'], /application\/pdf/);
  assert.match(publicView.body, /^%PDF-1\.4/);
});

test('allows changing login username and password from settings', async (t) => {
  const { app, dataDir } = await createApp();
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: 'admin', password: 'tokdoc' },
  });
  const cookie = sessionCookie(login);

  const saved = await app.inject({
    method: 'PATCH',
    url: '/api/settings',
    headers: { cookie },
    payload: { authUsername: 'yao', authPassword: 'new-secret' },
  });
  assert.equal(saved.statusCode, 200);
  const settings = saved.json().settings;
  assert.equal(settings.authUsername, 'yao');
  assert.equal(Object.hasOwn(settings, 'authPasswordHash'), false);

  const oldLogin = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: 'admin', password: 'tokdoc' },
  });
  assert.equal(oldLogin.statusCode, 401);

  const newLogin = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: 'yao', password: 'new-secret' },
  });
  assert.equal(newLogin.statusCode, 200);
});

test('saves display names and injects public homepage SEO settings', async (t) => {
  const { app, dataDir } = await createApp();
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: 'admin', password: 'tokdoc' },
  });
  const cookie = sessionCookie(login);

  const saved = await app.inject({
    method: 'PATCH',
    url: '/api/settings',
    headers: { cookie },
    payload: {
      siteName: '移山公开资料库',
      adminName: '移山文档后台',
      publicSeoTitle: '移山资料中心',
      publicSeoDescription: '面向公开阅读的资料索引。',
      publicSeoKeywords: '移山,资料,文档',
    },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().settings.siteName, '移山公开资料库');
  assert.equal(saved.json().settings.adminName, '移山文档后台');
  assert.equal(saved.json().settings.publicSeoTitle, '移山资料中心');

  const session = await app.inject({ method: 'GET', url: '/api/session' });
  assert.equal(session.statusCode, 200);
  assert.equal(session.json().publicSettings.adminName, '移山文档后台');
  assert.equal(Object.hasOwn(session.json().publicSettings, 'remoteSyncUrl'), false);

  const root = await app.inject({ method: 'GET', url: '/' });
  assert.equal(root.statusCode, 200);
  assert.match(root.body, /<title>移山资料中心<\/title>/);
  assert.match(root.body, /<meta name="description" content="面向公开阅读的资料索引。" \/>/);
  assert.match(root.body, /<meta name="keywords" content="移山,资料,文档" \/>/);
  assert.match(root.body, /<span class="brand-title">移山公开资料库<\/span>/);
  assert.match(root.body, /<h1 class="section-title">移山公开资料库<\/h1>/);
  assert.match(root.body, /<p class="section-note" id="listNote">面向公开阅读的资料索引。<\/p>/);
});

test('hides deleted generated pages until they are restored from the recycle bin', async (t) => {
  const { app, dataDir } = await createApp();
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: 'admin', password: 'tokdoc' },
  });
  const cookie = sessionCookie(login);
  const page = await app.store.importBuffer({
    fileName: 'hidden-after-delete.html',
    relativePath: 'hidden-after-delete.html',
    buffer: Buffer.from('<!doctype html><html><head><title>删除后隐藏</title></head><body><h1>删除后隐藏</h1></body></html>'),
  });

  const beforeDelete = await app.inject({ method: 'GET', url: page.url, headers: { cookie } });
  assert.equal(beforeDelete.statusCode, 200);

  const deleted = await app.inject({ method: 'DELETE', url: `/api/pages/${page.id}`, headers: { cookie } });
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.json().page.status, 'trashed');

  const afterDelete = await app.inject({ method: 'GET', url: page.url, headers: { cookie } });
  assert.equal(afterDelete.statusCode, 404);

  const trash = await app.inject({ method: 'GET', url: '/api/pages?scope=trash', headers: { cookie } });
  assert.equal(trash.statusCode, 200);
  assert.equal(trash.json().pages.length, 1);

  const restored = await app.inject({ method: 'POST', url: `/api/pages/${page.id}/restore`, headers: { cookie } });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().page.deletedAt, '');

  const afterRestore = await app.inject({ method: 'GET', url: page.url, headers: { cookie } });
  assert.equal(afterRestore.statusCode, 200);
});

test('syncs a generated page to a bound online endpoint', async (t) => {
  const received = [];
  const remoteServer = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      received.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: JSON.parse(body),
      });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ok: true, remoteId: 'remote-001' }));
    });
  });
  await new Promise((resolve) => remoteServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => remoteServer.close(resolve)));

  const { app, dataDir } = await createApp();
  t.after(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: 'admin', password: 'tokdoc' },
  });
  const cookie = sessionCookie(login);
  const page = await app.store.importBuffer({
    fileName: 'sync-me.html',
    relativePath: 'sync-me.html',
    buffer: Buffer.from('<!doctype html><html><head><title>线上同步</title></head><body><h1>线上同步</h1></body></html>'),
  });

  const remoteUrl = `http://127.0.0.1:${remoteServer.address().port}/api/import`;
  const saved = await app.inject({
    method: 'PATCH',
    url: '/api/settings',
    headers: { cookie },
    payload: {
      remoteSyncEnabled: true,
      remoteSyncUrl: remoteUrl,
      remoteSyncToken: 'secret-token',
    },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().settings.remoteSyncEnabled, true);
  assert.equal(saved.json().settings.remoteSyncUrl, remoteUrl);
  assert.equal(saved.json().settings.remoteSyncHasToken, true);
  assert.equal(Object.hasOwn(saved.json().settings, 'remoteSyncToken'), false);

  const synced = await app.inject({
    method: 'POST',
    url: `/api/pages/${page.id}/sync`,
    headers: { cookie },
  });
  assert.equal(synced.statusCode, 200);
  assert.equal(synced.json().sync.status, 200);
  assert.equal(received.length, 1);
  assert.equal(received[0].method, 'POST');
  assert.equal(received[0].url, '/api/import');
  assert.equal(received[0].authorization, 'Bearer secret-token');
  assert.equal(received[0].body.source, 'tokdoc');
  assert.equal(received[0].body.legacySource, 'tokhtml');
  assert.equal(received[0].body.page.id, page.id);
  assert.equal(received[0].body.page.slug, page.slug);
  assert.equal(received[0].body.page.title, '线上同步');
  assert.match(received[0].body.html, /线上同步/);
});
