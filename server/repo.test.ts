import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PageResult } from "../crawler/types";
import {
  allPages, claimNext, createCrawl, finishCrawl, getCrawl, heartbeat, issuesOfType, listPages,
  requestCancel, requeueStale, saveIssues, savePages,
} from "./repo";
import { startTestDb } from "./testdb";

let t: Awaited<ReturnType<typeof startTestDb>>;

beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate crawls restart identity cascade");
});

const page = (url: string, over: Partial<PageResult & { issueCount: number }> = {}): PageResult & { issueCount: number } => ({
  url, finalUrl: url, status: 200, redirects: [], contentType: "text/html", bytes: 1000, ms: 120, depth: 1,
  title: "Title", h1: ["Heading"], imagesWithoutAlt: 0, internalLinks: 3, externalLinks: 0, issueCount: 0, ...over,
});

describe("queue", () => {
  it("each queued crawl goes to exactly one worker", async () => {
    for (let i = 0; i < 3; i++) await createCrawl(t.pool, `https://site${i}.test/`, 50);

    // 6 workers race for 3 crawls
    const claimed = await Promise.all(Array.from({ length: 6 }, (_, i) => claimNext(t.pool, `w${i}`)));
    const ids = claimed.filter(Boolean).map((c) => c!.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("oldest first", async () => {
    const a = await createCrawl(t.pool, "https://a.test/", 10);
    await createCrawl(t.pool, "https://b.test/", 10);
    expect((await claimNext(t.pool, "w"))!.id).toBe(a.id);
  });

  it("cancel: queued stops at once, running gets a flag for the worker", async () => {
    const q = await createCrawl(t.pool, "https://q.test/", 10);
    expect(await requestCancel(t.pool, q.id)).toBe("cancelled");

    const r = await createCrawl(t.pool, "https://r.test/", 10);
    await claimNext(t.pool, "w");
    expect(await requestCancel(t.pool, r.id)).toBe("running");
    expect(await heartbeat(t.pool, r.id, 5)).toEqual({ cancel: true });
  });

  it("requeues crawls whose worker stopped sending heartbeats, without leftovers", async () => {
    const c = await createCrawl(t.pool, "https://dead.test/", 10);
    await claimNext(t.pool, "w");
    await savePages(t.pool, c.id, [page("https://dead.test/")]);
    await t.pool.query("update crawls set heartbeat_at = now() - interval '10 minutes' where id = $1", [c.id]);

    expect(await requeueStale(t.pool, 5)).toEqual([c.id]);
    expect((await getCrawl(t.pool, c.id))!.status).toBe("queued");
    expect(await listPages(t.pool, c.id)).toEqual([]);
  });
});

describe("results", () => {
  it("saves a batch of pages with array columns and skips repeats", async () => {
    const c = await createCrawl(t.pool, "https://shop.test/", 10);
    await savePages(t.pool, c.id, [
      page("https://shop.test/", { h1: ["A", "B"], redirects: ["http://shop.test/"], issueCount: 2 }),
      page("https://shop.test/mugs", { title: undefined, status: 404 }),
    ]);
    await savePages(t.pool, c.id, [page("https://shop.test/")]); // same url again

    const rows = await listPages(t.pool, c.id);
    expect(rows.map((r) => r.url)).toEqual(["https://shop.test/", "https://shop.test/mugs"]);
    const { rows: [home] } = await t.pool.query("select h1, redirects from pages where url = 'https://shop.test/'");
    expect(home).toEqual({ h1: ["A", "B"], redirects: ["http://shop.test/"] });
  });

  it("issues by type and the export iterator", async () => {
    const c = await createCrawl(t.pool, "https://shop.test/", 10);
    await saveIssues(t.pool, c.id, [
      { type: "broken", severity: "error", url: "https://shop.test/x", detail: "404" },
      { type: "missing-h1", severity: "warning", url: "https://shop.test/y" },
    ]);
    expect(await issuesOfType(t.pool, c.id, "broken")).toEqual([
      { type: "broken", severity: "error", url: "https://shop.test/x", detail: "404" },
    ]);

    await savePages(t.pool, c.id, Array.from({ length: 25 }, (_, i) => page(`https://shop.test/p${i}`)));
    let total = 0;
    for await (const chunk of allPages(t.pool, c.id, 10)) total += chunk.length;
    expect(total).toBe(25);
  });

  it("stores the summary as json", async () => {
    const c = await createCrawl(t.pool, "https://shop.test/", 10);
    const summary = { crawled: 3, discovered: 4, blockedByRobots: 0, truncated: false, score: 91, counts: { broken: 1 }, bySeverity: { error: 1, warning: 0, notice: 0 } };
    await finishCrawl(t.pool, c.id, "done", { summary, crawled: 3 });
    const saved = await getCrawl(t.pool, c.id);
    expect(saved!.status).toBe("done");
    expect(saved!.summary).toEqual(summary);
  });
});
