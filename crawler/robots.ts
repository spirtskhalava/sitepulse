/**
 * Minimal robots.txt support: the group for our user agent (or *),
 * Allow/Disallow with * and $ wildcards, longest match wins.
 */
export interface Robots {
  allowed(url: string): boolean;
  sitemaps: string[];
}

export function parseRobots(txt: string, agent = "sitepulse"): Robots {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  const sitemaps: string[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === "user-agent") {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") sitemaps.push(value);
    else if ((key === "allow" || key === "disallow") && current) {
      // "Disallow:" with an empty value means allow everything
      if (value) current.rules.push({ allow: key === "allow", path: value });
    }
  }

  const mine = groups.find((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)));
  const rules = (mine ?? groups.find((g) => g.agents.includes("*")))?.rules ?? [];

  return {
    sitemaps,
    allowed(url: string) {
      const u = new URL(url);
      const path = u.pathname + u.search;
      let best: { allow: boolean; len: number } | null = null;
      for (const r of rules) {
        if (!matches(path, r.path)) continue;
        const len = r.path.length;
        // longest rule wins, Allow wins a tie
        if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
      }
      return best?.allow ?? true;
    },
  };
}

function matches(path: string, pattern: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + body + (anchored ? "$" : "")).test(path);
}
