export function normalizeTargetUrl(input: string): string {
  const raw = input.trim();

  if (!raw) {
    throw new Error("Target must be a valid URL");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Target must be a valid URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Target URL must use http or https");
  }

  return url.toString();
}
