import { customAlphabet } from "nanoid";

const base62Alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const makeSlug = customAlphabet(base62Alphabet);

const reservedSlugs = new Set([
  "api",
  "admin",
  "assets",
  "favicon.ico",
  "health",
  "metrics",
  "robots.txt",
  "static"
]);

export function generateSlug(length: number): string {
  return makeSlug(length);
}

export function isValidCustomSlug(slug: string): boolean {
  const normalized = slug.trim();

  return (
    /^[0-9A-Za-z_-]{2,64}$/.test(normalized) &&
    !reservedSlugs.has(normalized.toLowerCase()) &&
    !normalized.startsWith("_") &&
    !normalized.endsWith("_")
  );
}
