export function normalizeTargetUrl(input: string): string {
  const raw = input.trim();

  if (!raw) {
    throw new Error("Target must be a valid URL");
  }

  const candidate = toUrlCandidate(raw);

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Target must be a valid URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Target URL must use http or https");
  }

  return url.toString();
}

function toUrlCandidate(raw: string): string {
  if (raw.startsWith("//")) {
    return `https:${raw}`;
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(raw)) {
    return raw;
  }

  const looksLikeHostWithPort = /^[^\s/:?#]+:\d+(?:[/?#]|$)/.test(raw);
  const looksLikeExplicitScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw);

  if (looksLikeExplicitScheme && !looksLikeHostWithPort) {
    return raw;
  }

  return `https://${raw}`;
}
