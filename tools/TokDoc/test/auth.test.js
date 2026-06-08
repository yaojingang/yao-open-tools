import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildApp } from '../src/server.js';

async function createApp() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokdoc-auth-'));
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
  };
  const app = await buildApp(config);
  return { app, dataDir };
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
  assert.equal(root.statusCode, 302);
  assert.equal(root.headers.location, '/admin');

  const admin = await app.inject({ method: 'GET', url: '/admin' });
  assert.equal(admin.statusCode, 200);
  assert.match(admin.body, /TokDoc 登录/);

  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().name, 'tokdoc');

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

  const saved = await app.inject({
    method: 'PATCH',
    url: '/admin/api/settings',
    headers: { cookie },
    payload: { adminPath: '/tok-ops', currentPassword: 'tokdoc' },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().settings.adminPath, '/tok-ops');

  const hiddenRoot = await app.inject({ method: 'GET', url: '/' });
  assert.equal(hiddenRoot.statusCode, 404);

  const oldAdmin = await app.inject({ method: 'GET', url: '/admin' });
  assert.equal(oldAdmin.statusCode, 404);

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
