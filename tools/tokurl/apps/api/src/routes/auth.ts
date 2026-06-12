import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type { AppConfig } from "../config.js";
import type { DbClient } from "../db/client.js";
import { createAuthGuard, getSessionCookieOptions, sessionCookieName, signSession } from "../services/auth.js";
import { releaseDailyRegistrationSlot, reserveDailyRegistrationSlot, type RegistrationReservation } from "../services/registration-limit.js";
import { loginSchema, loginUser, registerSchema, registerUser } from "../services/users.js";
import { parseRequest, sendError } from "./http.js";

interface RouteContext {
  config: AppConfig;
  db: DbClient;
  redis: Redis;
}

export async function registerAuthRoutes(app: FastifyInstance, context: RouteContext) {
  const services = {
    config: context.config,
    db: context.db
  };
  const authGuard = createAuthGuard(context);

  app.post("/api/auth/register", async (request, reply) => {
    let reservation: RegistrationReservation | null = null;
    let registered = false;

    try {
      const body = parseRequest(registerSchema, request.body);
      reservation = await reserveDailyRegistrationSlot(context.redis, {
        ip: request.ip,
        clientId: request.headers["x-tokurl-client-id"],
        userAgent: request.headers["user-agent"],
        hashSalt: context.config.hashSalt
      });
      const { user, authUser } = await registerUser(services, body);
      registered = true;
      const token = await signSession(authUser, context.config.authSecret);

      return reply.setCookie(sessionCookieName, token, getSessionCookieOptions(context.config)).status(201).send({ user });
    } catch (error) {
      if (!registered) {
        await releaseDailyRegistrationSlot(context.redis, reservation);
      }

      return sendError(reply, error);
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    try {
      const body = parseRequest(loginSchema, request.body);
      const user = await loginUser(services, body);
      const token = await signSession(user, context.config.authSecret);

      return reply.setCookie(sessionCookieName, token, getSessionCookieOptions(context.config)).send({ user });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    return reply.clearCookie(sessionCookieName, { path: "/" }).status(204).send();
  });

  app.get("/api/auth/me", { preHandler: authGuard }, async (request) => ({
    user: request.currentUser
  }));
}
