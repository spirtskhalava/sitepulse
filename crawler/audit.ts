import { createDuplicateTracker, healthScore, pageIssues } from "./checks";
import { crawl, type CrawlOptions } from "./crawl";
import type { Issue, PageResult } from "./types";

export interface AuditSink {
  page(page: PageResult, issues: Issue[]): Promise<void> | void;
  progress?(crawled: number): Promise<void> | void;
}

export interface AuditSummary {
  crawled: number;
  discovered: number;
  blockedByRobots: number;
  truncated: boolean;
  score: number;
  counts: Record<string, number>; // issue type -> count
  bySeverity: Record<Issue["severity"], number>;
  duplicates: Issue[];
}

/** Crawl + per-page checks while crawling + duplicate checks at the end. */
export async function runAudit(opts: Omit<CrawlOptions, "onPage">, sink: AuditSink): Promise<AuditSummary> {
  const dupes = createDuplicateTracker();
  const counts: Record<string, number> = {};
  const bySeverity = { error: 0, warning: 0, notice: 0 };
  const all: Issue[] = [];
  let n = 0;

  const count = (issues: Issue[]) => {
    for (const i of issues) {
      counts[i.type] = (counts[i.type] ?? 0) + 1;
      bySeverity[i.severity]++;
      // only the severity matters for the score, keep a light copy
      all.push({ type: i.type, severity: i.severity, url: "" });
    }
  };

  const stats = await crawl({
    ...opts,
    async onPage(page) {
      const issues = pageIssues(page);
      count(issues);
      dupes.add(page);
      await sink.page(page, issues);
      if (++n % 10 === 0) await sink.progress?.(n);
    },
  });

  const duplicates = dupes.issues();
  count(duplicates);

  return { ...stats, score: healthScore(stats.crawled, all), counts, bySeverity, duplicates };
}
