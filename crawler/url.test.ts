import { describe, expect, it } from "vitest";
import { looksLikePage, normalizeUrl, sameSite } from "./url";

describe("normalizeUrl", () => {
  it("collapses variants of the same page", () => {
    const variants = [
      "https://Example.com/about/",
      "https://example.com/about#team",
      "https://example.com:443/about?utm_source=fb",
      "/about",
    ];
    expect(new Set(variants.map((v) => normalizeUrl(v, "https://example.com/")))).toEqual(new Set(["https://example.com/about"]));
  });

  it("sorts query params and keeps real ones", () => {
    expect(normalizeUrl("https://example.com/shop?page=2&cat=mugs&gclid=x")).toBe("https://example.com/shop?cat=mugs&page=2");
  });

  it("rejects non-http links", () => {
    expect(normalizeUrl("mailto:hi@example.com")).toBeNull();
    expect(normalizeUrl("javascript:void(0)")).toBeNull();
    expect(normalizeUrl("tel:+995555")).toBeNull();
  });

  it("keeps the root slash", () => {
    expect(normalizeUrl("https://example.com")).toBe("https://example.com/");
  });
});

describe("sameSite / looksLikePage", () => {
  it("treats www as the same site", () => {
    expect(sameSite("https://www.example.com/a", "https://example.com/")).toBe(true);
    expect(sameSite("https://blog.example.com/", "https://example.com/")).toBe(false);
  });

  it("skips files", () => {
    expect(looksLikePage("https://example.com/menu.pdf")).toBe(false);
    expect(looksLikePage("https://example.com/menu")).toBe(true);
  });
});
