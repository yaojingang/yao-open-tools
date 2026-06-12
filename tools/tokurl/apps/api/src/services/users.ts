import { and, count, desc, eq, ilike, inArray, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { DbClient } from "../db/client.js";
import { links, users, type NewUserRecord, type UserRecord } from "../db/schema.js";
import { ServiceError, isUniqueViolation } from "../utils/errors.js";
import { type AuthUser, canManageUsers, hashPassword, verifyPassword, type UserRole } from "./auth.js";

const usernamePattern = /^[\p{L}\p{N}._-]+$/u;
const legacyLocalDomain = "@tokurl.local";

const usernameSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(usernamePattern, "Username can only contain letters, numbers, dots, underscores, and hyphens.");

export const registerSchema = z
  .object({
    username: usernameSchema,
    password: z.string().min(8).max(200)
  })
  .strict();

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200)
});

const roleSchema = z.enum(["admin", "user"]);

export const createUserSchema = registerSchema.extend({
  role: roleSchema.default("user"),
  isActive: z.boolean().optional()
});

export const updateUserSchema = z
  .object({
    username: usernameSchema.optional(),
    role: roleSchema.optional(),
    isActive: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required"
  });

export const resetPasswordSchema = z.object({
  password: z.string().min(8).max(200)
});

export const bulkDeleteUsersSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100)
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type BulkDeleteUsersInput = z.infer<typeof bulkDeleteUsersSchema>;

interface UserServices {
  db: DbClient;
  config: AppConfig;
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function usernameFromIdentifier(identifier: string): string {
  const normalized = identifier.trim().toLowerCase();
  return normalized.endsWith(legacyLocalDomain) ? normalized.slice(0, -legacyLocalDomain.length) : normalized;
}

function identifierCandidates(username: string): string[] {
  const normalized = normalizeUsername(username);
  return normalized.includes("@") ? [normalized] : [normalized, `${normalized}${legacyLocalDomain}`];
}

function toRole(value: string): UserRole {
  return value === "admin" ? "admin" : "user";
}

function toAuthUser(user: UserRecord): AuthUser {
  return {
    id: user.id,
    email: user.email,
    username: usernameFromIdentifier(user.email),
    role: toRole(user.role)
  };
}

export function toPublicUser(user: UserRecord) {
  return {
    id: user.id,
    username: usernameFromIdentifier(user.email),
    role: toRole(user.role),
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null
  };
}

export function canUpdateUserProfile(viewer: AuthUser, targetUserId: string, input: UpdateUserInput): boolean {
  if (canManageUsers(viewer)) {
    return true;
  }

  if (viewer.id !== targetUserId) {
    return false;
  }

  return input.role === undefined && input.isActive === undefined;
}

export function canResetUserPassword(viewer: AuthUser, targetUserId: string): boolean {
  return canManageUsers(viewer) || viewer.id === targetUserId;
}

async function getFirstAdmin(services: UserServices): Promise<UserRecord | null> {
  const [admin] = await services.db
    .select()
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true)))
    .orderBy(users.createdAt)
    .limit(1);

  return admin ?? null;
}

async function assignUnownedLinksToAdmin(services: UserServices, adminId: string): Promise<void> {
  await services.db.update(links).set({ ownerId: adminId, updatedAt: new Date() }).where(isNull(links.ownerId));
}

export async function ensureBootstrapAdmin(services: UserServices): Promise<AuthUser> {
  const [summary] = await services.db.select({ total: count() }).from(users);
  let admin = await getFirstAdmin(services);

  if ((summary?.total ?? 0) === 0) {
    const now = new Date();
    const [created] = await services.db
      .insert(users)
      .values({
        email: services.config.bootstrapAdminEmail.trim().toLowerCase(),
        name: "TokURL Admin",
        passwordHash: await hashPassword(services.config.bootstrapAdminPassword),
        role: "admin",
        isActive: true,
        createdAt: now,
        updatedAt: now
      })
      .returning();

    admin = created ?? null;
  }

  if (!admin) {
    throw new ServiceError(500, "TokURL requires at least one active admin user.", "admin_required");
  }

  await assignUnownedLinksToAdmin(services, admin.id);
  return toAuthUser(admin);
}

export async function getActiveUserById(services: UserServices, id: string): Promise<UserRecord | null> {
  const [user] = await services.db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.isActive, true)))
    .limit(1);

  return user ?? null;
}

async function insertUser(services: UserServices, input: CreateUserInput): Promise<UserRecord> {
  const now = new Date();
  const username = normalizeUsername(input.username);
  const values: NewUserRecord = {
    email: username,
    name: null,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    isActive: input.isActive ?? true,
    createdAt: now,
    updatedAt: now
  };

  try {
    const [existing] = await services.db.select().from(users).where(inArray(users.email, identifierCandidates(username))).limit(1);
    if (existing) {
      throw new ServiceError(409, "Username is already registered.", "username_conflict");
    }

    const [created] = await services.db.insert(users).values(values).returning();
    if (!created) {
      throw new ServiceError(500, "User was not created.", "create_failed");
    }
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ServiceError(409, "Username is already registered.", "username_conflict");
    }

    throw error;
  }
}

export async function registerUser(services: UserServices, input: RegisterInput) {
  if (!services.config.allowRegistration) {
    throw new ServiceError(403, "Registration is disabled.", "registration_disabled");
  }

  const user = await insertUser(services, { ...input, role: "user", isActive: true });
  return {
    user: toPublicUser(user),
    authUser: toAuthUser(user)
  };
}

export async function createUser(services: UserServices, input: CreateUserInput) {
  return toPublicUser(await insertUser(services, input));
}

export async function loginUser(services: UserServices, input: LoginInput): Promise<AuthUser> {
  const [user] = await services.db
    .select()
    .from(users)
    .where(inArray(users.email, identifierCandidates(input.username)))
    .limit(1);

  if (!user || !user.isActive || !(await verifyPassword(user.passwordHash, input.password))) {
    throw new ServiceError(401, "Username or password is incorrect.", "invalid_credentials");
  }

  await services.db.update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));
  return toAuthUser(user);
}

export async function listUsers(services: UserServices, query: { search?: string; limit?: number; offset?: number }, viewer: AuthUser) {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);
  const search = query.search?.trim();
  const searchClause = search
    ? or(ilike(users.email, `%${search}%`), ilike(users.name, `%${search}%`), ilike(users.role, `%${search}%`))
    : undefined;
  const visibilityClause = canManageUsers(viewer) ? undefined : eq(users.id, viewer.id);
  const whereClause = searchClause && visibilityClause ? and(searchClause, visibilityClause) : (searchClause ?? visibilityClause);

  const [items, totalRows] = await Promise.all([
    services.db.select().from(users).where(whereClause).orderBy(desc(users.createdAt)).limit(limit).offset(offset),
    services.db.select({ total: count() }).from(users).where(whereClause)
  ]);

  return {
    items: items.map(toPublicUser),
    total: totalRows[0]?.total ?? 0,
    limit,
    offset
  };
}

async function wouldRemoveLastAdmin(services: UserServices, id: string, updates: UpdateUserInput): Promise<boolean> {
  if (updates.role !== "user" && updates.isActive !== false) {
    return false;
  }

  const [target] = await services.db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target || target.role !== "admin" || !target.isActive) {
    return false;
  }

  const [summary] = await services.db
    .select({ total: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true), ne(users.id, id)));

  return (summary?.total ?? 0) === 0;
}

async function wouldDeleteLastActiveAdmin(services: UserServices, id: string, target: UserRecord): Promise<boolean> {
  if (target.role !== "admin" || !target.isActive) {
    return false;
  }

  const [summary] = await services.db
    .select({ total: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true), ne(users.id, id)))
    .limit(1);

  return (summary?.total ?? 0) === 0;
}

export async function updateUser(services: UserServices, id: string, input: UpdateUserInput) {
  if (await wouldRemoveLastAdmin(services, id, input)) {
    throw new ServiceError(400, "At least one active admin user is required.", "last_admin");
  }

  const updates: Partial<NewUserRecord> = {
    updatedAt: new Date()
  };

  if (input.username !== undefined) {
    const username = normalizeUsername(input.username);
    const [existing] = await services.db
      .select()
      .from(users)
      .where(and(inArray(users.email, identifierCandidates(username)), ne(users.id, id)))
      .limit(1);

    if (existing) {
      throw new ServiceError(409, "Username is already registered.", "username_conflict");
    }

    updates.email = username;
  }

  if (input.role !== undefined) {
    updates.role = input.role;
  }

  if (input.isActive !== undefined) {
    updates.isActive = input.isActive;
  }

  const [updated] = await services.db.update(users).set(updates).where(eq(users.id, id)).returning();
  if (!updated) {
    throw new ServiceError(404, "User was not found.", "not_found");
  }

  return toPublicUser(updated);
}

export async function resetUserPassword(services: UserServices, id: string, input: ResetPasswordInput) {
  const [updated] = await services.db
    .update(users)
    .set({
      passwordHash: await hashPassword(input.password),
      updatedAt: new Date()
    })
    .where(eq(users.id, id))
    .returning();

  if (!updated) {
    throw new ServiceError(404, "User was not found.", "not_found");
  }

  return toPublicUser(updated);
}

export async function deleteUser(services: UserServices, id: string, viewer: AuthUser) {
  if (viewer.id === id) {
    throw new ServiceError(400, "Current user cannot delete their own account.", "self_delete_forbidden");
  }

  const [target] = await services.db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) {
    throw new ServiceError(404, "User was not found.", "not_found");
  }

  if (await wouldDeleteLastActiveAdmin(services, id, target)) {
    throw new ServiceError(400, "At least one active admin user is required.", "last_admin");
  }

  await services.db.update(links).set({ ownerId: viewer.id, updatedAt: new Date() }).where(eq(links.ownerId, id));
  const [deleted] = await services.db.delete(users).where(eq(users.id, id)).returning();
  if (!deleted) {
    throw new ServiceError(404, "User was not found.", "not_found");
  }

  return toPublicUser(deleted);
}

export async function bulkDeleteUsers(services: UserServices, input: BulkDeleteUsersInput, viewer: AuthUser) {
  const uniqueIds = [...new Set(input.ids)];
  const deleted = [];
  const skipped: Array<{ id: string; code: string; message: string }> = [];

  for (const id of uniqueIds) {
    try {
      deleted.push(await deleteUser(services, id, viewer));
    } catch (error) {
      if (error instanceof ServiceError) {
        skipped.push({
          id,
          code: error.code,
          message: error.message
        });
        continue;
      }

      throw error;
    }
  }

  return {
    deleted,
    skipped
  };
}
