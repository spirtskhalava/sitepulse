import { describe, expect, it } from "vitest";
import { parseRobots } from "./robots";

const txt = `
# shop robots
User-agent: *
Disallow: /cart
Disallow: /*?sort=
Allow: /cart/help
Disallow: /*.json$

User-agent: SitePulseBot
User-agent: OtherBot
Disallow: /private

Sitemap: https://example.com/sitemap.xml
`;

describe("parseRobots", () => {
  const generic = parseRobots(txt, "SomeBot");

  it("applies disallow and longest-match allow", () => {
    expect(generic.allowed("https://example.com/cart")).toBe(false);
    expect(generic.allowed("https://example.com/cart/help")).toBe(true);
    expect(generic.allowed("https://example.com/products")).toBe(true);
  });

  it("supports * and $ wildcards", () => {
    expect(generic.allowed("https://example.com/mugs?sort=price")).toBe(false);
    expect(generic.allowed("https://example.com/feed.json")).toBe(false);
    expect(generic.allowed("https://example.com/feed.json?x=1")).toBe(true);
  });

  it("uses the group for our agent instead of *", () => {
    const ours = parseRobots(txt, "SitePulseBot/1.0");
    expect(ours.allowed("https://example.com/cart")).toBe(true);
    expect(ours.allowed("https://example.com/private/x")).toBe(false);
  });

  it("collects sitemaps and allows everything when empty", () => {
    expect(generic.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
    expect(parseRobots("").allowed("https://example.com/anything")).toBe(true);
  });
});
