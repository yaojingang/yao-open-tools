import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultAdminPath, normalizeAdminPath } from './admin-path.js';
import { injectEditBridge } from './edit-bridge.js';
import { escapeHtml, isEditableFileType, isHtmlBackedFileType, managedFileTypes } from './html.js';

function sendNotFound(reply, message = 'Not found') {
  return reply.code(404).send({ error: message });
}

function publicPage(page) {
  return {
    ...page,
    canEdit: isEditableFileType(page.fileType, page.mimeType),
    canEditMarkdownSource: page.fileType === 'markdown' && Boolean(page.sourcePath),
    canSync: page.fileType === 'html',
    canEditSource: page.sourceType === 'watch',
  };
}

async function collectUploadParts(request) {
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
  return files;
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

function attachmentContentDisposition(fileName) {
  const fallback = String(fileName || 'document').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'document';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName || fallback)}`;
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

function normalizedPath(pathname) {
  if (pathname === '/') return '/';
  return String(pathname || '').replace(/\/+$/g, '') || '/';
}

function isActiveAdminPath(pathname, adminPath) {
  return normalizedPath(pathname) === adminPath;
}

function isActiveAdminSettingsPath(pathname, adminPath) {
  return normalizedPath(pathname) === `${adminPath}/settings`;
}

function isLegacyApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function isScopedApiPath(pathname) {
  return /^\/[^/]+\/api(?:\/|$)/.test(pathname);
}

function isActiveAdminApiPath(pathname, adminPath) {
  return pathname === `${adminPath}/api` || pathname.startsWith(`${adminPath}/api/`);
}

function isPublicListPath(pathname) {
  return pathname === '/' || pathname === '/public/api/pages' || /^\/type\/[^/]+\/?$/.test(pathname);
}

function publicApiSuffix(pathname, adminPath) {
  const suffix = pathname.startsWith(`${adminPath}/api`) ? pathname.slice(adminPath.length) : pathname;
  return suffix === '/api/health' || suffix === '/api/session' || suffix === '/api/login';
}

function requestAccessState(app, request) {
  const url = new URL(request.url, 'http://tokdoc.local');
  const pathname = url.pathname;
  const adminPath = app.store.getAdminPath();
  const usingDefaultAdminPath = adminPath === defaultAdminPath;
  const isPublicPageView = pathname.startsWith('/pages/') && url.searchParams.get('edit') !== '1';
  const isPublicShortPageView = /^\/[a-z0-9]{6}$/.test(pathname) && url.searchParams.get('edit') !== '1';
  if (pathname === '/healthz' || pathname === '/favicon.ico' || pathname.startsWith('/assets/') || pathname.startsWith('/page-assets/')) return 'public';
  if (isPublicListPath(pathname)) return 'public';
  if (pathname === '/admin' || pathname === '/admin/') return usingDefaultAdminPath ? 'public' : 'not-found';
  if (pathname === '/admin/settings' || pathname === '/admin/settings/') return usingDefaultAdminPath ? 'public' : 'not-found';
  if (isActiveAdminPath(pathname, adminPath)) return 'public';
  if (isActiveAdminSettingsPath(pathname, adminPath)) return 'public';
  if (isLegacyApiPath(pathname)) {
    if (!usingDefaultAdminPath) return 'not-found';
    return publicApiSuffix(pathname, adminPath) ? 'public' : 'protected';
  }
  if (isScopedApiPath(pathname)) {
    if (!isActiveAdminApiPath(pathname, adminPath)) return 'not-found';
    return publicApiSuffix(pathname, adminPath) ? 'public' : 'protected';
  }
  if (isPublicShortPageView || isPublicPageView) return 'public';
  return 'protected';
}

async function sendGeneratedPage(app, request, reply, rawSlug) {
  const slug = String(rawSlug || '').replace(/\.html?$/i, '');
  if (!/^[a-z0-9]{6}$/.test(slug)) return sendNotFound(reply, 'Page not found');
  const page = app.store.getActivePageBySlug(slug);
  if (!page) return sendNotFound(reply, 'Page not found');
  const session = currentSession(app, request);
  if (page.visibility === 'private' && !session) return sendNotFound(reply, 'Page not found');
  app.store.incrementAccessCount(page.id);
  if (request.query?.edit === '1' && !isEditableFileType(page.fileType, page.mimeType)) {
    return reply.code(400).send({ error: 'Document assets cannot be edited online' });
  }
  if (!isHtmlBackedFileType(page.fileType, page.mimeType)) {
    const buffer = await app.store.readPageFile(page);
    return reply
      .header('cache-control', 'no-store')
      .header('content-disposition', inlineContentDisposition(`${page.slug}.pdf`))
      .type(page.mimeType || 'application/pdf')
      .send(buffer);
  }
  const html = await app.store.readPageHtml(page);
  const output = request.query?.edit === '1' && isEditableFileType(page.fileType, page.mimeType) ? injectEditBridge(page, html, app.store.getAdminPath()) : html;
  return reply.header('cache-control', 'no-store').type('text/html; charset=utf-8').send(output);
}

function currentSession(app, request) {
  const cookies = parseCookies(request.headers.cookie);
  for (const token of [cookies[sessionCookieName], cookies[legacySessionCookieName]].filter(Boolean)) {
    const session = app.store.verifySessionToken(token);
    if (session) return session;
  }
  return null;
}

async function sendAdmin(app, reply) {
  return reply.type('text/html').send(await fs.readFile(path.join(app.config.publicDir, 'index.html'), 'utf8'));
}

function metaTag(name, content) {
  const value = String(content || '').trim();
  if (!value) return '';
  return `    <meta name="${name}" content="${escapeHtml(value)}" />\n`;
}

async function sendPublicIndex(app, reply) {
  if (!app.store.getSettings().publicHomepageEnabled) return sendNotFound(reply, 'Public homepage disabled');
  const settings = app.store.getPublicSettings();
  const siteName = settings.siteName || 'TokDoc 文档索引';
  const seoTitle = settings.publicSeoTitle || siteName;
  const seoDescription = settings.publicSeoDescription || '';
  const seoKeywords = settings.publicSeoKeywords || '';
  let html = await fs.readFile(path.join(app.config.publicDir, 'index-public.html'), 'utf8');
  html = html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(seoTitle)}</title>`)
    .replace(/<meta name="description"[^>]*>\s*/gi, '')
    .replace(/<meta name="keywords"[^>]*>\s*/gi, '')
    .replace(
      '</head>',
      `${metaTag('description', seoDescription)}${metaTag('keywords', seoKeywords)}  </head>`,
    )
    .replace(/(<span class="brand-title">)[\s\S]*?(<\/span>)/, `$1${escapeHtml(siteName)}$2`)
    .replace(/(<span class="brand-subtitle">)[\s\S]*?(<\/span>)/, `$1${escapeHtml(seoDescription || '公开文档索引 · HTML / Markdown / PDF / Word / PPT / Keynote / Excel')}$2`)
    .replace(/(<h1 class="section-title">)[\s\S]*?(<\/h1>)/, `$1${escapeHtml(siteName)}$2`)
    .replace(/(<p class="section-note" id="listNote">)[\s\S]*?(<\/p>)/, `$1${escapeHtml(seoDescription || '按类型筛选、搜索并打开公开文档。')}$2`);
  return reply.type('text/html').send(html);
}

function normalizedPublicType(value) {
  const type = String(value || 'all').trim().toLowerCase();
  return managedFileTypes.includes(type) ? type : 'all';
}

function isDocumentConversionError(error) {
  return error.code === 'DOCUMENT_CONVERSION_FAILED' || error.code === 'WORD_CONVERSION_FAILED';
}

function registerApiRoutes(app, prefix = '') {
  app.get(`${prefix}/api/health`, async () => ({
    ok: true,
    name: 'tokdoc',
    time: new Date().toISOString(),
  }));

  app.get(`${prefix}/api/session`, async (request) => {
    const session = currentSession(app, request);
    const publicSettings = app.store.getPublicSettings();
    if (!session) return { authenticated: false, publicSettings };
    return { authenticated: true, username: session.username, publicSettings };
  });

  app.post(`${prefix}/api/login`, async (request, reply) => {
    const body = request.body || {};
    if (!app.store.verifyCredentials(body.username, body.password)) {
      return reply.code(401).send({ error: '用户名或密码错误' });
    }
    const token = app.store.createSessionToken(String(body.username || ''));
    return reply.header('set-cookie', sessionCookie(token)).send({ authenticated: true, username: body.username });
  });

  app.post(`${prefix}/api/logout`, async (request, reply) => {
    return reply
      .header('set-cookie', [expiredSessionCookie(), expiredSessionCookie(legacySessionCookieName)])
      .send({ authenticated: false });
  });

  app.get(`${prefix}/api/pages`, async (request) => {
    const result = app.store.listPagesPage(request.query || {});
    return {
      pages: result.pages.map(publicPage),
      pagination: result.pagination,
    };
  });

  app.get(`${prefix}/api/pages/:id`, async (request, reply) => {
    const page = app.store.getPage(request.params.id);
    if (!page) return sendNotFound(reply, 'Page not found');
    const html = isHtmlBackedFileType(page.fileType, page.mimeType) ? await app.store.readPageHtml(page) : '';
    return { page: publicPage(page), html };
  });

  app.get(`${prefix}/api/pages/:id/download`, async (request, reply) => {
    const page = app.store.getPage(request.params.id);
    if (!page || page.deletedAt) return sendNotFound(reply, 'Page not found');
    const filePath = await app.store.resolveGeneratedPath(page);
    const buffer = await app.store.readPageFile(page);
    app.store.incrementDownloadCount(page.id);
    return reply
      .header('cache-control', 'no-store')
      .header('content-disposition', attachmentContentDisposition(path.basename(filePath || page.generatedPath || page.fileName)))
      .type(page.mimeType || 'application/octet-stream')
      .send(buffer);
  });

  app.post(`${prefix}/api/pages/upload`, async (request, reply) => {
    const files = await collectUploadParts(request);
    let created;
    try {
      created = await app.store.importUploadFiles(files);
    } catch (error) {
      if (isDocumentConversionError(error)) return reply.code(422).send({ error: error.message });
      throw error;
    }
    if (!created.length) return reply.code(400).send({ error: 'No supported files uploaded' });
    return reply.code(201).send({ pages: created.map(publicPage) });
  });

  app.post(`${prefix}/api/pages/upload/prepare`, async (request, reply) => {
    const files = await collectUploadParts(request);
    const staged = await app.store.stageUploadFiles(files);
    if (!staged.documents.length) return reply.code(400).send({ error: 'No supported files uploaded' });
    return reply.code(201).send(staged);
  });

  app.post(`${prefix}/api/pages/upload/:uploadId/confirm`, async (request, reply) => {
    let created;
    try {
      created = await app.store.confirmStagedUpload(request.params.uploadId, request.body || {});
    } catch (error) {
      if (error.message === 'Upload batch not found') return reply.code(404).send({ error: error.message });
      if (isDocumentConversionError(error)) return reply.code(422).send({ error: error.message });
      throw error;
    }
    if (!created.length) return reply.code(400).send({ error: 'No supported files uploaded' });
    return reply.code(201).send({ pages: created.map(publicPage) });
  });

  app.delete(`${prefix}/api/pages/upload/:uploadId`, async (request, reply) => {
    try {
      await app.store.cancelStagedUpload(request.params.uploadId);
    } catch {
      return reply.code(404).send({ error: 'Upload batch not found' });
    }
    return reply.code(204).send();
  });

  app.get(`${prefix}/api/settings`, async () => ({
    settings: app.store.getSettings(),
  }));

  app.patch(`${prefix}/api/settings`, async (request, reply) => {
    const body = request.body || {};
    if (Object.hasOwn(body, 'adminPath')) {
      let nextAdminPath;
      try {
        nextAdminPath = normalizeAdminPath(body.adminPath || defaultAdminPath);
      } catch (error) {
        return reply.code(400).send({ error: error.message });
      }
      if (nextAdminPath !== app.store.getAdminPath() && !app.store.verifyCredentials(request.auth?.username, body.currentPassword || '')) {
        return reply.code(400).send({ error: '修改后台访问目录需要输入当前密码' });
      }
    }
    let settings;
    try {
      settings = await app.store.saveSettings(body);
    } catch (error) {
      if (String(error.code || '').startsWith('ADMIN_PATH_')) return reply.code(400).send({ error: error.message });
      throw error;
    }
    if (Object.hasOwn(body, 'authUsername') || Object.hasOwn(body, 'authPassword')) {
      reply.header('set-cookie', sessionCookie(app.store.createSessionToken(settings.authUsername)));
    }
    return { settings };
  });

  app.post(`${prefix}/api/pages/samples`, async (request, reply) => {
    const pages = await app.store.addSamplePages();
    return reply.code(201).send({ pages: pages.map(publicPage) });
  });

  app.patch(`${prefix}/api/pages/:id`, async (request, reply) => {
    const body = request.body || {};
    if (!Object.hasOwn(body, 'visibility')) return reply.code(400).send({ error: 'visibility is required' });
    const page = app.store.updatePageVisibility(request.params.id, body.visibility);
    if (!page) return sendNotFound(reply, 'Page not found');
    return { page: publicPage(page) };
  });

  app.get(`${prefix}/api/pages/:id/source`, async (request, reply) => {
    try {
      const source = await app.store.readMarkdownSource(request.params.id);
      return {
        page: publicPage(source.page),
        markdown: source.markdown,
        sourceOutOfSync: source.sourceOutOfSync,
      };
    } catch (error) {
      if (error.code === 'DOCUMENT_NOT_EDITABLE') return reply.code(400).send({ error: error.message });
      if (error.code === 'MARKDOWN_SOURCE_UNAVAILABLE') return reply.code(404).send({ error: error.message });
      if (error.code === 'NOT_FOUND') return sendNotFound(reply, error.message);
      throw error;
    }
  });

  app.patch(`${prefix}/api/pages/:id/source`, async (request, reply) => {
    try {
      const page = await app.store.saveMarkdownSource(request.params.id, request.body || {});
      return { page: publicPage(page) };
    } catch (error) {
      if (error.code === 'REVISION_CONFLICT') {
        return reply.code(409).send({ error: 'Revision conflict', page: publicPage(error.page) });
      }
      if (error.code === 'DOCUMENT_NOT_EDITABLE' || error.code === 'MARKDOWN_SOURCE_READ_ONLY') {
        return reply.code(400).send({ error: error.message });
      }
      if (error.code === 'MARKDOWN_SOURCE_UNAVAILABLE') return reply.code(404).send({ error: error.message });
      if (error.code === 'NOT_FOUND') return sendNotFound(reply, error.message);
      throw error;
    }
  });

  app.patch(`${prefix}/api/pages/:id/content`, async (request, reply) => {
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

  app.delete(`${prefix}/api/pages/:id`, async (request, reply) => {
    const page = await app.store.deletePage(request.params.id);
    if (!page) return sendNotFound(reply, 'Page not found');
    return { page: publicPage(page) };
  });

  app.post(`${prefix}/api/pages/:id/sync`, async (request, reply) => {
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

  app.post(`${prefix}/api/pages/:id/restore`, async (request, reply) => {
    try {
      const page = await app.store.restoreDeletedPage(request.params.id);
      if (!page) return sendNotFound(reply, 'Page not found');
      return { page: publicPage(page) };
    } catch (error) {
      if (error.code === 'NOT_FOUND') return sendNotFound(reply, error.message);
      throw error;
    }
  });

  app.get(`${prefix}/api/pages/:id/versions`, async (request, reply) => {
    const page = app.store.getPage(request.params.id);
    if (!page) return sendNotFound(reply, 'Page not found');
    return { versions: app.store.listVersions(page.id) };
  });

  app.post(`${prefix}/api/pages/:id/restore/:versionId`, async (request, reply) => {
    try {
      const page = await app.store.restoreVersion(request.params.id, request.params.versionId);
      return { page: publicPage(page) };
    } catch (error) {
      if (error.code === 'NOT_FOUND') return sendNotFound(reply, error.message);
      throw error;
    }
  });

  app.get(`${prefix}/api/watch-dirs`, async () => ({
    watchDirs: app.store.listWatchDirs(),
  }));

  app.post(`${prefix}/api/watch-dirs`, async (request, reply) => {
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

  app.delete(`${prefix}/api/watch-dirs/:id`, async (request, reply) => {
    const watchDir = await app.store.removeWatchDir(request.params.id);
    if (!watchDir) return sendNotFound(reply, 'Watch directory not found');
    await app.watchService.refresh();
    return { watchDir };
  });

  app.post(`${prefix}/api/watch-dirs/:id/rescan`, async (request, reply) => {
    try {
      const watchDir = await app.store.rescanWatchDir(request.params.id);
      return { watchDir };
    } catch {
      return sendNotFound(reply, 'Watch directory not found');
    }
  });
}

export function registerRoutes(app) {
  app.addHook('preHandler', async (request, reply) => {
    const access = requestAccessState(app, request);
    if (access === 'not-found') return sendNotFound(reply, 'Not found');
    if (access === 'public') return;
    const session = currentSession(app, request);
    if (!session) return reply.code(401).send({ error: 'Unauthorized' });
    request.auth = session;
  });

  app.get('/', async (request, reply) => sendPublicIndex(app, reply));
  app.get('/healthz', async () => ({
    ok: true,
    name: 'tokdoc',
    time: new Date().toISOString(),
  }));
  app.get('/type/:fileType', async (request, reply) => {
    if (!managedFileTypes.includes(String(request.params.fileType || '').toLowerCase())) {
      return sendNotFound(reply, 'Type not found');
    }
    return sendPublicIndex(app, reply);
  });
  app.get('/public/api/pages', async (request, reply) => {
    if (!app.store.getSettings().publicHomepageEnabled) return sendNotFound(reply, 'Public homepage disabled');
    const result = app.store.listPublicPagesPage({
      ...request.query,
      type: normalizedPublicType(request.query?.type),
    });
    return result;
  });
  app.get('/admin', async (request, reply) => sendAdmin(app, reply));
  app.get('/admin/', async (request, reply) => sendAdmin(app, reply));
  app.get('/admin/settings', async (request, reply) => sendAdmin(app, reply));
  app.get('/admin/settings/', async (request, reply) => sendAdmin(app, reply));
  app.get('/favicon.ico', async (request, reply) => reply.code(204).send());

  registerApiRoutes(app);
  registerApiRoutes(app, '/:adminPath');

  app.get('/pages/:slug', async (request, reply) => {
    return sendGeneratedPage(app, request, reply, request.params.slug);
  });

  app.get('/:slug/', async (request, reply) => {
    if (isActiveAdminPath(`/${request.params.slug}`, app.store.getAdminPath())) return sendAdmin(app, reply);
    return sendNotFound(reply, 'Page not found');
  });

  app.get('/:slug/settings', async (request, reply) => {
    if (isActiveAdminPath(`/${request.params.slug}`, app.store.getAdminPath())) return sendAdmin(app, reply);
    return sendNotFound(reply, 'Page not found');
  });

  app.get('/:slug/settings/', async (request, reply) => {
    if (isActiveAdminPath(`/${request.params.slug}`, app.store.getAdminPath())) return sendAdmin(app, reply);
    return sendNotFound(reply, 'Page not found');
  });

  app.get('/:slug', async (request, reply) => {
    if (isActiveAdminPath(`/${request.params.slug}`, app.store.getAdminPath())) return sendAdmin(app, reply);
    return sendGeneratedPage(app, request, reply, request.params.slug);
  });
}
