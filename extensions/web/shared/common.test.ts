import { describe, expect, test } from "bun:test";
import {
  clampTimeout,
  ensureHttpUrl,
  isImageMime,
  mimeFromType,
  WEBTOOLS_MAX_TIMEOUT,
} from "./common.js";

describe("web common helpers", () => {
  test("clampTimeout returns fallback for absent and invalid values", () => {
    expect(clampTimeout(undefined, 25)).toBe(25);
    expect(clampTimeout(Number.NaN, 25)).toBe(25);
    expect(clampTimeout(Number.POSITIVE_INFINITY, 25)).toBe(25);
    expect(clampTimeout(0, 25)).toBe(25);
    expect(clampTimeout(-1, 25)).toBe(25);
  });

  test("clampTimeout floors decimals and caps large values", () => {
    expect(clampTimeout(12.9, 25)).toBe(12);
    expect(clampTimeout(WEBTOOLS_MAX_TIMEOUT + 100, 25)).toBe(WEBTOOLS_MAX_TIMEOUT);
  });

  test("ensureHttpUrl accepts only http and https URLs", () => {
    expect(ensureHttpUrl("http://example.com/path").protocol).toBe("http:");
    expect(ensureHttpUrl("https://example.com/path").protocol).toBe("https:");
    expect(() => ensureHttpUrl("file:///tmp/example")).toThrow("URL must use http:// or https://");
    expect(() => ensureHttpUrl("ftp://example.com/file")).toThrow(
      "URL must use http:// or https://",
    );
    expect(() => ensureHttpUrl("not a url")).toThrow();
  });

  test("mimeFromType normalizes content-type headers", () => {
    expect(mimeFromType("Text/HTML; charset=utf-8")).toBe("text/html");
    expect(mimeFromType(" image/PNG ")).toBe("image/png");
    expect(mimeFromType(null)).toBe("");
    expect(mimeFromType("; charset=utf-8")).toBe("");
  });

  test("isImageMime accepts image MIME types except SVG", () => {
    expect(isImageMime("image/png")).toBe(true);
    expect(isImageMime("image/jpeg")).toBe(true);
    expect(isImageMime("image/svg+xml")).toBe(false);
    expect(isImageMime("text/html")).toBe(false);
  });
});
