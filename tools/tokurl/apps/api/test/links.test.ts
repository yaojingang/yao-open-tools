import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config.js";
import type { DbClient } from "../src/db/client.js";
import type { LinkRecord } from "../src/db/schema.js";
import { createLink, updateLink } from "../src/services/links.js";
import type { AuthUser } from "../src/services/auth.js";

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

const regularUser: AuthUser = {
  id: "10000000-0000-0000-0000-000000000001",
  email: "user",
  username: "user",
  role: "user"
};

const adminUser: AuthUser = {
  id: "20000000-0000-0000-0000-000000000001",
  email: "admin@tokurl.local",
  username: "admin",
  role: "admin"
};

function linkRecord(overrides: Partial<LinkRecord> = {}): LinkRecord {
  return {
    id: "30000000-0000-0000-0000-000000000001",
    ownerId: regularUser.id,
    slug: "abcde",
    targetUrl: "https://example.com",
    title: "Example",
    description: null,
    isActive: true,
    expiresAt: null,
    createdAt: new Date("2026-06-12T00:00:00.000Z"),
    updatedAt: new Date("2026-06-12T00:00:00.000Z"),
    clickCount: 0,
    lastClickedAt: null,
    ...overrides
  };
}

function createDbMock(options: { todaysLinks: number; returning?: LinkRecord }) {
  const limit = vi.fn(async () => [{ total: options.todaysLinks }]);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const returning = vi.fn(async () => [options.returning ?? linkRecord()]);
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));

  return {
    db: { select, insert } as unknown as DbClient,
    mocks: {
      select,
      insert,
      values,
      returning
    }
  };
}

function createServices(db: DbClient) {
  return {
    db,
    redis: { del: vi.fn(async () => 1) } as never,
    config: testConfig
  };
}

describe("links service", () => {
  it("rejects regular users after 5 created links in the current day", async () => {
    const { db, mocks } = createDbMock({ todaysLinks: 5 });

    await expect(
      createLink(
        createServices(db),
        {
          targetUrl: "https://example.com/quota",
          title: "Quota"
        },
        regularUser
      )
    ).rejects.toMatchObject({
      statusCode: 429,
      code: "daily_quota_exceeded"
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects regular users when creating a custom slug", async () => {
    const { db, mocks } = createDbMock({ todaysLinks: 0 });

    await expect(
      createLink(
        createServices(db),
        {
          targetUrl: "https://example.com/custom",
          slug: "custom",
          title: "Custom"
        },
        regularUser
      )
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "custom_slug_forbidden"
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("treats blank slugs from regular users as default generated links", async () => {
    const { db, mocks } = createDbMock({ todaysLinks: 0 });

    await expect(
      createLink(
        createServices(db),
        {
          targetUrl: "https://example.com/default",
          slug: "   ",
          title: "Default"
        },
        regularUser
      )
    ).resolves.toMatchObject({
      slug: "abcde",
      shortUrl: "http://localhost:18085/abcde"
    });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it("allows admins to create links without the daily user quota", async () => {
    const { db, mocks } = createDbMock({
      todaysLinks: 99,
      returning: linkRecord({ ownerId: adminUser.id, slug: "adm01" })
    });

    await expect(
      createLink(
        createServices(db),
        {
          targetUrl: "https://example.com/admin",
          slug: "adm01",
          title: "Admin"
        },
        adminUser
      )
    ).resolves.toMatchObject({
      slug: "adm01",
      shortUrl: "http://localhost:18085/adm01"
    });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it("rejects regular users when editing a link slug", async () => {
    const existing = linkRecord({ ownerId: regularUser.id, slug: "abcde" });
    const limit = vi.fn(async () => [existing]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const returning = vi.fn(async () => [linkRecord({ ...existing, slug: "custom" })]);
    const updateWhere = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set }));
    const db = {
      select,
      update
    } as unknown as DbClient;

    await expect(
      updateLink(
        createServices(db),
        existing.id,
        {
          slug: "custom"
        },
        regularUser
      )
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "custom_slug_forbidden"
    });
    expect(update).not.toHaveBeenCalled();
  });
});
