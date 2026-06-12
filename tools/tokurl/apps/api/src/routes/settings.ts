import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import type { DbClient } from "../db/client.js";
import { canManageUsers, createAuthGuard } from "../services/auth.js";
import { getSiteSettings, updateSiteSettings, updateSiteSettingsSchema } from "../services/settings.js";
import { parseRequest, sendError } from "./http.js";

interface RouteContext {
  config: AppConfig;
  db: DbClient;
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.currentUser || !canManageUsers(request.currentUser)) {
    return reply.status(403).send({
      error: "Forbidden",
      message: "Admin role is required."
    });
  }
}

export async function registerSettingsRoutes(app: FastifyInstance, context: RouteContext) {
  const services = {
    db: context.db
  };
  const authGuard = createAuthGuard(context);

  await app.register(
    async (api) => {
      api.addHook("preHandler", authGuard);
      api.addHook("preHandler", requireAdmin);

      api.get("/settings/site", async (_request, reply) => {
        try {
          return await getSiteSettings(services);
        } catch (error) {
          return sendError(reply, error);
        }
      });

      api.patch("/settings/site", async (request, reply) => {
        try {
          const body = parseRequest(updateSiteSettingsSchema, request.body);
          return await updateSiteSettings(services, body);
        } catch (error) {
          return sendError(reply, error);
        }
      });
    },
    { prefix: "/api" }
  );
}
