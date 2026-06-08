import fs from 'node:fs/promises';
import path from 'node:path';
import { injectEditBridge } from './edit-bridge.js';

function sendNotFound(reply, message = 'Not found') {
  return reply.code(404).send({ error: message });
}

function publicPage(page) {
  return {
    ...page,
    canEdit: page.fileType === 'html',
    canSync: page.fileType === 'html',
    canEditSource: page.sourceType === 'watch',
  };
}

const sessionCookieName = 'tokdoc_session';
const legacySessionCookieName = 'tokhtml_session';
const sessionMaxAgeSeconds = 60 * 60 * 24 * 365 * 10;

async function syncPageToRemote(app, page) {
  if (page.fileType !== 'html') {
    const error = new Error('只有 HTML 页面支持上传线上');
    error.code = 'DOCUMENT_SYNC_UNSUPPORTED';
    throw error;
  }
  const settings = app.store.getRemoteSyncSettings(true);
  if (!settings.remoteSyncEnabled || !settings.remoteSyncUrl) {
    const error = new Error('请先在设置中绑定线上程序');
    error.code = 'REMOTE_NOT_CONFIGURED';
    throw error;
  }
  let remoteUrl;
  try {
    remoteUrl = new URL(settings.remoteSyncUrl);
  } catch {
    const error = new Error('线上程序地址无效');
    error.code = 'REMOTE_INVALID_URL';
    throw error;
  }
  if (!['http:', 'https:'].includes(remoteUrl.protocol)) {
    const error = new Error('线上程序地址必须是 http 或 https');
    error.code = 'REMOTE_INVALID_URL';
    throw error;
  }
  const html = await app.store.readPageHtml(page);
  const headers = {
    'content-type': 'application/json',
    'user-agent': 'tokdoc-sync',
  };
  if (settings.remoteSyncToken) headers.authorization = `Bearer ${settings.remoteSyncToken}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(remoteUrl, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        source: 'tokdoc',
        legacySource: 'tokhtml',
        syncedAt: new Date().toISOString(),
        page: {
          id: page.id,
          slug: page.slug,
          fileName: page.fileName,
          title: page.title,
          directoryName: page.directoryName,
          size: page.size,
          status: page.status,
          revision: page.revision,
          url: page.url,
          editUrl: page.editUrl,
          createdAt: page.createdAt,
          updatedAt: page.updatedAt,
        },
        html,
      }),
    });
    const text = await response.text();
    let body = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

function inlineContentDisposition(fileName) {
  const fallback = String(fileName || 'document.pdf').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'document.pdf';
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName || fallback)}`;
}

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    String(cookieHeader || '')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf('=');
        if (index === -1) return [item, ''];
        return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
      }),
  );
}

function sessionCookie(token) {
  return `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; Max-Age=${sessionMaxAgeSeconds}; HttpOnly; SameSite=Lax`;
}

function expiredSessionCookie(name = sessionCookieName) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

function isPublicRequest(request) {
  const url = new URL(request.url, 'http://tokdoc.local');
  const pathname = url.pathname;
  const isPublicPageView = pathname.startsWith('/pages/') && url.searchParams.get('edit') !== '1';
  const isPublicShortPageView = /^\/[a-z0-9]{6}$/.test(pathname) && url.searchParams.get('edit') !== '1';
  return (
    pathname === '/' ||
    pathname === '/admin' ||
    pathname === '/admin/' ||
    pathname === '/favicon.ico' ||
    pathname === '/api/health' ||
    pathname === '/api/session' ||
    pathname === '/api/login' ||
    pathname.startsWith('/assets/') ||
    isPublicShortPageView ||
    isPublicPageView
  );
}

async function sendGeneratedPage(app, request, reply, rawSlug) {
  const slug = String(rawSlug || '').replace(/\.html?$/i, '');
  if (!/^[a-z0-9]{6}$/.test(slug)) return sendNotFound(reply, 'Page not found');
  const page = app.store.getActivePageBySlug(slug);
  if (!page) return sendNotFound(reply, 'Page not found');
  app.store.incrementAccessCount(page.id);
  if (request.query?.edit === '1' && page.fileType !== 'html') {
    return reply.code(400).send({ error: 'Document assets cannot be edited online' });
  }
  if (page.fileType !== 'html') {
    const buffer = await app.store.readPageFile(page);
    return reply
      .header('cache-control', 'no-store')
      .header('content-disposition', inlineContentDisposition(`${page.slug}.pdf`))
      .type(page.mimeType || 'application/pdf')
      .send(buffer);
  }
  const html = await app.store.readPageHtml(page);
  const output = request.query?.edit === '1' ? injectEditBridge(page, html) : html;
  return reply.header('cache-control', 'no-store').type('text/html; charset=utf-8').send(output);
}

function currentSession(app, request) {
  const cookies = parseCookies(request.headers.cookie);
  return app.store.verifySessionToken(cookies[sessionCookieName] || cookies[legacySessionCookieName]);
}

export function registerRoutes(app) {
  app.addHook('preHandler', async (request, reply) => {
    if (isPublicRequest(request)) return;
    const session = currentSession(app, request);
    if (!session) return reply.code(401).send({ error: 'Unauthorized' });
    request.auth = session;
  });

  app.get('/', async (request, reply) => reply.redirect('/admin'));

  app.get('/admin', async (request, reply) => {
    return reply.type('text/html').send(await fs.readFile(path.join(app.config.publicDir, 'index.html'), 'utf8'));
  });

  app.get('/admin/', async (request, reply) => {
    return reply.type('text/html').send(await fs.readFile(path.join(app.config.publicDir, 'index.html'), 'utf8'));
  });

  app.get('/api/health', async () => ({
    ok: true,
    name: 'tokdoc',
    time: new Date().toISOString(),
  }));

  app.get('/favicon.ico', async (request, reply) => reply.code(204).send());

  app.get('/api/session', async (request) => {
    const session = currentSession(app, request);
    if (!session) return { authenticated: false };
    return { authenticated: true, username: session.username };
  });

  app.post('/api/login', async (request, reply) => {
    const body = request.body || {};
    if (!app.store.verifyCredentials(body.username, body.password)) {
      return reply.code(401).send({ error: '用户名或密码错误' });
    }
    const token = app.store.createSessionToken(String(body.username || ''));
    return reply.header('set-cookie', sessionCookie(token)).send({ authenticated: true, username: body.username });
  });

  app.post('/api/logout', async (request, reply) => {
    return reply
      .header('set-cookie', [expiredSessionCookie(), expiredSessionCookie(legacySessionCookieName)])
      .send({ authenticated: false });
  });

  app.get('/api/pages', async (request) => {
    const result = app.store.listPagesPage(request.query || {});
    return {
      pages: result.pages.map(publicPage),
      pagination: result.pagination,
    };
  });

  app.get('/api/pages/:id', async (request, reply) => {
    const page = app.store.getPage(request.params.id);
    if (!page) return sendNotFound(reply, 'Page not found');
    const html = page.fileType === 'html' ? await app.store.readPageHtml(page) : '';
    return { page: publicPage(page), html };
  });

  app.post('/api/pages/upload', async (request, reply) => {
    const files = [];
    const relativePaths = [];
    for await (const part of request.parts()) {
      if (part.type === 'field' && part.fieldname === 'relativePath') {
        relativePaths.push(String(part.value || ''));
        continue;
      }
      if (part.type !== 'file') continue;
      const buffer = await part.toBuffer();
      const relativePath = relativePaths.shift() || part.filename || '';
      files.push({
        fileName: path.basename(part.filename || relativePath || 'file'),
        buffer,
        relativePath,
      });
    }
    let created;
    try {
      created = await app.store.importUploadFiles(files);
    } catch (error) {
      if (error.code === 'WORD_CONVERSION_FAILED') return reply.code(422).send({ error: error.message });
      throw error;
    }
    if (!created.length) return reply.code(400).send({ error: 'No supported files uploaded' });
    return reply.code(201).send({ pages: created.map(publicPage) });
  });

  app.get('/api/settings', async () => ({
    settings: app.store.getSettings(),
  }));

  app.patch('/api/settings', async (request, reply) => {
    const body = request.body || {};
    const settings = await app.store.saveSettings(body);
    if (Object.hasOwn(body, 'authUsername') || Object.hasOwn(body, 'authPassword')) {
      reply.header('set-cookie', sessionCookie(app.store.createSessionToken(settings.authUsername)));
    }
    return { settings };
  });

  app.post('/api/pages/samples', async (request, reply) => {
    const pages = await app.store.addSamplePages();
    return reply.code(201).send({ pages: pages.map(publicPage) });
  });

  app.patch('/api/pages/:id/content', async (request, reply) => {
    try {
      const page = await app.store.savePageContent(request.params.id, request.body || {});
      return { page: publicPage(page) };
    } catch (error) {
      if (error.code === 'REVISION_CONFLICT') {
        return reply.code(409).send({ error: 'Revision conflict', page: publicPage(error.page) });
      }
      if (error.code === 'DOCUMENT_NOT_EDITABLE') return reply.code(400).send({ error: error.message });
      if (error.code === 'NOT_FOUND') return sendNotFound(reply, error.message);
      throw error;
    }
  });

  app.delete('/api/pages/:id', async (request, reply) => {
    const page = await app.store.deletePage(request.params.id);
    if (!page) return sendNotFound(reply, 'Page not found');
    return { page: publicPage(page) };
  });

  app.post('/api/pages/:id/sync', async (request, reply) => {
    try {
      const page = app.store.getPage(request.params.id);
      if (!page) return sendNotFound(reply, 'Page not found');
      if (page.deletedAt) return reply.code(400).send({ error: '回收站页面需要恢复后才能上传线上' });
      if (page.fileType !== 'html') return reply.code(400).send({ error: '只有 HTML 页面支持上传线上' });
      const sync = await syncPageToRemote(app, page);
      if (!sync.ok) return reply.code(502).send({ error: '线上程序返回失败', sync });
      return { sync };
    } catch (error) {
      if (error.code === 'REMOTE_NOT_CONFIGURED' || error.code === 'REMOTE_INVALID_URL') {
        return reply.code(400).send({ error: error.message });
      }
      if (error.name === 'AbortError') return reply.code(504).send({ error: '线上上传超时' });
      throw error;
    }
  });

  app.post('/api/pages/:id/restore', async (request, reply) => {
    try {
      const page = await app.store.restoreDeletedPage(request.params.id);
      if (!page) return sendNotFound(reply, 'Page not found');
      return { page: publicPage(page) };
    } catch (error) {
      if (error.code === 'NOT_FOUND') return sendNotFound(reply, error.message);
      throw error;
    }
  });

  app.get('/api/pages/:id/versions', async (request, reply) => {
    const page = app.store.getPage(request.params.id);
    if (!page) return sendNotFound(reply, 'Page not found');
    return { versions: app.store.listVersions(page.id) };
  });

  app.post('/api/pages/:id/restore/:versionId', async (request, reply) => {
    try {
      const page = await app.store.restoreVersion(request.params.id, request.params.versionId);
      return { page: publicPage(page) };
    } catch (error) {
      if (error.code === 'NOT_FOUND') return sendNotFound(reply, error.message);
      throw error;
    }
  });

  app.get('/api/watch-dirs', async () => ({
    watchDirs: app.store.listWatchDirs(),
  }));

  app.post('/api/watch-dirs', async (request, reply) => {
    const body = request.body || {};
    if (!body.path) return reply.code(400).send({ error: 'path is required' });
    const watchDir = await app.store.addWatchDir({
      path: body.path,
      name: body.name,
      allowWrite: Boolean(body.allowWrite),
      createIfMissing: true,
    });
    await app.watchService.refresh();
    const scanned = await app.store.rescanWatchDir(watchDir.id);
    return reply.code(201).send({ watchDir: scanned });
  });

  app.delete('/api/watch-dirs/:id', async (request, reply) => {
    const watchDir = await app.store.removeWatchDir(request.params.id);
    if (!watchDir) return sendNotFound(reply, 'Watch directory not found');
    await app.watchService.refresh();
    return { watchDir };
  });

  app.post('/api/watch-dirs/:id/rescan', async (request, reply) => {
    try {
      const watchDir = await app.store.rescanWatchDir(request.params.id);
      return { watchDir };
    } catch {
      return sendNotFound(reply, 'Watch directory not found');
    }
  });

  app.get('/pages/:slug', async (request, reply) => {
    return sendGeneratedPage(app, request, reply, request.params.slug);
  });

  app.get('/:slug', async (request, reply) => {
    return sendGeneratedPage(app, request, reply, request.params.slug);
  });
}
