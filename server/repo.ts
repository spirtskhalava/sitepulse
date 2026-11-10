import type { AuditSummary } from "../crawler/audit";
import type { Issue, PageResult } from "../crawler/types";
import type { Db } from "./db";

export type CrawlStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface Crawl {
  id: string;
  url: string;
  max_pages: number;
  status: CrawlStatus;
  crawled: number;
  cancel_requested: boolean;
  error: string | null;
  summary: Omit<AuditSummary, "duplicates"> | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

const CRAWL_COLS = "id, url, max_pages, status, crawled, cancel_requested, error, summary, created_at, started_at, finished_at";

export async function createCrawl(db: Db, url: string, maxPages: number): Promise<Crawl> {
  const { rows } = await db.query<Crawl>(
    `insert into crawls (url, max_pages) values ($1, $2) returning ${CRAWL_COLS}`,
    [url, maxPages],
  );
  // wakes up an idle worker right away instead of waiting for its poll
  await db.query("select pg_notify('crawl_queued', $1)", [rows[0].id]);
  return rows[0];
}

export async function listCrawls(db: Db, limit = 30) {
  return (await db.query<Crawl>(`select ${CRAWL_COLS} from crawls order by created_at desc limit $1`, [limit])).rows;
}

export async function getCrawl(db: Db, id: string) {
  return (await db.query<Crawl>(`select ${CRAWL_COLS} from crawls where id = $1`, [id])).rows[0] ?? null;
}

export async function requestCancel(db: Db, id: string) {
  // a queued crawl can just be cancelled, a running one is stopped by its worker
  const { rows } = await db.query<{ status: CrawlStatus }>(
    `update crawls
        set cancel_requested = true,
            status = case when status = 'queued' then 'cancelled' else status end,
            finished_at = case when status = 'queued' then now() else finished_at end
      where id = $1 and status in ('queued', 'running')
      returning status`,
    [id],
  );
  return rows[0]?.status ?? null;
}

export async function issuesOfType(db: Db, crawlId: string, type: string, limit = 300) {
  return (
    await db.query<Issue>(
      "select type, severity, url, detail from issues where crawl_id = $1 and type = $2 order by url limit $3",
      [crawlId, type, limit],
    )
  ).rows;
}

export async function listPages(db: Db, crawlId: string, limit = 500, offset = 0) {
  return (
    await db.query(
      `select url, final_url, status, depth, ms, bytes, title, issue_count
         from pages where crawl_id = $1
        order by issue_count desc, url
        limit $2 offset $3`,
      [crawlId, limit, offset],
    )
  ).rows;
}

/** For the CSV export: keyset pagination so big crawls are read in chunks. */
export async function* allPages(db: Db, crawlId: string, chunk = 1000) {
  let lastId = 0;
  for (;;) {
    const { rows } = await db.query(
      `select id, url, final_url, status, depth, ms, bytes, title, description, canonical, robots, h1, issue_count
         from pages where crawl_id = $1 and id > $2 order by id limit $3`,
      [crawlId, lastId, chunk],
    );
    if (!rows.length) return;
    yield rows;
    lastId = Number(rows[rows.length - 1].id);
  }
}

// ---------- worker side ----------

/**
 * Takes the oldest queued crawl. SKIP LOCKED means two workers polling at
 * the same moment get different rows (or nothing) instead of waiting on
 * each other or both grabbing the same one.
 */
export async function claimNext(db: Db, workerId: string): Promise<Crawl | null> {
  const { rows } = await db.query<Crawl>(
    `update crawls
        set status = 'running', worker_id = $1, started_at = now(), heartbeat_at = now(), crawled = 0
      where id = (
        select id from crawls
         where status = 'queued'
         order by created_at
         for update skip locked
         limit 1
      )
      returning ${CRAWL_COLS}`,
    [workerId],
  );
  return rows[0] ?? null;
}

/** Progress + "am I still alive" + "should I stop", in one round trip. */
export async function heartbeat(db: Db, id: string, crawled: number): Promise<{ cancel: boolean }> {
  const { rows } = await db.query<{ cancel_requested: boolean }>(
    "update crawls set crawled = $2, heartbeat_at = now() where id = $1 returning cancel_requested",
    [id, crawled],
  );
  return { cancel: rows[0]?.cancel_requested ?? true };
}

/** Many pages in one insert: the batch goes in as a json array and postgres unpacks it. */
export async function savePages(db: Db, crawlId: string, pages: Array<PageResult & { issueCount: number }>) {
  if (!pages.length) return;
  const rows = pages.map((p) => ({
    url: p.url, final_url: p.finalUrl, status: p.status, redirects: p.redirects, content_type: p.contentType,
    bytes: p.bytes, ms: p.ms, depth: p.depth, title: p.title ?? null, description: p.description ?? null,
    canonical: p.canonical ?? null, robots: p.robots ?? null, h1: p.h1, images_without_alt: p.imagesWithoutAlt,
    internal_links: p.internalLinks, external_links: p.externalLinks, error: p.error ?? null, issue_count: p.issueCount,
  }));
  await db.query(
    `insert into pages (crawl_id, url, final_url, status, redirects, content_type, bytes, ms, depth, title, description,
                        canonical, robots, h1, images_without_alt, internal_links, external_links, error, issue_count)
     select $1, x.url, x.final_url, x.status, x.redirects, x.content_type, x.bytes, x.ms, x.depth, x.title, x.description,
            x.canonical, x.robots, x.h1, x.images_without_alt, x.internal_links, x.external_links, x.error, x.issue_count
       from jsonb_to_recordset($2::jsonb) as x(
              url text, final_url text, status int, redirects text[], content_type text, bytes int, ms int, depth int,
              title text, description text, canonical text, robots text, h1 text[], images_without_alt int,
              internal_links int, external_links int, error text, issue_count int)
     on conflict (crawl_id, url) do nothing`,
    [crawlId, JSON.stringify(rows)],
  );
}

export async function saveIssues(db: Db, crawlId: string, issues: Issue[]) {
  if (!issues.length) return;
  await db.query(
    `insert into issues (crawl_id, type, severity, url, detail)
     select $1, x.type, x.severity, x.url, x.detail
       from jsonb_to_recordset($2::jsonb) as x(type text, severity text, url text, detail text)`,
    [crawlId, JSON.stringify(issues)],
  );
}

export async function finishCrawl(
  db: Db,
  id: string,
  status: "done" | "failed" | "cancelled",
  data: { summary?: Omit<AuditSummary, "duplicates">; crawled?: number; error?: string },
) {
  await db.query(
    `update crawls set status = $2, finished_at = now(), summary = $3, crawled = coalesce($4, crawled), error = $5
      where id = $1`,
    [id, status, data.summary ? JSON.stringify(data.summary) : null, data.crawled ?? null, data.error ?? null],
  );
}

/** Worker died mid crawl (deploy, OOM, laptop lid) - wipe partial results and queue it again. */
export async function requeueStale(db: Db, minutes = 5) {
  const client = await db.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ id: string }>(
      `update crawls set status = 'queued', worker_id = null, crawled = 0
        where status = 'running' and heartbeat_at < now() - make_interval(mins => $1)
        returning id`,
      [minutes],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await client.query("delete from pages where crawl_id = any($1)", [ids]);
      await client.query("delete from issues where crawl_id = any($1)", [ids]);
    }
    await client.query("commit");
    return ids;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
