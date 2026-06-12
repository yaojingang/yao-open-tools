import type { FastifyReply, FastifyRequest } from "fastify";
import { Algorithm, hash, verify } from "@node-rs/argon2";
import { and, eq } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import type { AppConfig } from "../config.js";
import type { DbClient } from "../db/client.js";
import { users } from "../db/schema.js";

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: AuthUser;
  }
}

export type UserRole = "admin" | "user";

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: UserRole;
}

interface SessionPayload {
  email: string;
  username?: string;
  role: UserRole;
}

interface AuthGuardContext {
  config: AppConfig;
  db: DbClient;
}

export const sessionCookieName = "tokurl_session";
export const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;
const sessionIssuer = "tokurl";
const encoder = new TextEncoder();
const legacyLocalDomain = "@tokurl.local";

function usernameFromIdentifier(identifier: string): string {
  const normalized = identifier.trim().toLowerCase();
  return normalized.endsWith(legacyLocalDomain) ? normalized.slice(0, -legacyLocalDomain.length) : normalized;
}

function getSessionKey(secret: string): Uint8Array {
  return encoder.encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1
  });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export async function signSession(user: AuthUser, secret: string): Promise<string> {
  return new SignJWT({ email: user.email, username: user.username, role: user.role } satisfies SessionPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(sessionIssuer)
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSessionKey(secret));
}

export async function verifySession(token: string, secret: string): Promise<AuthUser> {
  const { payload } = await jwtVerify<SessionPayload>(token, getSessionKey(secret), {
    issuer: sessionIssuer
  });

  if (!payload.sub || !payload.email || (payload.role !== "admin" && payload.role !== "user")) {
    throw new Error("Invalid TokURL session payload.");
  }

  return {
    id: payload.sub,
    email: payload.email,
    username: payload.username ?? usernameFromIdentifier(payload.email),
    role: payload.role
  };
}

export function getSessionCookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.cookieSecure,
    path: "/",
    maxAge: sessionMaxAgeSeconds
  };
}

export function canManageUsers(user: AuthUser): boolean {
  return user.role === "admin";
}

export function canReadAllResources(user: AuthUser): boolean {
  return user.role === "admin";
}

export function canAccessOwnedResource(user: AuthUser, ownerId: string | null | undefined): boolean {
  return user.role === "admin" || Boolean(ownerId && ownerId === user.id);
}

async function getActiveUser(db: DbClient, id: string): Promise<AuthUser | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.isActive, true)))
    .limit(1);

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    username: usernameFromIdentifier(user.email),
    role: user.role === "admin" ? "admin" : "user"
  };
}

async function getFirstActiveAdmin(db: DbClient): Promise<AuthUser | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true)))
    .limit(1);

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    username: usernameFromIdentifier(user.email),
    role: "admin"
  };
}

export function createAuthGuard(context: AuthGuardContext) {
  return async function authGuard(request: FastifyRequest, reply: FastifyReply) {
    const authorization = request.headers.authorization ?? "";

    if (context.config.adminToken && authorization === `Bearer ${context.config.adminToken}`) {
      const admin = await getFirstActiveAdmin(context.db);
      if (admin) {
        request.currentUser = admin;
        return;
      }
    }

    const sessionToken = request.cookies?.[sessionCookieName];
    if (sessionToken) {
      try {
        const session = await verifySession(sessionToken, context.config.authSecret);
        const activeUser = await getActiveUser(context.db, session.id);
        if (activeUser) {
          request.currentUser = activeUser;
          return;
        }
      } catch {
        // Fall through to the uniform unauthorized response.
      }
    }

    return reply.status(401).send({
      error: "Unauthorized",
      message: "A valid TokURL session is required."
    });
  };
}

export function createAdminGuard(config: AppConfig) {
  return async function adminGuard(request: FastifyRequest, reply: FastifyReply) {
    if (!config.adminToken) {
      return;
    }

    const authorization = request.headers.authorization ?? "";
    const expected = `Bearer ${config.adminToken}`;

    if (authorization !== expected) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "A valid TokURL admin token is required."
      });
    }
  };
}
