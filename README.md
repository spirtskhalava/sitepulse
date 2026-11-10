# sitepulse

Small technical SEO crawler. You give it a site, it walks through the pages and lists what's wrong: broken links, redirect chains, missing/duplicate titles and descriptions, no h1, noindex, slow or huge pages, images without alt.

React (Vite) for the UI, Node + Express API, a separate worker process for crawling, Postgres for everything.

## running it

```
docker compose up -d        # postgres
cp .env.example .env
npm install && (cd web && npm install)

npm run migrate
npm run dev                 # api on :3001
npm run worker              # in another terminal
cd web && npm run dev       # ui on :5173
```

Don't want the whole setup? `npm run crawl -- https://example.com 100` runs the crawler straight in the terminal, no db.

## how it works

The API just inserts a row into `crawls` with status `queued` and sends `NOTIFY crawl_queued`. Workers pick jobs with

```sql
update crawls set status = 'running' ...
where id = (select id from crawls where status = 'queued'
            order by created_at for update skip locked limit 1)
```

so you can run several workers and they never take the same crawl. No redis/queue lib needed for this size. While crawling the worker sends a heartbeat every 5s (also where it finds out a crawl was cancelled). If a worker dies, the crawl gets requeued after 5 min without heartbeat and the partial results are deleted.

Pages are written in batches of 50, as one `insert ... select from jsonb_to_recordset(...)` instead of 50 inserts.

The crawler itself (`crawler/`) doesn't know about the db, it takes a url and a callback. Memory was the thing I cared about most: html is parsed with htmlparser2 while it's downloading (no DOM), only the fields that get checked are kept, and finished pages are handed off right away. A big site costs roughly the queue + the set of seen urls.

Some other stuff it handles:
- `/about`, `/about/`, `/About#x`, `/about?utm_source=..` are the same page
- robots.txt incl. `*` and `$`, longest rule wins
- redirects are followed manually to see the whole chain
- nofollow links / meta nofollow aren't followed, pdf/images/etc skipped
- duplicate titles ignore noindex pages and pages canonicalised elsewhere

## tests

`npm test`. Crawler tests run against a fake site on localhost. The db tests use a real postgres (embedded-postgres downloads it on first run, takes a bit), because SKIP LOCKED and jsonb_to_recordset can't really be mocked.

## todo

- sitemap.xml: pages in the sitemap that nothing links to
- diff two crawls of the same site
- check external links (with per host rate limit)
- auth, right now anyone who can reach the api can start crawls
