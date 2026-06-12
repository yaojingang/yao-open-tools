import { z } from "zod";

const redirectStatuses = [301, 302, 307, 308] as const;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().url().default("postgres://tokurl:tokurl@localhost:5432/tokurl"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  PUBLIC_SHORT_BASE_URL: z.string().url().default("http://localhost:8080"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  TOKURL_SLUG_LENGTH: z.coerce.number().int().min(3).max(12).default(5),
  TOKURL_REDIRECT_STATUS: z.coerce
    .number()
    .int()
    .refine((value) => redirectStatuses.includes(value as (typeof redirectStatuses)[number]), {
      message: "TOKURL_REDIRECT_STATUS must be one of 301, 302, 307, 308"
    })
    .default(302),
  TOKURL_CACHE_TTL_SECONDS: z.coerce.number().int().min(5).max(86400).default(300),
  TOKURL_ADMIN_TOKEN: z.string().default(""),
  TOKURL_AUTH_SECRET: z.string().default("tokurl-dev-auth-secret-change-before-production"),
  TOKURL_BOOTSTRAP_ADMIN_EMAIL: z.string().email().default("admin@tokurl.local"),
  TOKURL_BOOTSTRAP_ADMIN_PASSWORD: z.string().default("tokurl-admin"),
  TOKURL_ALLOW_REGISTRATION: z.coerce.boolean().default(true),
  TOKURL_COOKIE_SECURE: z.coerce.boolean().default(false),
  TOKURL_TITLE_FETCH_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(1200),
  TOKURL_TITLE_FETCH_MAX_BYTES: z.coerce.number().int().min(1024).max(1_048_576).default(131_072),
  TOKURL_TITLE_FETCH_ALLOW_PRIVATE_HOSTS: z.coerce.boolean().default(false),
  TOKURL_HASH_SALT: z.string().default("tokurl-dev-salt"),
  TOKURL_ANALYTICS_ENABLED: z.coerce.boolean().default(true)
});

export type RedirectStatus = (typeof redirectStatuses)[number];

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  publicShortBaseUrl: string;
  corsOrigins: string[] | true;
  slugLength: number;
  redirectStatus: RedirectStatus;
  cacheTtlSeconds: number;
  adminToken: string;
  authSecret: string;
  bootstrapAdminEmail: string;
  bootstrapAdminPassword: string;
  allowRegistration: boolean;
  cookieSecure: boolean;
  titleFetchTimeoutMs: number;
  titleFetchMaxBytes: number;
  titleFetchAllowPrivateHosts: boolean;
  hashSalt: string;
  analyticsEnabled: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    publicShortBaseUrl: parsed.PUBLIC_SHORT_BASE_URL.replace(/\/+$/, ""),
    corsOrigins:
      parsed.CORS_ORIGIN.trim() === "*"
        ? true
        : parsed.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean),
    slugLength: parsed.TOKURL_SLUG_LENGTH,
    redirectStatus: parsed.TOKURL_REDIRECT_STATUS as RedirectStatus,
    cacheTtlSeconds: parsed.TOKURL_CACHE_TTL_SECONDS,
    adminToken: parsed.TOKURL_ADMIN_TOKEN,
    authSecret: parsed.TOKURL_AUTH_SECRET,
    bootstrapAdminEmail: parsed.TOKURL_BOOTSTRAP_ADMIN_EMAIL.toLowerCase(),
    bootstrapAdminPassword: parsed.TOKURL_BOOTSTRAP_ADMIN_PASSWORD,
    allowRegistration: parsed.TOKURL_ALLOW_REGISTRATION,
    cookieSecure: parsed.TOKURL_COOKIE_SECURE,
    titleFetchTimeoutMs: parsed.TOKURL_TITLE_FETCH_TIMEOUT_MS,
    titleFetchMaxBytes: parsed.TOKURL_TITLE_FETCH_MAX_BYTES,
    titleFetchAllowPrivateHosts: parsed.TOKURL_TITLE_FETCH_ALLOW_PRIVATE_HOSTS,
    hashSalt: parsed.TOKURL_HASH_SALT,
    analyticsEnabled: parsed.TOKURL_ANALYTICS_ENABLED
  };
}
