import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { DbClient } from "../src/db/client.js";
import { siteSettings, type SiteSettingsRecord } from "../src/db/schema.js";
import { registerAuthRoutes } from "../src/routes/auth.js";
import { registerSettingsRoutes } from "../src/routes/settings.js";
import { sessionCookieName, signSession } from "../src/services/auth.js";
import { defaultSiteSettings } from "../src/services/settings.js";
import { registerUser } from "../src/services/users.js";

vi.mock("../src/services/users.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/services/users.js")>(),
  ensureBootstrapAdmin: vi.fn()
}));

function fixture(registrationEnabled = true, allowRegistration = true, role = "user") {
  const config = loadConfig({ NODE_ENV: "test", TOKURL_ALLOW_REGISTRATION: String(allowRegistration) });
  let settings: SiteSettingsRecord = {
    id: "default", ...defaultSiteSettings, registrationEnabled, updatedAt: new Date(0)
  };
  const user = { id: "00000000-0000-0000-0000-000000000001", email: "alice", username: "alice", role, isActive: true, sessionVersion: 0 };
  const insert = vi.fn(() => ({
    values: () => ({
      onConflictDoUpdate: ({ set }: { set: Partial<SiteSettingsRecord> }) => ({
        returning: async () => {
          settings = { ...settings, ...set };
          return [settings];
        }
      })
    })
  }));
  const execute = vi.fn(async () => []);
  const transaction = vi.fn(async (operation: (transaction: DbClient) => Promise<unknown>) => operation(db));
  const db = {
    select: vi.fn(() => ({ from: (table: unknown) => ({
      where: () => ({ limit: async () => table === siteSettings ? [settings] : [user] })
    }) })),
    insert,
    execute,
    transaction
  } as unknown as DbClient;
  const setMock = vi.fn(() => { throw new Error("Redis should not be used for closed registration"); });
  const redis = { set: setMock, del: vi.fn(async () => 0) } as never;
  return { config, db, redis, insert, setMock, user };
}

describe("public registration control", () => {
  it("parses the documented environment switch without treating false as truthy", () => {
    expect(loadConfig({}).allowRegistration).toBe(true);
    expect(loadConfig({ TOKURL_ALLOW_REGISTRATION: "true" }).allowRegistration).toBe(true);
    expect(loadConfig({ TOKURL_ALLOW_REGISTRATION: "false" }).allowRegistration).toBe(false);
    expect(() => loadConfig({ TOKURL_ALLOW_REGISTRATION: "invalid" })).toThrow();
  });

  it.each([[false, true], [true, false], [false, false]])(
    "rejects direct registration when site=%s and environment=%s before rate limits or writes",
    async (siteEnabled, envEnabled) => {
      const context = fixture(siteEnabled, envEnabled);
      const app = Fastify();
      await app.register(cookie);
      await registerAuthRoutes(app, context);
      try {
        const response = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "new-user", password: "test-password" } });
        expect(response.statusCode).toBe(403);
        expect(response.json().error).toBe("registration_disabled");
        expect(response.headers["set-cookie"]).toBeUndefined();
        expect(context.setMock).not.toHaveBeenCalled();
        expect(context.insert).not.toHaveBeenCalled();
        await expect(registerUser(context, { username: "new-user", password: "test-password" })).rejects.toMatchObject({ statusCode: 403, code: "registration_disabled" });
      } finally {
        await app.close();
      }
    }
  );

  it.each([[true, true, true], [false, true, false], [true, false, false], [false, false, false]])(
    "exposes effective public config for site=%s and environment=%s",
    async (siteEnabled, envEnabled, expected) => {
      const app = await buildApp(fixture(siteEnabled, envEnabled));
      try {
        const response = await app.inject({ method: "GET", url: "/api/config" });
        expect(response.statusCode).toBe(200);
        expect(response.json().allowRegistration).toBe(expected);
        expect(response.json().siteSettings.registrationEnabled).toBe(siteEnabled);
        expect(response.headers["cache-control"]).toBe("no-store");
      } finally {
        await app.close();
      }
    }
  );

  it.each(["guest", "user", "admin"])("restricts the registration setting for %s", async (role) => {
    const context = fixture(true, true, role);
    const app = Fastify();
    await app.register(cookie);
    await registerSettingsRoutes(app, context);
    const session = role === "guest" ? undefined : await signSession({ ...context.user, role: role as "user" | "admin" }, context.config.authSecret);
    try {
      const response = await app.inject({
        method: "PATCH", url: "/api/settings/site",
        cookies: session ? { [sessionCookieName]: session } : {},
        payload: { registrationEnabled: false }
      });
      expect(response.statusCode).toBe(role === "admin" ? 200 : role === "guest" ? 401 : 403);
      if (role === "admin") {
        expect(response.json().registrationEnabled).toBe(false);
        const reopened = await app.inject({ method: "PATCH", url: "/api/settings/site", cookies: { [sessionCookieName]: session! }, payload: { registrationEnabled: true } });
        expect(reopened.statusCode).toBe(200);
        expect(reopened.json().registrationEnabled).toBe(true);
      } else {
        expect(context.insert).not.toHaveBeenCalled();
      }
    } finally {
      await app.close();
    }
  });
});
