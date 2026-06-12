import { describe, expect, it } from "vitest";
import {
  canAccessOwnedResource,
  canManageUsers,
  canReadAllResources,
  hashPassword,
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
