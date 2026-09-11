import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import type { DbClient } from "../src/db/client.js";
import {
  canAccessOwnedResource,
  createAuthGuard,
  canManageUsers,
  canReadAllResources,
  hashPassword,
  sessionCookieName,
  signSession,
  verifyPassword,
  verifySession
} from "../src/services/auth.js";

const adminUser = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "admin@tokurl.local",
  username: "admin",
  role: "admin" as const
};

const normalUser = {
  id: "00000000-0000-0000-0000-000000000002",
  email: "user",
  username: "user",
  role: "user" as const
};

describe("auth service", () => {
  it("hashes passwords and verifies only the matching password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).not.toBe("correct horse battery staple");
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(hash, "wrong password")).toBe(false);
  });

  it("signs and verifies a user session", async () => {
    const secret = "tokurl-test-secret-with-at-least-32-bytes";
    const token = await signSession(adminUser, secret);
    const session = await verifySession(token, secret);

    expect(session).toMatchObject(adminUser);
  });

  it("keeps a disabled account's old session revoked after the account is enabled again", async () => {
    const config = loadConfig({ NODE_ENV: "test" });
    const token = await signSession(normalUser, config.authSecret);
    let active = true;
    let sessionVersion = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => active ? [{
              ...normalUser,
              passwordHash: "hash",
              name: null,
              isActive: true,
              sessionVersion,
              createdAt: new Date(0),
              updatedAt: new Date(0),
              lastLoginAt: null
            }] : []
          })
        })
      })
    } as unknown as DbClient;
    const app = Fastify();
    await app.register(cookie);
    app.get("/protected", { preHandler: createAuthGuard({ config, db }) }, async () => ({ ok: true }));

    try {
      const activeResponse = await app.inject({
        method: "GET",
        url: "/protected",
        cookies: { [sessionCookieName]: token }
      });
      expect(activeResponse.statusCode).toBe(200);

      active = false;
      const disabledResponse = await app.inject({ method: "GET", url: "/protected", cookies: { [sessionCookieName]: token } });
      expect(disabledResponse.statusCode).toBe(401);

      active = true;
      sessionVersion = 1;
      const enabledResponse = await app.inject({ method: "GET", url: "/protected", cookies: { [sessionCookieName]: token } });
      expect(enabledResponse.statusCode).toBe(401);

      const nextToken = await signSession(normalUser, config.authSecret, sessionVersion);
      const nextResponse = await app.inject({ method: "GET", url: "/protected", cookies: { [sessionCookieName]: nextToken } });
      expect(nextResponse.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("does not fall back to a machine token when a disabled browser session is present", async () => {
    const config = loadConfig({ NODE_ENV: "test", TOKURL_ADMIN_TOKEN: "machine-token" });
    const token = await signSession(normalUser, config.authSecret);
    let currentRows: unknown[] = [];
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => currentRows }) }) })
    } as unknown as DbClient;
    const app = Fastify();
    await app.register(cookie);
    app.get("/protected", { preHandler: createAuthGuard({ config, db }) }, async () => ({ ok: true }));

    try {
      const disabledResponse = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: "Bearer machine-token" },
        cookies: { [sessionCookieName]: token }
      });
      expect(disabledResponse.statusCode).toBe(401);

      currentRows = [{ ...adminUser, isActive: true }];
      const machineResponse = await app.inject({
        method: "GET",
        url: "/protected",
        headers: { authorization: "Bearer machine-token" }
      });
      expect(machineResponse.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("enforces admin and owner resource permissions", () => {
    expect(canManageUsers(adminUser)).toBe(true);
    expect(canManageUsers(normalUser)).toBe(false);

    expect(canReadAllResources(adminUser)).toBe(true);
    expect(canReadAllResources(normalUser)).toBe(false);

    expect(canAccessOwnedResource(adminUser, normalUser.id)).toBe(true);
    expect(canAccessOwnedResource(normalUser, normalUser.id)).toBe(true);
    expect(canAccessOwnedResource(normalUser, adminUser.id)).toBe(false);
  });
});
