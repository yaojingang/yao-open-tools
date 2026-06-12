import type { FastifyReply } from "fastify";
import { ZodError, type ZodType } from "zod";
import { ServiceError } from "../utils/errors.js";

export function parseRequest<T>(schema: ZodType<T>, input: unknown): T {
  return schema.parse(input);
}

export function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof ServiceError) {
    return reply.status(error.statusCode).send({
      error: error.code,
      message: error.message
    });
  }

  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: "invalid_request",
      message: "Request body or query is invalid.",
      details: error.flatten()
    });
  }

  throw error;
}
