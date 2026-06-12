import { and, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { DbClient } from "../db/client.js";
import { clicks, links, type LinkRecord, type NewLinkRecord } from "../db/schema.js";
import { ServiceError, isUniqueViolation } from "../utils/errors.js";
import { generateSlug, isValidCustomSlug } from "../utils/slug.js";
import { normalizeTargetUrl } from "../utils/url.js";
import { type AuthUser, canAccessOwnedResource, canReadAllResources } from "./auth.js";
import { fetchPageTitle } from "./metadata.js";
import { toPublicLink } from "./presenter.js";

export const createLinkSchema = z.object({
  targetUrl: z.string().min(1),
  slug: z.string().trim().optional(),
  title: z.string().trim().max(160).optional().nullable(),
  description: z.string().trim().max(1000).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  isActive: z.boolean().optional()
});

export const updateLinkSchema = createLinkSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required"
});

export type CreateLinkInput = z.infer<typeof createLinkSchema>;
export type UpdateLinkInput = z.infer<typeof updateLinkSchema>;

interface LinkServices {
  db: DbClient;
  redis: Redis;
  config: AppConfig;
}

interface CachedRedirectLink {
  id: string;
  slug: string;
  targetUrl: string;
  isActive: boolean;
  expiresAt: string | null;
}

type LinkStatusQuery = "all" | "active" | "paused";
const regularUserDailyLinkLimit = 5;

function redirectCacheKey(slug: string): string {
  return `tokurl:redirect:${slug}`;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function parseExpiresAt(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

async function invalidateRedirectCache(redis: Redis, ...slugs: string[]): Promise<void> {
  const keys = slugs.filter(Boolean).map((slug) => redirectCacheKey(slug));

  if (keys.length > 0) {
    await redis.del(...keys).catch(() => undefined);
  }
}

function assertCustomSlug(slug: string): string {
  const normalized = slug.trim();

  if (!isValidCustomSlug(normalized)) {
    throw new ServiceError(400, "Slug must be 2-64 URL-safe characters and cannot be reserved.", "invalid_slug");
  }

  return normalized;
}

function normalizeOptionalSlug(slug: string | null | undefined): string | undefined {
  const normalized = slug?.trim() ?? "";
  return normalized.length > 0 ? normalized : undefined;
}

function assertCanCustomizeSlug(user: AuthUser, slug: string | undefined): void {
  if (slug && !canReadAllResources(user)) {
    throw new ServiceError(403, "Admin role is required to customize short link slugs.", "custom_slug_forbidden");
  }
}

function isExpired(link: Pick<LinkRecord, "expiresAt">): boolean {
  return Boolean(link.expiresAt && link.expiresAt.getTime() <= Date.now());
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNullableIsoString(value: Date | string | null | undefined): string | null {
  return value ? toIsoString(value) : null;
}

function getDeviceExpression() {
  return sql<string>`case
    when ${clicks.userAgent} is null or ${clicks.userAgent} = '' then 'Unknown'
    when ${clicks.userAgent} ilike '%bot%' or ${clicks.userAgent} ilike '%spider%' or ${clicks.userAgent} ilike '%crawler%' then 'Bot'
    when ${clicks.userAgent} ilike '%ipad%' or ${clicks.userAgent} ilike '%tablet%' then 'Tablet'
    when ${clicks.userAgent} ilike '%mobile%' or ${clicks.userAgent} ilike '%iphone%' or ${clicks.userAgent} ilike '%android%' then 'Mobile'
    else 'Desktop'
  end`;
}

function getClickWhereClause(linkId?: string, ownerId?: string) {
  if (linkId) {
    return eq(clicks.linkId, linkId);
  }

  if (ownerId) {
    return sql`${clicks.linkId} in (select id from links where owner_id = ${ownerId})`;
  }

  return sql`true`;
}

function getActiveLinkClause() {
  return and(eq(links.isActive, true), or(isNull(links.expiresAt), sql`${links.expiresAt} > now()`));
}

function getStatusClause(status: LinkStatusQuery | undefined) {
  if (status === "active") {
    return getActiveLinkClause();
  }

  if (status === "paused") {
    return or(eq(links.isActive, false), sql`${links.expiresAt} <= now()`);
  }

  return sql`true`;
}

async function getClickStats(services: LinkServices, linkId?: string, ownerId?: string) {
  const whereClause = getClickWhereClause(linkId, ownerId);
  const deviceExpression = getDeviceExpression();

  const [daily, referrers, devices, recent] = await Promise.all([
    services.db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${clicks.clickedAt}), 'YYYY-MM-DD')`,
        clicks: sql<number>`count(*)::int`
      })
      .from(clicks)
      .where(whereClause)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    services.db
      .select({
        referrer: sql<string>`coalesce(nullif(${clicks.referrer}, ''), 'Direct')`,
        clicks: sql<number>`count(*)::int`
      })
      .from(clicks)
      .where(whereClause)
      .groupBy(sql`1`)
      .orderBy(sql`count(*) desc`)
      .limit(10),
    services.db
      .select({
        device: deviceExpression,
        clicks: sql<number>`count(*)::int`
      })
      .from(clicks)
      .where(whereClause)
      .groupBy(deviceExpression)
      .orderBy(sql`count(*) desc`)
      .limit(10),
    services.db
      .select({
        clickedAt: clicks.clickedAt,
        referrer: clicks.referrer,
        userAgent: clicks.userAgent,
        slug: clicks.slug
      })
      .from(clicks)
      .where(whereClause)
      .orderBy(desc(clicks.clickedAt))
      .limit(20)
  ]);

  return {
    daily,
    referrers,
    devices,
    recent: recent.map((click) => ({
      clickedAt: toIsoString(click.clickedAt),
      referrer: click.referrer,
      userAgent: click.userAgent,
      slug: click.slug
    }))
  };
}

async function insertLinkWithSlug(
  services: LinkServices,
  values: Omit<NewLinkRecord, "slug">,
  preferredSlug?: string
): Promise<LinkRecord> {
  if (preferredSlug) {
    try {
      const [created] = await services.db.insert(links).values({ ...values, slug: preferredSlug }).returning();
      if (!created) {
        throw new ServiceError(500, "Link was not created.", "create_failed");
      }
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ServiceError(409, "Slug is already in use.", "slug_conflict");
      }

      throw error;
    }
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const slug = generateSlug(services.config.slugLength);

    try {
      const [created] = await services.db.insert(links).values({ ...values, slug }).returning();
      if (!created) {
        throw new ServiceError(500, "Link was not created.", "create_failed");
      }
      return created;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }

  throw new ServiceError(503, "Could not allocate a unique slug. Increase TOKURL_SLUG_LENGTH.", "slug_exhausted");
}

async function assertDailyCreateQuota(services: LinkServices, owner: AuthUser): Promise<void> {
  if (canReadAllResources(owner)) {
    return;
  }

  const [summary] = await services.db
    .select({ total: count() })
    .from(links)
    .where(and(eq(links.ownerId, owner.id), sql`${links.createdAt} >= date_trunc('day', now())`))
    .limit(1);

  if ((summary?.total ?? 0) >= regularUserDailyLinkLimit) {
    throw new ServiceError(429, "Daily short link quota exceeded.", "daily_quota_exceeded");
  }
}

export async function createLink(services: LinkServices, input: CreateLinkInput, owner: AuthUser) {
  const requestedSlug = normalizeOptionalSlug(input.slug);
  assertCanCustomizeSlug(owner, requestedSlug);
  await assertDailyCreateQuota(services, owner);

  const now = new Date();
  const targetUrl = normalizeTargetUrl(input.targetUrl);
  const preferredSlug = requestedSlug ? assertCustomSlug(requestedSlug) : undefined;
  const explicitTitle = normalizeNullableText(input.title);
  const capturedTitle =
    explicitTitle ??
    (await fetchPageTitle(targetUrl, {
      timeoutMs: services.config.titleFetchTimeoutMs,
      maxBytes: services.config.titleFetchMaxBytes,
      allowPrivateHosts: services.config.titleFetchAllowPrivateHosts
    }));

  const link = await insertLinkWithSlug(
    services,
    {
      ownerId: owner.id,
      targetUrl,
      title: capturedTitle,
      description: normalizeNullableText(input.description),
      isActive: input.isActive ?? true,
      expiresAt: parseExpiresAt(input.expiresAt),
      createdAt: now,
      updatedAt: now
    },
    preferredSlug
  );

  await invalidateRedirectCache(services.redis, link.slug);
  return toPublicLink(link, services.config.publicShortBaseUrl);
}

export async function listLinks(
  services: LinkServices,
  query: { search?: string; status?: LinkStatusQuery; limit?: number; offset?: number },
  user: AuthUser
) {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);
  const search = query.search?.trim();
  const searchClause = search
    ? or(ilike(links.slug, `%${search}%`), ilike(links.targetUrl, `%${search}%`), ilike(links.title, `%${search}%`))
    : sql`true`;
  const ownerClause = canReadAllResources(user) ? sql`true` : eq(links.ownerId, user.id);
  const summaryWhereClause = and(searchClause, ownerClause);
  const whereClause = and(summaryWhereClause, getStatusClause(query.status));

  const [items, totalRows, summaryRows, topRows] = await Promise.all([
    services.db
      .select()
      .from(links)
      .where(whereClause)
      .orderBy(desc(links.createdAt))
      .limit(limit)
      .offset(offset),
    services.db.select({ total: count() }).from(links).where(whereClause),
    services.db
      .select({
        active: sql<number>`count(*) filter (where ${getActiveLinkClause()})::int`,
        clicks: sql<number>`coalesce(sum(${links.clickCount}), 0)::int`
      })
      .from(links)
      .where(whereClause),
    services.db
      .select({ slug: links.slug })
      .from(links)
      .where(whereClause)
      .orderBy(desc(links.clickCount), desc(links.createdAt))
      .limit(1)
  ]);
  const summary = summaryRows[0];

  return {
    items: items.map((link) => toPublicLink(link, services.config.publicShortBaseUrl)),
    total: totalRows[0]?.total ?? 0,
    summary: {
      total: totalRows[0]?.total ?? 0,
      active: summary?.active ?? 0,
      clicks: summary?.clicks ?? 0,
      topSlug: topRows[0]?.slug ?? null
    },
    limit,
    offset
  };
}

export async function getLinkById(services: LinkServices, id: string, user: AuthUser) {
  const [link] = await services.db.select().from(links).where(eq(links.id, id)).limit(1);

  if (!link || !canAccessOwnedResource(user, link.ownerId)) {
    throw new ServiceError(404, "Link was not found.", "not_found");
  }

  return toPublicLink(link, services.config.publicShortBaseUrl);
}

export async function updateLink(services: LinkServices, id: string, input: UpdateLinkInput, user: AuthUser) {
  const [existing] = await services.db.select().from(links).where(eq(links.id, id)).limit(1);

  if (!existing || !canAccessOwnedResource(user, existing.ownerId)) {
    throw new ServiceError(404, "Link was not found.", "not_found");
  }

  const updates: Partial<NewLinkRecord> = {
    updatedAt: new Date()
  };

  if (input.targetUrl !== undefined) {
    updates.targetUrl = normalizeTargetUrl(input.targetUrl);
  }

  if (input.slug !== undefined) {
    const requestedSlug = normalizeOptionalSlug(input.slug);
    assertCanCustomizeSlug(user, requestedSlug);
    if (requestedSlug) {
      updates.slug = assertCustomSlug(requestedSlug);
    }
  }

  if (input.title !== undefined) {
    updates.title = normalizeNullableText(input.title);
  }

  if (input.description !== undefined) {
    updates.description = normalizeNullableText(input.description);
  }

  if (input.expiresAt !== undefined) {
    updates.expiresAt = parseExpiresAt(input.expiresAt);
  }

  if (input.isActive !== undefined) {
    updates.isActive = input.isActive;
  }

  try {
    const [updated] = await services.db.update(links).set(updates).where(eq(links.id, id)).returning();
    if (!updated) {
      throw new ServiceError(404, "Link was not found.", "not_found");
    }
    await invalidateRedirectCache(services.redis, existing.slug, updated.slug);
    return toPublicLink(updated, services.config.publicShortBaseUrl);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ServiceError(409, "Slug is already in use.", "slug_conflict");
    }

    throw error;
  }
}

export async function deleteLink(services: LinkServices, id: string, user: AuthUser) {
  const [existing] = await services.db.select().from(links).where(eq(links.id, id)).limit(1);

  if (!existing || !canAccessOwnedResource(user, existing.ownerId)) {
    throw new ServiceError(404, "Link was not found.", "not_found");
  }

  const [deleted] = await services.db.delete(links).where(eq(links.id, id)).returning();

  if (!deleted) {
    throw new ServiceError(404, "Link was not found.", "not_found");
  }

  await invalidateRedirectCache(services.redis, deleted.slug);
  return toPublicLink(deleted, services.config.publicShortBaseUrl);
}

export async function getRedirectLink(services: LinkServices, slug: string): Promise<CachedRedirectLink | null> {
  const cached = await services.redis.get(redirectCacheKey(slug)).catch(() => null);

  if (cached) {
    const link = JSON.parse(cached) as CachedRedirectLink;
    const expiresAt = link.expiresAt ? new Date(link.expiresAt) : null;

    if (link.isActive && (!expiresAt || expiresAt.getTime() > Date.now())) {
      return link;
    }

    await invalidateRedirectCache(services.redis, slug);
    return null;
  }

  const [link] = await services.db
    .select()
    .from(links)
    .where(and(eq(links.slug, slug), eq(links.isActive, true), or(isNull(links.expiresAt), sql`${links.expiresAt} > now()`)))
    .limit(1);

  if (!link || isExpired(link)) {
    return null;
  }

  const redirectLink: CachedRedirectLink = {
    id: link.id,
    slug: link.slug,
    targetUrl: link.targetUrl,
    isActive: link.isActive,
    expiresAt: link.expiresAt?.toISOString() ?? null
  };

  await services.redis
    .set(redirectCacheKey(slug), JSON.stringify(redirectLink), "EX", services.config.cacheTtlSeconds)
    .catch(() => undefined);

  return redirectLink;
}

export async function getAllLinkStats(services: LinkServices, user: AuthUser) {
  const ownerId = canReadAllResources(user) ? undefined : user.id;
  const linkWhereClause = ownerId ? eq(links.ownerId, ownerId) : sql`true`;
  const clickWhereClause = getClickWhereClause(undefined, ownerId);
  const [linkSummaryRows, clickSummaryRows, stats] = await Promise.all([
    services.db.select({ totalLinks: sql<number>`count(*)::int` }).from(links).where(linkWhereClause),
    services.db
      .select({
        clickCount: sql<number>`count(*)::int`,
        lastClickedAt: sql<Date | null>`max(${clicks.clickedAt})`
      })
      .from(clicks)
      .where(clickWhereClause),
    getClickStats(services, undefined, ownerId)
  ]);
  const linkSummary = linkSummaryRows[0];
  const clickSummary = clickSummaryRows[0];

  return {
    scope: "all" as const,
    summary: {
      id: null,
      slug: "all",
      title: null,
      totalLinks: linkSummary?.totalLinks ?? 0,
      clickCount: clickSummary?.clickCount ?? 0,
      lastClickedAt: toNullableIsoString(clickSummary?.lastClickedAt)
    },
    ...stats
  };
}

export async function getLinkStats(services: LinkServices, id: string, user: AuthUser) {
  const [link] = await services.db.select().from(links).where(eq(links.id, id)).limit(1);

  if (!link || !canAccessOwnedResource(user, link.ownerId)) {
    throw new ServiceError(404, "Link was not found.", "not_found");
  }

  const publicLink = toPublicLink(link, services.config.publicShortBaseUrl);
  const stats = await getClickStats(services, id);

  return {
    scope: "link" as const,
    link: publicLink,
    summary: {
      id: publicLink.id,
      slug: publicLink.slug,
      title: publicLink.title,
      clickCount: publicLink.clickCount,
      lastClickedAt: publicLink.lastClickedAt
    },
    ...stats
  };
}
