// quick audit in the terminal, no db:  npm run crawl -- https://example.com 200
import { runAudit } from "../crawler/audit";

const [url, max = "100"] = process.argv.slice(2);
if (!url) {
  console.error("usage: npm run crawl -- <url> [maxPages]");
  process.exit(1);
}

const started = Date.now();
const s = await runAudit({ startUrl: url, maxPages: Number(max) }, {
  page(p, found) {
    const flag = found.some((i) => i.severity === "error") ? "✗" : found.length ? "!" : "✓";
    console.log(`${flag} ${p.status || "ERR"} ${String(p.ms).padStart(5)}ms  ${p.url}`);
  },
});

console.log(`\n${s.crawled} pages in ${((Date.now() - started) / 1000).toFixed(1)}s, score ${s.score}/100`);
if (s.truncated) console.log(`stopped at ${max}, found ${s.discovered - s.crawled} more`);
console.log(`rss ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB\n`);
for (const [type, n] of Object.entries(s.counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${type}`);
