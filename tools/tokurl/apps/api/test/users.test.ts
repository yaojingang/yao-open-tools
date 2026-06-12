import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../src/services/auth.js";
import { canResetUserPassword, canUpdateUserProfile, deleteUser, loginSchema, registerSchema, toPublicUser } from "../src/services/users.js";
import type { UserRecord } from "../src/db/schema.js";
import type { DbClient } from "../src/db/client.js";

const admin: AuthUser = {
  id: "admin-id",
  email: "admin@tokurl.local",
  username: "admin",
  role: "admin"
};

const user: AuthUser = {
  id: "user-id",
  email: "alice",
  username: "alice",
  role: "user"
};

function userRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "user-id",
    email: "alice",
    name: null,
    passwordHash: "hash",
    role: "user",
    isActive: true,
    createdAt: new Date("2026-06-12T00:00:00.000Z"),
    updatedAt: new Date("2026-06-12T00:00:00.000Z"),
    lastLoginAt: null,
    ...overrides
  };
}

function createDeleteUserDbMock(options: { target: UserRecord | null; remainingActiveAdmins?: number }) {
  const selectedRows: unknown[][] = [[options.target].filter(Boolean), [{ total: options.remainingActiveAdmins ?? 1 }]];
  const limit = vi.fn(async () => selectedRows.shift() ?? []);
  const whereSelect = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where: whereSelect }));
  const select = vi.fn(() => ({ from }));
  const updateWhere = vi.fn(async () => undefined);
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));
  const returning = vi.fn(async () => (options.target ? [options.target] : []));
  const whereDelete = vi.fn(() => ({ returning }));
  const deleteFn = vi.fn(() => ({ where: whereDelete }));

  return {
    db: {
      select,
      update,
      delete: deleteFn
    } as unknown as DbClient,
    mocks: {
      select,
      update,
      set,
      updateWhere,
      deleteFn,
      returning
    }
  };
}

describe("username credentials", () => {
  it("accepts username and password for registration and login", () => {
    expect(registerSchema.parse({ username: "alice", password: "tokurl-pass" })).toMatchObject({
      username: "alice",
      password: "tokurl-pass"
    });
    expect(loginSchema.parse({ username: "alice", password: "tokurl-pass" })).toMatchObject({
      username: "alice",
      password: "tokurl-pass"
    });
  });

  it("rejects email-only registration payloads", () => {
    expect(() => registerSchema.parse({ email: "alice@example.com", password: "tokurl-pass" })).toThrow();
  });

  it("presents legacy local email identifiers as usernames", () => {
    const publicUser = toPublicUser(userRecord({ email: "admin@tokurl.local" }));

    expect(publicUser).toMatchObject({
      username: "admin"
    });
    expect(publicUser).not.toHaveProperty("email");
    expect(publicUser).not.toHaveProperty("name");
  });
});

describe("user management permissions", () => {
  it("allows admins to update any user profile and password", () => {
    expect(canUpdateUserProfile(admin, "other-id", { username: "other" })).toBe(true);
    expect(canUpdateUserProfile(admin, "other-id", { role: "admin" })).toBe(true);
    expect(canUpdateUserProfile(admin, "other-id", { isActive: false })).toBe(true);
    expect(canResetUserPassword(admin, "other-id")).toBe(true);
  });

  it("allows users to update only their own username and password", () => {
    expect(canUpdateUserProfile(user, user.id, { username: "new-name" })).toBe(true);
    expect(canResetUserPassword(user, user.id)).toBe(true);
  });

  it("rejects user attempts to edit other accounts or privileged fields", () => {
    expect(canUpdateUserProfile(user, "other-id", { username: "other" })).toBe(false);
    expect(canUpdateUserProfile(user, user.id, { role: "admin" })).toBe(false);
    expect(canUpdateUserProfile(user, user.id, { isActive: false })).toBe(false);
    expect(canResetUserPassword(user, "other-id")).toBe(false);
  });
});

describe("user deletion", () => {
  it("forbids deleting the current signed-in user", async () => {
    const { db, mocks } = createDeleteUserDbMock({ target: userRecord({ id: admin.id, role: "admin" }) });

    await expect(deleteUser({ db, config: {} as never }, admin.id, admin)).rejects.toMatchObject({
      statusCode: 400,
      code: "self_delete_forbidden"
    });
    expect(mocks.deleteFn).not.toHaveBeenCalled();
  });

  it("forbids deleting the last active admin", async () => {
    const target = userRecord({ id: "other-admin", email: "other-admin", role: "admin", isActive: true });
    const { db, mocks } = createDeleteUserDbMock({ target, remainingActiveAdmins: 0 });

    await expect(deleteUser({ db, config: {} as never }, target.id, admin)).rejects.toMatchObject({
      statusCode: 400,
      code: "last_admin"
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.deleteFn).not.toHaveBeenCalled();
  });

  it("transfers owned links to the acting admin before deleting a user", async () => {
    const target = userRecord({ id: "target-user", email: "target-user", role: "user" });
    const { db, mocks } = createDeleteUserDbMock({ target });

    await expect(deleteUser({ db, config: {} as never }, target.id, admin)).resolves.toMatchObject({
      id: target.id,
      username: "target-user"
    });
    expect(mocks.update).toHaveBeenCalled();
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ ownerId: admin.id }));
    expect(mocks.deleteFn).toHaveBeenCalled();
  });
});
