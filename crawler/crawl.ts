import { createExtractor } from "./extract";
import { parseRobots, type Robots } from "./robots";
import type { PageResult } from "./types";
import { looksLikePage, normalizeUrl, sameSite } from "./url";

export interface CrawlOptions {
  startUrl: string;
  maxPages?: number;
  maxDepth?: number;
  concurrency?: number;
  timeoutMs?: number;
  maxBytes?: number; // stop reading a page after this, still count it as heavy
  userAgent?: string;
  signal?: AbortSignal;
  onPage: (page: PageResult) => Promise<void> | void;
}

const MAX_REDIRECTS = 5;

/**
 * Breadth-first crawl of one site. Pages are handed to `onPage` as soon as
 * they finish and are not kept, so memory stays flat no matter how big the
 * site is - only the queue and the set of seen URLs grow.
 */
export async function crawl(opts: CrawlOptions) {
  const {
    maxPages = 500,
    maxDepth = 10,
    concurrency = 4,
    timeoutMs = 15_000,
    maxBytes = 5_000_000,
    userAgent = "SitePulseBot/1.0 (+https://github.com/spirtskhalava/sitepulse)",
  } = opts;

  const start = normalizeUrl(opts.startUrl);
  if (!start) throw new Error(`Invalid start URL: ${opts.startUrl}`);

  const robots = await loadRobots(start, userAgent, timeoutMs);
  const seen = new Set<string>([start]);
  const queue: Array<{ url: string; depth: number }> = [{ url: start, depth: 0 }];
  let done = 0;
  let blocked = 0;

  let inFlight = 0;

  async function worker() {
    for (;;) {
      if (opts.signal?.aborted || done >= maxPages) return;
      const item = queue.shift();
      if (!item) {
        // queue is empty but another worker may still add links from the page it's fetching
        if (inFlight === 0) return;
        await new Promise((r) => setTimeout(r, 25));
        continue;
      }
      inFlight++;
      done++;
      try {
        const { page, links } = await fetchPage(item.url, item.depth, { userAgent, timeoutMs, maxBytes, signal: opts.signal });
        if (item.depth < maxDepth) {
          for (const href of links) {
            const next = normalizeUrl(href, page.finalUrl);
            if (!next || seen.has(next) || !sameSite(next, start!) || !looksLikePage(next)) continue;
            seen.add(next);
            if (!robots.allowed(next)) {
              blocked++;
              continue;
            }
            queue.push({ url: next, depth: item.depth + 1 });
          }
        }
        await opts.onPage(page);
      } finally {
        inFlight--;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  return { crawled: done, discovered: seen.size, blockedByRobots: blocked, truncated: queue.length > 0 };
}

async function loadRobots(start: string, userAgent: string, timeoutMs: number): Promise<Robots> {
  try {
    const res = await fetch(new URL("/robots.txt", start), {
      headers: { "user-agent": userAgent },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return parseRobots(res.ok ? await res.text() : "", userAgent);
  } catch {
    return parseRobots("");
  }
}

interface FetchOpts {
  userAgent: string;
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal;
}

export async function fetchPage(url: string, depth: number, o: FetchOpts): Promise<{ page: PageResult; links: string[] }> {
  const started = Date.now();
  const redirects: string[] = [];
  const page: PageResult = {
    url, finalUrl: url, status: 0, redirects, contentType: "", bytes: 0, ms: 0, depth,
    h1: [], imagesWithoutAlt: 0, internalLinks: 0, externalLinks: 0,
  };

  try {
    let current = url;
    let res: Response;
    // follow redirects by hand to record the chain
    for (;;) {
      res = await fetch(current, {
        redirect: "manual",
        headers: { "user-agent": o.userAgent, accept: "text/html,*/*;q=0.8" },
        signal: o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(o.timeoutMs)]) : AbortSignal.timeout(o.timeoutMs),
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        if (redirects.length >= MAX_REDIRECTS) throw new Error("too many redirects");
        redirects.push(current);
        current = new URL(location, current).toString();
        continue;
      }
      break;
    }

    page.finalUrl = normalizeUrl(current) ?? current;
    page.status = res.status;
    page.contentType = (res.headers.get("content-type") ?? "").toLowerCase();

    if (!page.contentType.includes("html") || !res.body) {
      await res.body?.cancel();
      page.ms = Date.now() - started;
      return { page, links: [] };
    }

    const extractor = createExtractor();
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      page.bytes += value.byteLength;
      extractor.write(decoder.decode(value, { stream: true }));
      if (page.bytes > o.maxBytes) {
        await reader.cancel();
        break;
      }
    }
    const ex = extractor.end();
    page.ms = Date.now() - started;

    page.title = ex.title;
    page.description = ex.description;
    page.robots = ex.robots;
    page.h1 = ex.h1;
    page.imagesWithoutAlt = ex.imagesWithoutAlt;
    const base = ex.baseHref ? new URL(ex.baseHref, page.finalUrl).toString() : page.finalUrl;
    if (ex.canonical) page.canonical = normalizeUrl(ex.canonical, base) ?? ex.canonical;

    const links: string[] = [];
    for (const href of ex.links) {
      const abs = normalizeUrl(href, base);
      if (!abs) continue;
      if (sameSite(abs, url)) {
        page.internalLinks++;
        links.push(abs);
      } else page.externalLinks++;
    }
    return { page, links: ex.nofollow ? [] : links };
  } catch (e) {
    page.ms = Date.now() - started;
    page.error = (e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message;
    return { page, links: [] };
  }
}
