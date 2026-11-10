import { describe, expect, it } from "vitest";
import { createDuplicateTracker, healthScore, pageIssues } from "./checks";
import type { PageResult } from "./types";

const page = (over: Partial<PageResult> = {}): PageResult => ({
  url: "https://example.com/a", finalUrl: "https://example.com/a", status: 200, redirects: [],
  contentType: "text/html; charset=utf-8", bytes: 20_000, ms: 300, depth: 1,
  title: "Handmade clay mugs from Tbilisi",
  description: "Clay mugs and bowls made by hand in a small Tbilisi studio. Free delivery in the city.",
  h1: ["Mugs"], imagesWithoutAlt: 0, internalLinks: 5, externalLinks: 1, ...over,
});

const types = (p: PageResult) => pageIssues(p).map((i) => i.type);

describe("pageIssues", () => {
  it("a clean page has no issues", () => expect(pageIssues(page())).toEqual([]));

  it("broken and server errors", () => {
    expect(types(page({ status: 404 }))).toEqual(["broken"]);
    expect(types(page({ status: 503 }))).toEqual(["server-error"]);
    expect(types(page({ status: 0, error: "timeout" }))).toEqual(["broken"]);
  });

  it("one redirect is fine, a chain is not", () => {
    expect(types(page({ redirects: ["http://example.com/a"] }))).toEqual([]);
    expect(types(page({ redirects: ["http://example.com/a", "https://example.com/a/"] }))).toEqual(["redirect-chain"]);
  });

  it("content checks", () => {
    expect(types(page({ title: undefined, h1: [], description: "" }))).toEqual(["missing-title", "missing-description", "missing-h1"]);
    expect(types(page({ title: "Hi", h1: ["a", "b"] }))).toEqual(["title-length", "multiple-h1"]);
  });

  it("skips content checks for non-html", () => {
    expect(types(page({ contentType: "application/pdf", title: undefined }))).toEqual([]);
  });
});

describe("duplicate tracker", () => {
  it("reports every page sharing a title, ignoring case", () => {
    const d = createDuplicateTracker();
    d.add(page({ url: "https://example.com/a", title: "Shop" }));
    d.add(page({ url: "https://example.com/b", finalUrl: "https://example.com/b", title: "shop" }));
    d.add(page({ url: "https://example.com/c", finalUrl: "https://example.com/c", title: "About" }));
    const titles = d.issues().filter((i) => i.type === "duplicate-title");
    expect(titles.map((i) => i.url)).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("ignores noindex and canonicalised pages", () => {
    const d = createDuplicateTracker();
    d.add(page({ title: "Shop" }));
    d.add(page({ url: "https://example.com/b", finalUrl: "https://example.com/b", title: "Shop", robots: "noindex" }));
    d.add(page({ url: "https://example.com/c", finalUrl: "https://example.com/c", title: "Shop", canonical: "https://example.com/a" }));
    expect(d.issues().filter((i) => i.type === "duplicate-title")).toEqual([]);
  });
});

describe("healthScore", () => {
  it("is 100 without issues and drops with errors", () => {
    expect(healthScore(10, [])).toBe(100);
    expect(healthScore(10, Array(10).fill({ type: "broken", severity: "error", url: "" }))).toBe(50);
  });
});
