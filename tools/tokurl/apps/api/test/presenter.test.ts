import { describe, expect, it } from "vitest";
import { toPublicLink } from "../src/services/presenter.js";

describe("toPublicLink", () => {
  it("creates a stable short URL without double slashes", () => {
    const link = toPublicLink(
      {
        id: "link_1",
        slug: "aB9x2",
        targetUrl: "https://example.com",
        title: "Example",
        description: null,
        isActive: true,
        expiresAt: null,
        createdAt: new Date("2026-06-11T00:00:00Z"),
        updatedAt: new Date("2026-06-11T00:00:00Z"),
        clickCount: 3,
        lastClickedAt: null
      },
      "https://tok.url/"
    );

    expect(link.shortUrl).toBe("https://tok.url/aB9x2");
    expect(link.clickCount).toBe(3);
  });
});
