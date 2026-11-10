export interface PageResult {
  url: string;
  finalUrl: string; // after redirects
  status: number; // 0 = network error / timeout
  redirects: string[]; // hops before finalUrl
  contentType: string;
  bytes: number;
  ms: number; // time to last byte
  depth: number;
  title?: string;
  description?: string;
  canonical?: string;
  robots?: string; // meta robots
  h1: string[];
  imagesWithoutAlt: number;
  internalLinks: number;
  externalLinks: number;
  error?: string;
}

export type IssueType =
  | "broken"
  | "server-error"
  | "redirect-chain"
  | "missing-title"
  | "title-length"
  | "duplicate-title"
  | "missing-description"
  | "description-length"
  | "duplicate-description"
  | "missing-h1"
  | "multiple-h1"
  | "noindex"
  | "canonical-elsewhere"
  | "images-without-alt"
  | "slow"
  | "heavy";

export type Severity = "error" | "warning" | "notice";

export interface Issue {
  type: IssueType;
  severity: Severity;
  url: string;
  detail?: string;
}
