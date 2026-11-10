/**
 * crawl worker, run as many as you want:  npm run worker
 * picks queued crawls from postgres, wakes up on NOTIFY or every 10s
 */
import { hostname } from "node:os";
import type pg from "pg";
import { runAudit } from "../crawler/audit";
import type { Issue, PageResult } from "../crawler/types";
import { createPool, type Db } from "./db";
import { claimNext, finishCrawl, heartbeat, requeueStale, saveIssues, savePages, type Crawl } from "./repo";

const WORKER_ID = `${hostname()}-${process.pid}`;
const FLUSH_EVERY = 50; // pages per insert
const HEARTBEAT_MS = 5000;

export async function runCrawl(db: Db, crawl: Crawl) {
  const abort = new AbortController();
  let pages: Array<PageResult & { issueCount: number }> = [];
  let issues: Issue[] = [];
  let crawled = 0;

  const flush = async () => {
    const [p, i] = [pages, issues];
    pages = [];
    issues = [];
    await savePages(db, crawl.id, p);
    await saveIssues(db, crawl.id, i);
  };

  const beat = setInterval(async () => {
    try {
      const { cancel } = await heartbeat(db, crawl.id, crawled);
      if (cancel) abort.abort();
    } catch (e) {
      console.warn("heartbeat failed", (e as Error).message);
    }
  }, HEARTBEAT_MS);

  try {
    const summary = await runAudit(
      { startUrl: crawl.url, maxPages: crawl.max_pages, signal: abort.signal },
      {
        async page(p, found) {
          crawled++;
          pages.push({ ...p, issueCount: found.length });
          issues.push(...found);
          if (pages.length >= FLUSH_EVERY) await flush();
        },
      },
    );
    issues.push(...summary.duplicates);
    await flush();

    const { duplicates: _, ...rest } = summary;
    await finishCrawl(db, crawl.id, abort.signal.aborted ? "cancelled" : "done", { summary: rest, crawled: summary.crawled });
    console.log(`#${crawl.id} ${crawl.url}: ${summary.crawled} pages, score ${summary.score}`);
  } catch (e) {
    await finishCrawl(db, crawl.id, "failed", { error: (e as Error).message, crawled });
    console.error(`#${crawl.id} failed`, e);
  } finally {
    clearInterval(beat);
  }
}

async function main() {
  const db = createPool();
  const parallel = Number(process.env.WORKER_PARALLEL ?? 2);
  let running = 0;
  let wake: (() => void) | null = null;

  // separate connection just for LISTEN
  const listener: pg.PoolClient = await db.connect();
  await listener.query("listen crawl_queued");
  listener.on("notification", () => wake?.());

  setInterval(() => requeueStale(db).then((ids) => ids.length && console.log("requeued", ids)), 60_000);
  console.log(`worker ${WORKER_ID}, up to ${parallel} crawls at once`);

  for (;;) {
    if (running < parallel) {
      const crawl = await claimNext(db, WORKER_ID);
      if (crawl) {
        running++;
        runCrawl(db, crawl).finally(() => {
          running--;
          wake?.();
        });
        continue;
      }
    }
    // sleep until a NOTIFY, a finished crawl, or 10s (in case a notify got lost)
    await new Promise<void>((resolve) => {
      wake = resolve;
      setTimeout(resolve, 10_000);
    });
    wake = null;
  }
}

if (process.argv[1]?.endsWith("worker.ts")) main();
