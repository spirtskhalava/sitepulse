import type { Issue, PageResult } from "./types";

export const LIMITS = {
  titleMin: 15,
  titleMax: 60,
  descriptionMin: 70,
  descriptionMax: 160,
  slowMs: 2000,
  heavyBytes: 2_000_000,
};

const isHtml = (p: PageResult) => p.status >= 200 && p.status < 300 && p.contentType.includes("html");

/** Checks that only need one page. */
export function pageIssues(p: PageResult): Issue[] {
  const issues: Issue[] = [];
  const add = (type: Issue["type"], severity: Issue["severity"], detail?: string) =>
    issues.push({ type, severity, url: p.url, ...(detail ? { detail } : {}) });

  if (p.status === 0) add("broken", "error", p.error ?? "no response");
  else if (p.status >= 500) add("server-error", "error", String(p.status));
  else if (p.status >= 400) add("broken", "error", String(p.status));

  if (p.redirects.length > 1) add("redirect-chain", "warning", [...p.redirects, p.finalUrl].join(" → "));

  if (!isHtml(p)) return issues;

  if (!p.title) add("missing-title", "error");
  else if (p.title.length < LIMITS.titleMin || p.title.length > LIMITS.titleMax)
    add("title-length", "warning", `${p.title.length} chars`);

  if (!p.description) add("missing-description", "warning");
  else if (p.description.length < LIMITS.descriptionMin || p.description.length > LIMITS.descriptionMax)
    add("description-length", "notice", `${p.description.length} chars`);

  if (p.h1.length === 0) add("missing-h1", "warning");
  else if (p.h1.length > 1) add("multiple-h1", "notice", `${p.h1.length} h1 tags`);

  if (p.robots?.includes("noindex")) add("noindex", "notice", p.robots);
  if (p.canonical && p.canonical !== p.finalUrl) add("canonical-elsewhere", "notice", p.canonical);
  if (p.imagesWithoutAlt > 0) add("images-without-alt", "notice", `${p.imagesWithoutAlt} images`);
  if (p.ms > LIMITS.slowMs) add("slow", "warning", `${p.ms} ms`);
  if (p.bytes > LIMITS.heavyBytes) add("heavy", "warning", `${Math.round(p.bytes / 1024)} KB`);

  return issues;
}

/**
 * Duplicate titles/descriptions need every page, but we don't keep pages in
 * memory - the crawler calls `add` as pages finish and only a map of
 * value -> urls is held. Indexable pages only: noindex duplicates don't matter.
 */
export function createDuplicateTracker() {
  const titles = new Map<string, string[]>();
  const counted = new Set<string>(); // final URLs - a redirect to an already counted page isn't a duplicate
  const descriptions = new Map<string, string[]>();

  const push = (map: Map<string, string[]>, key: string | undefined, url: string) => {
    if (!key) return;
    const k = key.toLowerCase();
    const list = map.get(k);
    if (list) list.push(url);
    else map.set(k, [url]);
  };

  return {
    add(p: PageResult) {
      if (!isHtml(p) || p.robots?.includes("noindex")) return;
      // canonicalised pages point somewhere else on purpose
      if (p.canonical && p.canonical !== p.finalUrl) return;
      if (counted.has(p.finalUrl)) return;
      counted.add(p.finalUrl);
      push(titles, p.title, p.url);
      push(descriptions, p.description, p.url);
    },
    issues(): Issue[] {
      const out: Issue[] = [];
      for (const [value, urls] of titles) {
        if (urls.length > 1) urls.forEach((url) => out.push({ type: "duplicate-title", severity: "warning", url, detail: `"${value}" on ${urls.length} pages` }));
      }
      for (const [, urls] of descriptions) {
        if (urls.length > 1) urls.forEach((url) => out.push({ type: "duplicate-description", severity: "notice", url, detail: `same as ${urls.length - 1} other page(s)` }));
      }
      return out;
    },
  };
}

/** 0-100, errors weigh more than warnings, normalised by site size. */
export function healthScore(pages: number, issues: Issue[]): number {
  if (pages === 0) return 0;
  const weight = { error: 5, warning: 2, notice: 0.5 };
  const penalty = issues.reduce((s, i) => s + weight[i.severity], 0) / pages;
  return Math.max(0, Math.round(100 - penalty * 10));
}
