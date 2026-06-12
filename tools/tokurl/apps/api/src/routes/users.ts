import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { DbClient } from "../db/client.js";
import { canManageUsers, createAuthGuard } from "../services/auth.js";
import {
  canResetUserPassword,
  canUpdateUserProfile,
  bulkDeleteUsers,
  bulkDeleteUsersSchema,
  createUser,
  createUserSchema,
  deleteUser,
  listUsers,
  resetPasswordSchema,
  resetUserPassword,
  updateUser,
  updateUserSchema
} from "../services/users.js";
import { parseRequest, sendError } from "./http.js";

interface RouteContext {
  config: AppConfig;
  db: DbClient;
}

const listQuerySchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

const userParamsSchema = z.object({
  id: z.string().uuid()
});

function sendForbidden(reply: FastifyReply, message = "This account does not have permission.") {
  return reply.status(403).send({
    error: "Forbidden",
    message
  });
}

export async function registerUserRoutes(app: FastifyInstance, context: RouteContext) {
  const services = {
    config: context.config,
    db: context.db
  };
  const authGuard = createAuthGuard(context);

  await app.register(
    async (api) => {
      api.addHook("preHandler", authGuard);

      api.get("/users", async (request, reply) => {
        try {
          const query = parseRequest(listQuerySchema, request.query);
          return await listUsers(services, query, request.currentUser!);
        } catch (error) {
          return sendError(reply, error);
        }
      });

      api.post("/users", async (request, reply) => {
        if (!request.currentUser || !canManageUsers(request.currentUser)) {
          return sendForbidden(reply, "Admin role is required.");
        }

        try {
          const body = parseRequest(createUserSchema, request.body);
          const user = await createUser(services, body);
          return reply.status(201).send(user);
        } catch (error) {
          return sendError(reply, error);
        }
      });

      api.patch("/users/:id", async (request, reply) => {
        try {
          const { id } = parseRequest(userParamsSchema, request.params);
          const body = parseRequest(updateUserSchema, request.body);
          if (!canUpdateUserProfile(request.currentUser!, id, body)) {
            return sendForbidden(reply);
          }
          return await updateUser(services, id, body);
        } catch (error) {
          return sendError(reply, error);
        }
      });

      api.delete("/users/:id", async (request, reply) => {
        if (!request.currentUser || !canManageUsers(request.currentUser)) {
          return sendForbidden(reply, "Admin role is required.");
        }

        try {
          const { id } = parseRequest(userParamsSchema, request.params);
          return await deleteUser(services, id, request.currentUser);
        } catch (error) {
          return sendError(reply, error);
        }
      });

      api.post("/users/bulk-delete", async (request, reply) => {
        if (!request.currentUser || !canManageUsers(request.currentUser)) {
          return sendForbidden(reply, "Admin role is required.");
        }

        try {
          const body = parseRequest(bulkDeleteUsersSchema, request.body);
          return await bulkDeleteUsers(services, body, request.currentUser);
        } catch (error) {
          return sendError(reply, error);
        }
      });

      api.post("/users/:id/password", async (request, reply) => {
        try {
          const { id } = parseRequest(userParamsSchema, request.params);
          const body = parseRequest(resetPasswordSchema, request.body);
          if (!canResetUserPassword(request.currentUser!, id)) {
            return sendForbidden(reply);
          }
          return await resetUserPassword(services, id, body);
        } catch (error) {
          return sendError(reply, error);
        }
      });
    },
    { prefix: "/api" }
  );
}
