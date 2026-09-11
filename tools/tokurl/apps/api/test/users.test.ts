import { describe, expect, it, vi } from "vitest";
import { hashPassword, type AuthUser } from "../src/services/auth.js";
import { canResetUserPassword, canUpdateUserProfile, deleteUser, loginSchema, loginUser, registerSchema, toPublicUser, updateUser } from "../src/services/users.js";
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
    sessionVersion: 0,
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
  const execute = vi.fn(async () => []);
  const transaction = vi.fn(async (operation: (transaction: DbClient) => Promise<unknown>) => operation(db));
  const db = {
    select,
    update,
    delete: deleteFn,
    execute,
    transaction
  } as unknown as DbClient;

  return {
    db,
    mocks: {
      select,
      update,
      set,
      updateWhere,
      deleteFn,
      returning,
      execute,
      transaction
    }
  };
}

function createLoginDbMock(record: UserRecord) {
  const limit = vi.fn(async () => [record]);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const update = vi.fn();

  return {
    db: { select, update } as unknown as DbClient,
    update
  };
}

function createUpdateUserDbMock(target: UserRecord) {
  const limit = vi.fn(async () => [target]);
  const whereSelect = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where: whereSelect }));
  const select = vi.fn(() => ({ from }));
  const returning = vi.fn(async () => [{ ...target, isActive: false, sessionVersion: target.sessionVersion + 1 }]);
  const whereUpdate = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where: whereUpdate }));
  const update = vi.fn(() => ({ set }));
  const execute = vi.fn(async () => []);
  const transaction = vi.fn(async (operation: (transaction: DbClient) => Promise<unknown>) => operation(db));
  const db = { select, update, execute, transaction } as unknown as DbClient;

  return { db, mocks: { set, execute, transaction } };
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

describe("disabled account access", () => {
  it("rejects login for an inactive user without updating login metadata", async () => {
    const { db, update } = createLoginDbMock(userRecord({ isActive: false }));

    await expect(loginUser({ db, config: {} as never }, { username: "alice", password: "tokurl-pass" })).rejects.toMatchObject({
      statusCode: 401,
      code: "invalid_credentials"
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("increments the session version while disabling an account under the admin invariant lock", async () => {
    const { db, mocks } = createUpdateUserDbMock(userRecord());

    await expect(updateUser({ db, config: {} as never }, user.id, { isActive: false })).resolves.toMatchObject({
      id: user.id,
      isActive: false
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ isActive: false, sessionVersion: expect.anything() }));
  });

  it("rejects login when the account changes after password verification", async () => {
    const record = userRecord({ passwordHash: await hashPassword("test-password") });
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [record] }) }) }));
    const returning = vi.fn(async () => []);
    const update = vi.fn(() => ({ set: () => ({ where: () => ({ returning }) }) }));
    const db = { select, update } as unknown as DbClient;

    await expect(loginUser({ db, config: {} as never }, { username: "alice", password: "test-password" })).rejects.toMatchObject({
      statusCode: 401,
      code: "invalid_credentials"
    });
    expect(returning).toHaveBeenCalledTimes(1);
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
