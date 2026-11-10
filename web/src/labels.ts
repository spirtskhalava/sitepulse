import type { IssueType, Severity } from "./api";

export const ISSUES: Record<IssueType, { label: string; severity: Severity }> = {
  broken: { label: "Broken pages (4xx / no response)", severity: "error" },
  "server-error": { label: "Server errors (5xx)", severity: "error" },
  "missing-title": { label: "Missing title", severity: "error" },
  "redirect-chain": { label: "Redirect chains", severity: "warning" },
  "title-length": { label: "Title too short / too long", severity: "warning" },
  "duplicate-title": { label: "Duplicate titles", severity: "warning" },
  "missing-description": { label: "Missing meta description", severity: "warning" },
  "missing-h1": { label: "Missing H1", severity: "warning" },
  slow: { label: "Slow pages", severity: "warning" },
  heavy: { label: "Heavy pages", severity: "warning" },
  "description-length": { label: "Description too short / too long", severity: "notice" },
  "duplicate-description": { label: "Duplicate descriptions", severity: "notice" },
  "multiple-h1": { label: "More than one H1", severity: "notice" },
  noindex: { label: "Noindex", severity: "notice" },
  "canonical-elsewhere": { label: "Canonical points somewhere else", severity: "notice" },
  "images-without-alt": { label: "Images without alt", severity: "notice" },
};
