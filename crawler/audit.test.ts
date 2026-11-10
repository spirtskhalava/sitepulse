import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAudit } from "./audit";
import type { Issue, PageResult } from "./types";

// A small fake site with the usual problems.
const html = (title: string, body: string, head = "") =>
  `<html><head><title>${title}</title>${head}</head><body>${body}</body></html>`;
const desc = '<meta name="description" content="A perfectly normal description that is long enough for search engines to show it.">';

let server: Server;
let base: string;
let concurrent = 0;
let maxConcurrent = 0;

const routes: Record<string, (res: import("node:http").ServerResponse) => void> = {
  "/robots.txt": (r) => r.end("User-agent: *\nDisallow: /admin"),
  "/": (r) => r.end(html("Clay Studio - handmade ceramics", '<h1>Home</h1><a href="/mugs">m</a><a href="/bowls/">b</a><a href="/old">o</a><a href="/missing">x</a><a href="/admin">a</a><a href="/menu.pdf">pdf</a><a href="https://instagram.com/x">ig</a><a href="/mugs?utm_source=nav">m2</a>', desc)),
  "/mugs": (r) => r.end(html("Shop - Clay Studio", "<h1>Mugs</h1><a href='/mugs/deep'>d</a>", desc)),
  "/bowls": (r) => r.end(html("Shop - Clay Studio", "<p>no heading</p>", desc)),
  "/old": (r) => { r.writeHead(301, { location: "/older" }); r.end(); },
  "/older": (r) => { r.writeHead(302, { location: "/mugs" }); r.end(); },
  "/mugs/deep": (r) => r.end(html("Deep page that is far from the home page", "<h1>Deep</h1>", desc)),
  "/admin": (r) => r.end(html("Admin", "")),
};

beforeAll(async () => {
  server = createServer((req, res) => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    res.on("finish", () => concurrent--);
    const path = (req.url ?? "/").split("?")[0];
    const route = routes[path];
    setTimeout(() => {
      if (!route) { res.writeHead(404, { "content-type": "text/html" }); res.end("not found"); return; }
      if (path !== "/robots.txt") res.setHeader("content-type", "text/html; charset=utf-8");
      route(res);
    }, 20);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

describe("runAudit against a fake site", () => {
  it("crawls, follows rules and finds the problems", async () => {
    const pages: PageResult[] = [];
    const issues: Issue[] = [];
    const summary = await runAudit({ startUrl: base, concurrency: 3 }, {
      page(p, i) { pages.push(p); issues.push(...i); },
    });

    const paths = pages.map((p) => new URL(p.url).pathname).sort();
    // utm variant deduped, pdf skipped, /admin blocked by robots
    expect(paths).toEqual(["/", "/bowls", "/missing", "/mugs", "/mugs/deep", "/old"]);
    expect(summary.blockedByRobots).toBe(1);

    const of = (type: string) => issues.filter((i) => i.type === type).map((i) => new URL(i.url).pathname);
    expect(of("broken")).toEqual(["/missing"]);
    expect(of("redirect-chain")).toEqual(["/old"]);
    expect(of("missing-h1")).toEqual(["/bowls"]);
    const dupTitles = summary.duplicates.filter((d) => d.type === "duplicate-title");
    expect(dupTitles.map((d) => new URL(d.url).pathname).sort()).toEqual(["/bowls", "/mugs"]);

    const home = pages.find((p) => new URL(p.url).pathname === "/")!;
    expect(home.externalLinks).toBe(1);
    expect(summary.score).toBeLessThan(100);
    expect(maxConcurrent).toBeGreaterThan(1);
  });

  it("respects maxPages and maxDepth", async () => {
    const pages: PageResult[] = [];
    const s = await runAudit({ startUrl: base, maxPages: 2 }, { page: (p) => { pages.push(p); } });
    expect(pages).toHaveLength(2);
    expect(s.truncated).toBe(true);

    const shallow: PageResult[] = [];
    await runAudit({ startUrl: base, maxDepth: 0 }, { page: (p) => { shallow.push(p); } });
    expect(shallow.map((p) => new URL(p.url).pathname)).toEqual(["/"]);
  });
});
