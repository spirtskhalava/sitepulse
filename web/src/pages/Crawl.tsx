import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, isActive, shortUrl, type Crawl as CrawlT, type Issue, type IssueType, type PageRow } from "../api";
import { Score } from "../components/Score";
import { ISSUES } from "../labels";
import { usePolling } from "../usePolling";

const ORDER = (Object.keys(ISSUES) as IssueType[]); // already sorted error -> notice

export function Crawl() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = params.get("tab") === "pages" ? "pages" : "issues";
  const type = params.get("type") as IssueType | null;

  const load = useCallback(() => api.crawl(id), [id]);
  const { data: crawl, error, refresh } = usePolling(load, isActive, 2000);

  if (error) return <p className="error">{error}</p>;
  if (!crawl) return <p className="muted">Loading…</p>;
  const s = crawl.summary;

  return (
    <div className="crawl">
      <div className="head">
        <div>
          <h1>{shortUrl(crawl.url)}</h1>
          <p className="muted">
            <span className={`status ${crawl.status}`}>{crawl.status}</span> {crawl.crawled} / {crawl.max_pages} pages
            {crawl.started_at && crawl.finished_at && ` · ${Math.round((+new Date(crawl.finished_at) - +new Date(crawl.started_at)) / 1000)}s`}
            {s?.truncated && " · hit the page limit"}
            {s && s.blockedByRobots > 0 && ` · ${s.blockedByRobots} blocked by robots.txt`}
          </p>
          {crawl.error && <p className="error">{crawl.error}</p>}
        </div>
        <div className="buttons">
          {isActive(crawl) ? (
            <button className="ghost" disabled={crawl.cancel_requested} onClick={() => api.cancel(id).then(refresh)}>
              {crawl.cancel_requested ? "Stopping…" : "Stop"}
            </button>
          ) : (
            <>
              <a className="button ghost" href={`/api/crawls/${id}/export.csv`}>Export CSV</a>
              <button onClick={async () => navigate(`/crawls/${(await api.rerun(id)).id}`)}>Run again</button>
            </>
          )}
        </div>
      </div>

      {isActive(crawl) && (
        <div className="progress"><div style={{ width: `${Math.min(100, (crawl.crawled / crawl.max_pages) * 100)}%` }} /></div>
      )}

      {s && (
        <section className="cards">
          <div><Score value={s.score} /><small>health</small></div>
          <div><b className="error">{s.bySeverity.error}</b><small>errors</small></div>
          <div><b className="warn">{s.bySeverity.warning}</b><small>warnings</small></div>
          <div><b>{s.bySeverity.notice}</b><small>notices</small></div>
        </section>
      )}

      <nav className="tabs">
        <button className={tab === "issues" ? "on" : ""} onClick={() => setParams({})}>Issues</button>
        <button className={tab === "pages" ? "on" : ""} onClick={() => setParams({ tab: "pages" })}>Pages</button>
      </nav>

      {tab === "pages" ? (
        <PagesTable crawl={crawl} />
      ) : (
        <div className="issues">
          <ul className="types">
            {!s && <li className="muted">Issues show up when the crawl is done.</li>}
            {s && Object.keys(s.counts).length === 0 && <li className="muted">No issues, nice.</li>}
            {s && ORDER.filter((t) => s.counts[t]).map((t) => (
              <li key={t} className={type === t ? "on" : ""}>
                <Link to={`?type=${t}`}>
                  <span className={`dot ${ISSUES[t].severity}`} />
                  {ISSUES[t].label}
                  <b>{s.counts[t]}</b>
                </Link>
              </li>
            ))}
          </ul>
          {type && s && <IssueList crawlId={id} type={type} />}
        </div>
      )}
    </div>
  );
}

function IssueList({ crawlId, type }: { crawlId: string; type: IssueType }) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  useEffect(() => {
    setIssues(null);
    api.issues(crawlId, type).then(setIssues);
  }, [crawlId, type]);

  return (
    <div className="affected">
      <h2>{ISSUES[type].label}</h2>
      {!issues ? (
        <p className="muted">Loading…</p>
      ) : (
        <table>
          <tbody>
            {issues.map((i, n) => (
              <tr key={n}>
                <td><a href={i.url} target="_blank" rel="noreferrer">{i.url}</a></td>
                <td className="muted">{i.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {issues?.length === 300 && <p className="muted">First 300 only, the CSV has everything.</p>}
    </div>
  );
}

function PagesTable({ crawl }: { crawl: CrawlT }) {
  const [pages, setPages] = useState<PageRow[] | null>(null);
  // reload while running so the table grows with the crawl
  useEffect(() => {
    api.pages(crawl.id).then(setPages);
  }, [crawl.id, crawl.crawled]);

  if (!pages) return <p className="muted">Loading…</p>;
  return (
    <table className="pages">
      <thead>
        <tr><th>URL</th><th>Status</th><th>Title</th><th>Depth</th><th>Time</th><th>Size</th><th>Issues</th></tr>
      </thead>
      <tbody>
        {pages.map((p) => (
          <tr key={p.url}>
            <td><a href={p.url} target="_blank" rel="noreferrer">{p.url.replace(/^https?:\/\/[^/]+/, "") || "/"}</a></td>
            <td className={p.status >= 400 || p.status === 0 ? "error" : ""}>{p.status || "ERR"}</td>
            <td>{p.title ?? <i className="muted">none</i>}</td>
            <td>{p.depth}</td>
            <td>{p.ms} ms</td>
            <td>{p.bytes ? `${Math.round(p.bytes / 1024)} KB` : "–"}</td>
            <td>{p.issue_count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
