import { describe, expect, it } from "vitest";
import { generateSlug, isValidCustomSlug } from "../src/utils/slug.js";

describe("slug utilities", () => {
  it("generates compact base62 slugs with configurable length", () => {
    const slug = generateSlug(5);

    expect(slug).toMatch(/^[0-9A-Za-z]{5}$/);
  });

  it("accepts short custom aliases without unsafe path characters", () => {
    expect(isValidCustomSlug("go")).toBe(true);
    expect(isValidCustomSlug("Launch_24")).toBe(true);
    expect(isValidCustomSlug("bad/path")).toBe(false);
    expect(isValidCustomSlug("api")).toBe(false);
    expect(isValidCustomSlug("")).toBe(false);
  });
});
