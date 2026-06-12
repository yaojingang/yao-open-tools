import { describe, expect, it } from "vitest";
import { normalizeTargetUrl } from "../src/utils/url.js";

describe("normalizeTargetUrl", () => {
  it("accepts http and https URLs and normalizes whitespace", () => {
    expect(normalizeTargetUrl(" https://example.com/a?b=1 ")).toBe("https://example.com/a?b=1");
    expect(normalizeTargetUrl("http://example.com")).toBe("http://example.com/");
  });

  it("adds https for URLs without an explicit protocol", () => {
    expect(normalizeTargetUrl("www.baidu.com")).toBe("https://www.baidu.com/");
    expect(normalizeTargetUrl("example.com/path?utm=tokurl")).toBe("https://example.com/path?utm=tokurl");
    expect(normalizeTargetUrl("//example.com/share")).toBe("https://example.com/share");
    expect(normalizeTargetUrl("localhost:3000/demo")).toBe("https://localhost:3000/demo");
  });

  it("rejects unsupported protocols and malformed URLs", () => {
    expect(() => normalizeTargetUrl("javascript:alert(1)")).toThrow(/http or https/i);
    expect(() => normalizeTargetUrl("ftp://example.com")).toThrow(/http or https/i);
    expect(() => normalizeTargetUrl("not a url")).toThrow(/valid url/i);
  });
});
