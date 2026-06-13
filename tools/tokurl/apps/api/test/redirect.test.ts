import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { enqueueClick } from "../src/services/analytics.js";
import { getRedirectLink } from "../src/services/links.js";
import { defaultSiteSettings, getSiteSettings } from "../src/services/settings.js";

vi.mock("../src/services/users.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/users.js")>();

  return {
    ...actual,
    ensureBootstrapAdmin: vi.fn(async () => ({
      id: "00000000-0000-0000-0000-000000000001",
      email: "admin@tokurl.local",
      username: "admin",
      role: "admin" as const
    }))
  };
});

vi.mock("../src/services/links.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/links.js")>();

  return {
    ...actual,
    getRedirectLink: vi.fn()
  };
});

vi.mock("../src/services/settings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/settings.js")>();

  return {
    ...actual,
    getSiteSettings: vi.fn()
  };
});

vi.mock("../src/services/analytics.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/analytics.js")>();

  return {
    ...actual,
    enqueueClick: vi.fn(async () => undefined)
  };
});

const testConfig: AppConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 8080,
  databaseUrl: "postgres://tokurl:tokurl@localhost:5432/tokurl",
  redisUrl: "redis://localhost:6379",
  publicShortBaseUrl: "http://localhost:18085",
  corsOrigins: ["http://localhost:13010"],
  slugLength: 5,
  redirectStatus: 302,
  cacheTtlSeconds: 300,
  adminToken: "",
  authSecret: "tokurl-test-auth-secret-with-at-least-32-bytes",
  bootstrapAdminEmail: "admin@tokurl.local",
  bootstrapAdminPassword: "tokurl-admin",
  allowRegistration: true,
  cookieSecure: false,
  titleFetchTimeoutMs: 1200,
  titleFetchMaxBytes: 131_072,
  titleFetchAllowPrivateHosts: true,
  hashSalt: "tokurl-test-salt",
  analyticsEnabled: true
};

function createRedisMock() {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1)
  };
}

async function createApp() {
  const redis = createRedisMock();
  const app = await buildApp({
    config: testConfig,
    db: {} as never,
    redis: redis as never
  });

  return { app, redis };
}

describe("redirect route analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRedirectLink).mockResolvedValue({
      id: "30000000-0000-0000-0000-000000000001",
      slug: "go",
      targetUrl: "https://example.com/landing?x=1&y=2",
      isActive: true,
      expiresAt: null
    });
    vi.mocked(getSiteSettings).mockResolvedValue({
      ...defaultSiteSettings,
      analyticsCode: "",
      redirectAnalyticsEnabled: false,
      updatedAt: "1970-01-01T00:00:00.000Z"
    });
    vi.mocked(enqueueClick).mockResolvedValue(undefined);
  });

  it("keeps the fast 302 redirect when no external analytics code is configured", async () => {
    const { app, redis } = await createApp();

    try {
      const response = await app.inject({ method: "GET", url: "/go" });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("https://example.com/landing?x=1&y=2");
      expect(response.body).toBe("");
      expect(redis.set).toHaveBeenCalledWith("tokurl:settings:redirect-analytics-code", "", "EX", 60);
    } finally {
      await app.close();
    }
  });

  it("keeps the fast 302 redirect when external analytics code exists but redirect tracking is disabled", async () => {
    vi.mocked(getSiteSettings).mockResolvedValue({
      ...defaultSiteSettings,
      analyticsCode: "<script>window.__tokurlAnalytics = true;</script>",
      redirectAnalyticsEnabled: false,
      updatedAt: "2026-06-13T00:00:00.000Z"
    });
    const { app } = await createApp();

    try {
      const response = await app.inject({ method: "GET", url: "/go" });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("https://example.com/landing?x=1&y=2");
      expect(response.body).toBe("");
    } finally {
      await app.close();
    }
  });

  it("renders a tracked redirect page when external analytics code is configured and redirect tracking is enabled", async () => {
    vi.mocked(getSiteSettings).mockResolvedValue({
      ...defaultSiteSettings,
      analyticsCode: "<script>window.__tokurlAnalytics = true;</script>",
      redirectAnalyticsEnabled: true,
      updatedAt: "2026-06-13T00:00:00.000Z"
    });
    const { app } = await createApp();

    try {
      const response = await app.inject({ method: "GET", url: "/go" });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.headers["content-security-policy"]).toContain("'unsafe-inline'");
      expect(response.headers.location).toBeUndefined();
      expect(response.body).toContain("window.__tokurlAnalytics = true");
      expect(response.body).toContain("tokurl_redirect");
      expect(response.body).toContain("即将抵达");
      expect(response.body).toContain("把漫长的网址，折成一枚轻舟");
      expect(response.body).toContain("继续前往");
      expect(response.body).not.toContain("正在记录访问并跳转到目标页面");
      expect(response.body).toContain("https://example.com/landing?x=1\\u0026y=2");
      expect(response.body).toContain("https://example.com/landing?x=1&amp;y=2");
    } finally {
      await app.close();
    }
  });

  it("keeps HEAD requests as direct redirects without rendering the tracking page", async () => {
    vi.mocked(getSiteSettings).mockResolvedValue({
      ...defaultSiteSettings,
      analyticsCode: "<script>window.__tokurlAnalytics = true;</script>",
      redirectAnalyticsEnabled: true,
      updatedAt: "2026-06-13T00:00:00.000Z"
    });
    const { app } = await createApp();

    try {
      const response = await app.inject({ method: "HEAD", url: "/go" });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("https://example.com/landing?x=1&y=2");
      expect(response.body).toBe("");
      expect(getSiteSettings).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
