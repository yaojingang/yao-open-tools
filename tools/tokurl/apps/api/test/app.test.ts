import { describe, expect, it, vi } from "vitest";
import { buildApp, corsMethods } from "../src/app.js";
import type { AppConfig } from "../src/config.js";

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

describe("app CORS configuration", () => {
  it("allows browser preflight for link mutation methods", () => {
    expect(corsMethods).toEqual(expect.arrayContaining(["POST", "PATCH", "DELETE", "OPTIONS"]));
  });

  it("returns mutation methods in the runtime preflight response", async () => {
    const app = await buildApp({
      config: testConfig,
      db: {} as never,
      redis: {} as never
    });

    try {
      const response = await app.inject({
        method: "OPTIONS",
        url: "/api/links/test-id",
        headers: {
          origin: "http://localhost:13010",
          "access-control-request-method": "DELETE"
        }
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-methods"]).toContain("PATCH");
      expect(response.headers["access-control-allow-methods"]).toContain("DELETE");
    } finally {
      await app.close();
    }
  });
});
