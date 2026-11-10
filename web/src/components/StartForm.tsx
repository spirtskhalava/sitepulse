import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

export function StartForm() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(200);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const crawl = await api.start(url, maxPages);
      navigate(`/crawls/${crawl.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="start" onSubmit={submit}>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="example.com" required autoFocus />
      <select value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))}>
        <option value={50}>50 pages</option>
        <option value={200}>200 pages</option>
        <option value={1000}>1000 pages</option>
        <option value={5000}>5000 pages</option>
      </select>
      <button disabled={busy}>{busy ? "Starting…" : "Audit site"}</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
