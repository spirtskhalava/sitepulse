import { useCallback } from "react";
import { Link } from "react-router-dom";
import { api, isActive, shortUrl, type Crawl } from "../api";
import { Score } from "../components/Score";
import { StartForm } from "../components/StartForm";
import { usePolling } from "../usePolling";

export function Home() {
  const load = useCallback(() => api.crawls(), []);
  const anyRunning = useCallback((list: Crawl[]) => list.some(isActive), []);
  const { data: crawls, error } = usePolling(load, anyRunning, 3000);

  return (
    <>
      <StartForm />
      {error && <p className="error">{error}</p>}
      <table className="list">
        <thead>
          <tr><th>Site</th><th>Status</th><th>Pages</th><th>Errors</th><th>Score</th><th>Started</th></tr>
        </thead>
        <tbody>
          {crawls?.map((c) => (
            <tr key={c.id}>
              <td><Link to={`/crawls/${c.id}`}>{shortUrl(c.url)}</Link></td>
              <td><span className={`status ${c.status}`}>{c.status}</span></td>
              <td>{c.crawled}</td>
              <td>{c.summary?.bySeverity.error ?? "–"}</td>
              <td><Score value={c.summary?.score} /></td>
              <td>{new Date(c.created_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {crawls?.length === 0 && <p className="muted">Nothing here yet. Start an audit above (and keep <code>npm run worker</code> running).</p>}
    </>
  );
}
