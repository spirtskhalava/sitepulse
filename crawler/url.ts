const TRACKING = /^(utm_\w+|gclid|fbclid|mc_cid|mc_eid|_ga|yclid|ref)$/i;

/**
 * One page, one key. Without this the crawler visits /about, /about/,
 * /About#team and /about?utm_source=x as four different pages.
 */
export function normalizeUrl(raw: string, base?: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/\.$/, "");
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) u.port = "";

  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();

  // trailing slash: keep it only for the root
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString();
}

/** www.example.com and example.com count as the same site. */
export function sameSite(a: string, b: string): boolean {
  const host = (s: string) => new URL(s).hostname.replace(/^www\./, "");
  return host(a) === host(b);
}

const SKIP_EXT = /\.(jpe?g|png|gif|webp|svg|ico|pdf|zip|rar|gz|mp4|mp3|webm|avi|mov|woff2?|ttf|eot|css|js|xml|json|docx?|xlsx?|pptx?)$/i;

export function looksLikePage(url: string): boolean {
  return !SKIP_EXT.test(new URL(url).pathname);
}
