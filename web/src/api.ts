import type { Issue, IssueType, Severity } from "../../crawler/types";

export type { Issue, IssueType, Severity };

export interface Summary {
  crawled: number;
  discovered: number;
  blockedByRobots: number;
  truncated: boolean;
  score: number;
  counts: Partial<Record<IssueType, number>>;
  bySeverity: Record<Severity, number>;
}

export interface Crawl {
  id: string;
  url: string;
  max_pages: number;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  crawled: number;
  cancel_requested: boolean;
  error: string | null;
  summary: Summary | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface PageRow {
  url: string;
  status: number;
  depth: number;
  ms: number;
  bytes: number;
  title: string | null;
  issue_count: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { ...init, headers: { "content-type": "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
  return data as T;
}

export const api = {
  crawls: () => request<Crawl[]>("/crawls"),
  crawl: (id: string) => request<Crawl>(`/crawls/${id}`),
  start: (url: string, maxPages: number) => request<Crawl>("/crawls", { method: "POST", body: JSON.stringify({ url, maxPages }) }),
  cancel: (id: string) => request(`/crawls/${id}/cancel`, { method: "POST" }),
  rerun: (id: string) => request<Crawl>(`/crawls/${id}/rerun`, { method: "POST" }),
  issues: (id: string, type: IssueType) => request<Issue[]>(`/crawls/${id}/issues?type=${type}`),
  pages: (id: string) => request<PageRow[]>(`/crawls/${id}/pages`),
};

export const isActive = (c: Crawl) => c.status === "queued" || c.status === "running";
export const shortUrl = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");
