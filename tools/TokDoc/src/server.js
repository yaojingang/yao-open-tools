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
