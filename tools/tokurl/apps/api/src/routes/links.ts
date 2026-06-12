import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { DbClient } from "../db/client.js";
import type { Redis } from "ioredis";
import { createAuthGuard } from "../services/auth.js";
import {
  createLink,
  createLinkSchema,
  deleteLink,
  getAllLinkStats,
  getLinkById,
  getLinkStats,
  listLinks,
  updateLink,
  updateLinkSchema
} from "../services/links.js";
import { parseRequest, sendError } from "./http.js";

interface RouteContext {
  config: AppConfig;
  db: DbClient;
  redis: Redis;
}

const listQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum(["all", "active", "paused"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

export async function registerLinkRoutes(app: FastifyInstance, context: RouteContext) {
  const services = {
    config: context.config,
    db: context.db,
    redis: context.redis
  };

  await app.register(
    async (api) => {
      api.addHook("preHandler", createAuthGuard({ config: context.config, db: context.db }));

      api.get("/links", async (request, reply) => {
        try {
          const query = parseRequest(listQuerySchema, request.query);
          return await listLinks(services, query, request.currentUser!);
        } catch (error) {
          return sendError(reply, error);
        }
      });

      api.post("/links", async (request, reply) => {
        try {
          const body = parseRequest(createLinkSchema, request.body);
          const link = await createLink(services, body, request.currentUser!);
          return reply.status(201).send(link);
        } catch (error) {
          return sendError(reply, error);
        }
      });

      api.get("/links/stats", async (_request, reply) => {
        try {
          return await getAllLinkStats(services, _request.currentUser!);
        } catch (error) {
          return sendError(reply, error);
        }
      });

      api.get("/links/:id", async (request, reply) => {
        try {
          const { id } = request.params as { id: string };
          return await getLinkById(services, id, request.currentUser!);
        } catch (error) {
          return sendError(reply, error);
        }
      });

      api.patch("/links/:id", async (request, reply) => {
        try {
          const { id } = request.params as { id: string };
          const body = parseRequest(updateLinkSchema, request.body);
          return await updateLink(services, id, body, request.currentUser!);
        } catch (error) {
          return sendError(reply, error);
        }
      });

      api.delete("/links/:id", async (request, reply) => {
        try {
          const { id } = request.params as { id: string };
          return await deleteLink(services, id, request.currentUser!);
        } catch (error) {
          return sendError(reply, error);
        }
      });

      api.get("/links/:id/stats", async (request, reply) => {
        try {
          const { id } = request.params as { id: string };
          return await getLinkStats(services, id, request.currentUser!);
        } catch (error) {
          return sendError(reply, error);
        }
      });
    },
    { prefix: "/api" }
  );
}
