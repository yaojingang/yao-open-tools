import type { LinkRecord } from "../db/schema.js";

export interface PublicLink {
  id: string;
  slug: string;
  shortUrl: string;
  targetUrl: string;
  title: string | null;
  description: string | null;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  clickCount: number;
  lastClickedAt: string | null;
}

export function toPublicLink(link: LinkRecord, publicShortBaseUrl: string): PublicLink {
  const baseUrl = publicShortBaseUrl.replace(/\/+$/, "");

  return {
    id: link.id,
    slug: link.slug,
    shortUrl: `${baseUrl}/${link.slug}`,
    targetUrl: link.targetUrl,
    title: link.title,
    description: link.description,
    isActive: link.isActive,
    expiresAt: link.expiresAt?.toISOString() ?? null,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
    clickCount: link.clickCount,
    lastClickedAt: link.lastClickedAt?.toISOString() ?? null
  };
}
