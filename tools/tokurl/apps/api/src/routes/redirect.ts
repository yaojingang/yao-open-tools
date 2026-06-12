import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type { AppConfig } from "../config.js";
import type { DbClient } from "../db/client.js";
import { enqueueClick } from "../services/analytics.js";
import { getRedirectLink } from "../services/links.js";
import { isValidCustomSlug } from "../utils/slug.js";

interface RouteContext {
  config: AppConfig;
  db: DbClient;
  redis: Redis;
}

export async function registerRedirectRoute(app: FastifyInstance, context: RouteContext) {
  async function redirectHandler(request: FastifyRequest, reply: FastifyReply) {
    const { slug } = request.params as { slug: string };

    if (!isValidCustomSlug(slug)) {
      return reply.status(404).send({
        error: "not_found",
        message: "Short link was not found."
      });
    }

    const link = await getRedirectLink(context, slug);

    if (!link) {
      return reply.status(404).send({
        error: "not_found",
        message: "Short link was not found."
      });
    }

    if (context.config.analyticsEnabled) {
      void enqueueClick(context.redis, {
        linkId: link.id,
        slug: link.slug,
        referrer: request.headers.referer ?? null,
        userAgent: request.headers["user-agent"] ?? null,
        ip: request.ip,
        hashSalt: context.config.hashSalt
      }).catch((error) => request.log.warn({ error, slug }, "Failed to enqueue click analytics"));
    }

    return reply
      .status(context.config.redirectStatus)
      .header("Location", link.targetUrl)
      .header("Cache-Control", "no-store")
      .send();
  }

  app.route({
    method: ["GET", "HEAD"],
    url: "/:slug",
    handler: redirectHandler
  });
}
