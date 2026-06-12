import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import Fastify from "fastify";
import type { Redis } from "ioredis";
import { type AppConfig, loadConfig } from "./config.js";
import { createDb, type DbClient, type SqlClient } from "./db/client.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerLinkRoutes } from "./routes/links.js";
import { registerRedirectRoute } from "./routes/redirect.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerUserRoutes } from "./routes/users.js";
import { createRedisClient } from "./services/redis.js";
import { getSiteSettings } from "./services/settings.js";
import { ensureBootstrapAdmin } from "./services/users.js";

export interface AppDependencies {
  config?: AppConfig;
  db?: DbClient;
  sql?: SqlClient;
  redis?: Redis;
}

export const corsMethods = ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"] as const;

export async function buildApp(dependencies: AppDependencies = {}) {
  const config = dependencies.config ?? loadConfig();
  const dbResources = dependencies.db ? null : createDb(config.databaseUrl);
  const db = dependencies.db ?? dbResources!.db;
  const redis = dependencies.redis ?? createRedisClient(config.redisUrl);

  const app = Fastify({
    logger: config.nodeEnv === "test" ? false : true,
    trustProxy: true
  });

  await app.register(helmet);
  await app.register(cookie);
  await app.register(cors, {
    origin: config.corsOrigins,
    methods: [...corsMethods],
    credentials: true
  });

  await ensureBootstrapAdmin({ config, db });

  app.get("/health", async () => ({
    ok: true,
    service: "tokurl-api"
  }));

  app.get("/api/config", async () => ({
    shortBaseUrl: config.publicShortBaseUrl,
    slugLength: config.slugLength,
    redirectStatus: config.redirectStatus,
    adminAuthEnabled: true,
    allowRegistration: config.allowRegistration,
    analyticsEnabled: config.analyticsEnabled,
    siteSettings: await getSiteSettings({ db })
  }));

  await registerAuthRoutes(app, { config, db, redis });
  await registerUserRoutes(app, { config, db });
  await registerSettingsRoutes(app, { config, db });
  await registerLinkRoutes(app, { config, db, redis });
  await registerRedirectRoute(app, { config, db, redis });

  app.addHook("onClose", async () => {
    if (!dependencies.redis) {
      redis.disconnect();
    }

    if (!dependencies.db) {
      await dbResources?.sql.end();
    }
  });

  return app;
}
