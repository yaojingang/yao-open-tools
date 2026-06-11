import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { PageStore } from './page-store.js';
import { WatchService } from './watch-service.js';
import { registerRoutes } from './routes.js';

function parseCookieHeader(cookieHeader = '') {
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

function pageAssetRequestFromUrl(rawUrl = '') {
  const pathname = new URL(rawUrl, 'http://tokdoc.local').pathname;
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'page-assets' || !parts[1]) return '';
  try {
    return {
      uploadRootId: decodeURIComponent(parts[1]),
      relativePath: parts.slice(2).map((part) => decodeURIComponent(part)).join('/'),
    };
  } catch {
    return null;
  }
}

function hasValidSession(store, cookieHeader = '') {
  const cookies = parseCookieHeader(cookieHeader);
  return Boolean(
    [cookies.tokdoc_session, cookies.tokhtml_session]
      .filter(Boolean)
      .some((token) => store.verifySessionToken(token)),
  );
}

export async function buildApp(config = loadConfig()) {
  const app = Fastify({ logger: true });
  const db = createDb(config);
  const store = new PageStore(config, db);
  await store.ensureStorage();
  await store.seedConfiguredWatchDirs();

  const watchService = new WatchService(store);

  app.decorate('config', config);
  app.decorate('store', store);
  app.decorate('watchService', watchService);

  app.addHook('preHandler', async (request, reply) => {
    const assetRequest = pageAssetRequestFromUrl(request.url);
    if (!assetRequest || store.assetPathVisibility(assetRequest.uploadRootId, assetRequest.relativePath) !== 'private') return;
    if (hasValidSession(store, request.headers.cookie)) return;
    return reply.code(404).send({ error: 'Page asset not found' });
  });

  await app.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024,
      files: 200,
    },
  });

  await app.register(fastifyStatic, {
    root: config.publicDir,
    prefix: '/assets/',
    decorateReply: false,
  });

  await app.register(fastifyStatic, {
    root: config.uploadsDir,
    prefix: '/page-assets/',
    decorateReply: false,
  });

  registerRoutes(app);

  app.addHook('onReady', async () => {
    await watchService.start();
  });

  app.addHook('onClose', async () => {
    await watchService.stop();
    db.close();
  });

  return app;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const app = await buildApp(config);
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`tokdoc listening at http://${config.host}:${config.port}`);
}
