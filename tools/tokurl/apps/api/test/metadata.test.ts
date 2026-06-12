import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractHtmlTitle, fetchPageTitle } from "../src/services/metadata.js";

let server: ReturnType<typeof createServer> | null = null;

afterEach(async () => {
  vi.restoreAllMocks();

  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server?.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
  server = null;
});

describe("page metadata", () => {
  it("extracts a clean title from HTML", () => {
    expect(extractHtmlTitle("<html><head><title> TokURL &amp; Short Links \n </title></head></html>")).toBe("TokURL & Short Links");
  });

  it("fetches the title from a target URL", async () => {
    server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end("<!doctype html><title>Captured Page Title</title><main>ok</main>");
    });

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    await expect(fetchPageTitle(`http://127.0.0.1:${port}/page`, { timeoutMs: 500, maxBytes: 64_000, allowPrivateHosts: true })).resolves.toBe(
      "Captured Page Title"
    );
  });

  it("returns a title from the configured prefix without waiting for the full response body", async () => {
    server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.write(`<!doctype html><title>Streamed Title</title>${"x".repeat(4096)}`);
      setTimeout(() => response.end("<main>late body</main>"), 800);
    });

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    await expect(fetchPageTitle(`http://127.0.0.1:${port}/slow`, { timeoutMs: 200, maxBytes: 512, allowPrivateHosts: true })).resolves.toBe(
      "Streamed Title"
    );
  });

  it("does not fetch local or private hosts by default", async () => {
    let hitCount = 0;
    server = createServer((_request, response) => {
      hitCount += 1;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end("<title>Private Title</title>");
    });

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    await expect(fetchPageTitle(`http://127.0.0.1:${port}/private`, { timeoutMs: 500, maxBytes: 64_000 })).resolves.toBeNull();
    expect(hitCount).toBe(0);
  });

  it("uses manual redirects so private redirect targets can be blocked", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          location: "http://127.0.0.1/private"
        }
      })
    );

    await expect(fetchPageTitle("http://93.184.216.34/redirect", { timeoutMs: 500, maxBytes: 64_000 })).resolves.toBeNull();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });
});
