import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { claimNext } from "./repo";
import { startTestDb } from "./testdb";
import { runCrawl } from "./worker";

// api + worker end to end: queue a crawl over http, let the worker crawl a fake site, read results back
let t: Awaited<ReturnType<typeof startTestDb>>;
let api: Server;
let site: Server;
let apiUrl: string;
let siteUrl: string;

const listen = async (s: Server) => {
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
};

beforeAll(async () => {
  t = await startTestDb();
  api = createServer(createApp(t.pool));
  apiUrl = await listen(api);

  const pages: Record<string, string> = {
    "/": '<title>Home page of the test shop</title><h1>Home</h1><a href="/a">a</a><a href="/gone">x</a>',
    "/a": "<title>Short</title><p>no h1</p>",
  };
  site = createServer((req, res) => {
    const html = pages[req.url ?? ""];
    res.writeHead(html ? 200 : 404, { "content-type": "text/html" });
    res.end(html ?? "nope");
  });
  siteUrl = await listen(site);
});

afterAll(async () => {
  api?.close();
  site?.close();
  await t?.stop();
});

const call = (path: string, init?: RequestInit) =>
  fetch(apiUrl + path, { ...init, headers: { "content-type": "application/json" } });

describe("api", () => {
  it("rejects garbage urls", async () => {
    const res = await call("/api/crawls", { method: "POST", body: JSON.stringify({ url: "not a site" }) });
    expect(res.status).toBe(400);
  });

  it("queue -> crawl -> results -> csv", async () => {
    const created = await (await call("/api/crawls", { method: "POST", body: JSON.stringify({ url: siteUrl, maxPages: 10 }) })).json();
    expect(created.status).toBe("queued");

    const crawl = await claimNext(t.pool, "test-worker");
    await runCrawl(t.pool, crawl!);

    const done = await (await call(`/api/crawls/${created.id}`)).json();
    expect(done.status).toBe("done");
    expect(done.crawled).toBe(3);
    expect(done.summary.counts).toMatchObject({ broken: 1, "missing-h1": 1, "title-length": 1 });

    const broken = await (await call(`/api/crawls/${created.id}/issues?type=broken`)).json();
    expect(broken.map((i: { url: string }) => new URL(i.url).pathname)).toEqual(["/gone"]);

    const csv = await (await call(`/api/crawls/${created.id}/export.csv`)).text();
    expect(csv.trim().split("\n")).toHaveLength(4); // header + 3 pages
  });

  it("404 for unknown crawls", async () => {
    expect((await call("/api/crawls/999999")).status).toBe(404);
    expect((await call("/api/crawls/abc")).status).toBe(404);
  });
});
