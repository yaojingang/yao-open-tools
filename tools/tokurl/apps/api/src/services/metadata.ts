import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface FetchPageTitleOptions {
  timeoutMs?: number;
  maxBytes?: number;
  allowPrivateHosts?: boolean;
}

const defaultTimeoutMs = 1200;
const defaultMaxBytes = 128 * 1024;
const dnsTimeoutMs = 800;
const maxRedirects = 3;

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const first = octets[0]!;
  const second = octets[1]!;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first === 169 && second === 254 ||
    first === 172 && second >= 16 && second <= 31 ||
    first === 192 && second === 168 ||
    first === 100 && second >= 64 && second <= 127 ||
    first === 198 && (second === 18 || second === 19) ||
    first >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpAddress(normalized.slice(7));
  }

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

function isPrivateIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return isPrivateIpv4(address);
  }
  if (version === 6) {
    return isPrivateIpv6(address);
  }
  return true;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local");
}

async function isPublicFetchTarget(targetUrl: string): Promise<boolean> {
  const url = new URL(targetUrl);
  const hostname = url.hostname;

  if (isLocalHostname(hostname)) {
    return false;
  }

  if (isIP(hostname)) {
    return !isPrivateIpAddress(hostname);
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const lookupResult = await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), dnsTimeoutMs);
    })
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });

  return Array.isArray(lookupResult) && lookupResult.length > 0 && lookupResult.every((record) => !isPrivateIpAddress(record.address));
}

function decodeHtmlEntity(entity: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };

  if (entity.startsWith("#x") || entity.startsWith("#X")) {
    const codePoint = Number.parseInt(entity.slice(2), 16);
    return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : `&${entity};`;
  }

  if (entity.startsWith("#")) {
    const codePoint = Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : `&${entity};`;
  }

  return namedEntities[entity] ?? `&${entity};`;
}

function normalizeTitle(value: string): string | null {
  const normalized = value
    .replace(/&([a-zA-Z][a-zA-Z0-9]+|#[0-9]+|#x[0-9a-fA-F]+);/g, (_match, entity: string) => decodeHtmlEntity(entity))
    .replace(/\s+/g, " ")
    .trim();

  return normalized ? normalized.slice(0, 160) : null;
}

export function extractHtmlTitle(html: string): string | null {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch?.[1] ? normalizeTitle(titleMatch[1]) : null;
}

async function readResponsePrefix(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return (await response.text()).slice(0, maxBytes);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let bytesRead = 0;

  try {
    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) {
        break;
      }

      const remaining = maxBytes - bytesRead;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      bytesRead += chunk.byteLength;
      html += decoder.decode(chunk, { stream: bytesRead < maxBytes });

      if (/<\/title>/i.test(html)) {
        break;
      }
    }

    html += decoder.decode();
    return html;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function fetchPageTitle(targetUrl: string, options: FetchPageTitleOptions = {}): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? defaultTimeoutMs);

  try {
    let currentUrl = targetUrl;

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      if (!options.allowPrivateHosts && !(await isPublicFetchTarget(currentUrl))) {
        return null;
      }

      const response = await fetch(currentUrl, {
        headers: {
          accept: "text/html,application/xhtml+xml"
        },
        redirect: "manual",
        signal: controller.signal
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) {
          return null;
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (!response.ok) {
        return null;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        return null;
      }

      const html = await readResponsePrefix(response, options.maxBytes ?? defaultMaxBytes);
      return extractHtmlTitle(html);
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
