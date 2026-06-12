import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { DbClient } from "../db/client.js";
import { clicks, links } from "../db/schema.js";

const streamName = "tokurl:clicks";
const groupName = "tokurl-workers";
type RedisStreamResponse = Array<[string, Array<[string, string[]]>]>;

export interface ClickEventInput {
  linkId: string;
  slug: string;
  referrer?: string | null;
  userAgent?: string | null;
  ip?: string | null;
  hashSalt: string;
}

export interface QueuedClickEvent {
  linkId: string;
  slug: string;
  clickedAt: string;
  referrer: string;
  userAgent: string;
  ipHash: string;
}

export function hashIp(ip: string | null | undefined, salt: string): string | null {
  if (!ip) {
    return null;
  }

  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

export function toQueuedClickEvent(input: ClickEventInput): QueuedClickEvent {
  return {
    linkId: input.linkId,
    slug: input.slug,
    clickedAt: new Date().toISOString(),
    referrer: input.referrer ?? "",
    userAgent: input.userAgent ?? "",
    ipHash: hashIp(input.ip, input.hashSalt) ?? ""
  };
}

export async function enqueueClick(redis: Redis, input: ClickEventInput): Promise<void> {
  const event = toQueuedClickEvent(input);

  await redis.xadd(
    streamName,
    "MAXLEN",
    "~",
    "100000",
    "*",
    "linkId",
    event.linkId,
    "slug",
    event.slug,
    "clickedAt",
    event.clickedAt,
    "referrer",
    event.referrer,
    "userAgent",
    event.userAgent,
    "ipHash",
    event.ipHash
  );
}

export async function ensureClickConsumerGroup(redis: Redis): Promise<void> {
  try {
    await redis.xgroup("CREATE", streamName, groupName, "$", "MKSTREAM");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) {
      throw error;
    }
  }
}

function parseRedisFields(fields: string[]): QueuedClickEvent {
  const event: Record<string, string> = {};

  for (let index = 0; index < fields.length; index += 2) {
    const key = fields[index];
    const value = fields[index + 1] ?? "";

    if (key) {
      event[key] = value;
    }
  }

  return {
    linkId: event.linkId ?? "",
    slug: event.slug ?? "",
    clickedAt: event.clickedAt ?? new Date().toISOString(),
    referrer: event.referrer ?? "",
    userAgent: event.userAgent ?? "",
    ipHash: event.ipHash ?? ""
  };
}

async function persistClick(db: DbClient, event: QueuedClickEvent): Promise<void> {
  const clickedAt = new Date(event.clickedAt);

  await db.transaction(async (transaction) => {
    await transaction.insert(clicks).values({
      linkId: event.linkId,
      slug: event.slug,
      clickedAt,
      referrer: event.referrer || null,
      userAgent: event.userAgent || null,
      ipHash: event.ipHash || null,
      source: "redirect"
    });

    await transaction
      .update(links)
      .set({
        clickCount: sql`${links.clickCount} + 1`,
        lastClickedAt: clickedAt,
        updatedAt: new Date()
      })
      .where(eq(links.id, event.linkId));
  });
}

export async function processClickBatch(
  db: DbClient,
  redis: Redis,
  consumerName: string,
  count = 50,
  blockMs = 5000
): Promise<number> {
  const response = (await redis.xreadgroup(
    "GROUP",
    groupName,
    consumerName,
    "COUNT",
    count,
    "BLOCK",
    blockMs,
    "STREAMS",
    streamName,
    ">"
  )) as RedisStreamResponse | null;

  if (!response) {
    return 0;
  }

  let processed = 0;

  for (const [, entries] of response) {
    for (const [id, fields] of entries) {
      const event = parseRedisFields(fields);
      await persistClick(db, event);
      await redis.xack(streamName, groupName, id);
      processed += 1;
    }
  }

  return processed;
}
