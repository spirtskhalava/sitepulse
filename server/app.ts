import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeUrl } from "../crawler/url";
import type { Db } from "./db";
import { allPages, createCrawl, getCrawl, issuesOfType, listCrawls, listPages, requestCancel } from "./repo";

const CSV_COLS = ["url", "final_url", "status", "depth", "ms", "bytes", "title", "description", "canonical", "robots", "h1", "issue_count"];

const csvCell = (v: unknown) => {
  const s = Array.isArray(v) ? v.join(" | ") : v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function createApp(db: Db) {
  const app = express();
  app.use(express.json({ limit: "10kb" }));

  app.get("/api/crawls", async (_req, res) => {
    res.json(await listCrawls(db));
  });

  app.post("/api/crawls", async (req, res) => {
    const raw = String(req.body?.url ?? "").trim();
    const url = raw && normalizeUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!url || !/\./.test(new URL(url).hostname)) {
      res.status(400).json({ error: "That doesn't look like a website address" });
      return;
    }
    const maxPages = Math.min(Math.max(Number(req.body?.maxPages) || 200, 1), 5000);
    res.status(201).json(await createCrawl(db, url, maxPages));
  });

  app.get("/api/crawls/:id", async (req, res) => {
    const crawl = /^\d+$/.test(req.params.id) ? await getCrawl(db, req.params.id) : null;
    if (!crawl) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(crawl);
  });

  app.post("/api/crawls/:id/cancel", async (req, res) => {
    const status = await requestCancel(db, req.params.id);
    res.status(status ? 200 : 409).json({ status });
  });

  app.post("/api/crawls/:id/rerun", async (req, res) => {
    const old = await getCrawl(db, req.params.id);
    if (!old) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.status(201).json(await createCrawl(db, old.url, old.max_pages));
  });

  app.get("/api/crawls/:id/issues", async (req, res) => {
    res.json(await issuesOfType(db, req.params.id, String(req.query.type ?? "")));
  });

  app.get("/api/crawls/:id/pages", async (req, res) => {
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    res.json(await listPages(db, req.params.id, 500, offset));
  });

  // streams rows as they come from the db, a 5000 page crawl never sits in memory
  app.get("/api/crawls/:id/export.csv", async (req, res) => {
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="sitepulse-${req.params.id}.csv"`);
    res.write("﻿" + CSV_COLS.join(",") + "\n"); // BOM, otherwise excel breaks georgian text
    for await (const rows of allPages(db, req.params.id)) {
      res.write(rows.map((r) => CSV_COLS.map((c) => csvCell(r[c])).join(",")).join("\n") + "\n");
    }
    res.end();
  });

  // in production the built react app is served from here too
  const web = path.join(path.dirname(fileURLToPath(import.meta.url)), "../web/dist");
  if (existsSync(web)) {
    app.use(express.static(web));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(web, "index.html")));
  }

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "something went wrong" });
  });

  return app;
}
