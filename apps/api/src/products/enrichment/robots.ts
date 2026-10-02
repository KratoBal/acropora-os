/**
 * ROBOTS.TXT, READ THE WAY THE RFC 9309 SAYS (the subset we need).
 *
 * - The group for our product token wins over `*`; no matching group means
 *   everything is allowed.
 * - Within the group, the longest matching path wins; on a tie, Allow wins.
 *   `*` matches any run of characters and a trailing `$` anchors the end.
 * - An empty `Disallow:` disallows nothing.
 * - `Crawl-delay` (seconds), when the group has one, is kept so the fetcher
 *   can wait at least that long between two requests to the host.
 */
export interface RobotsRules {
  rules: readonly { allow: boolean; pattern: string }[];
  crawlDelaySeconds: number | null;
}

export const ALLOW_ALL: RobotsRules = { rules: [], crawlDelaySeconds: null };
export const DISALLOW_ALL: RobotsRules = {
  rules: [{ allow: false, pattern: "/" }],
  crawlDelaySeconds: null,
};

interface Group {
  agents: string[];
  rules: { allow: boolean; pattern: string }[];
  crawlDelaySeconds: number | null;
}

export function parseRobots(text: string, productToken: string): RobotsRules {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelaySeconds: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      if (value === "") continue; // an empty rule says nothing
      current.rules.push({ allow: key === "allow", pattern: value });
    } else if (key === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0)
        current.crawlDelaySeconds = seconds;
    }
  }
  const token = productToken.toLowerCase();
  const own = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && token.startsWith(a)),
  );
  const chosen = own.length
    ? own
    : groups.filter((g) => g.agents.includes("*"));
  if (chosen.length === 0) return ALLOW_ALL;
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelaySeconds:
      chosen.map((g) => g.crawlDelaySeconds).find((d) => d !== null) ?? null,
  };
}

function matchLength(pattern: string, path: string): number {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = new RegExp(
    "^" +
      body
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      (anchored ? "$" : ""),
  );
  return regex.test(path) ? body.length : -1;
}

/** May `pathWithQuery` (e.g. `/p/x?y=1`) be fetched under these rules? */
export function robotsAllows(
  rules: RobotsRules,
  pathWithQuery: string,
): boolean {
  let best = -1;
  let allowed = true;
  for (const rule of rules.rules) {
    const length = matchLength(rule.pattern, pathWithQuery);
    if (length < 0) continue;
    if (length > best || (length === best && rule.allow)) {
      best = length;
      allowed = rule.allow;
    }
  }
  return allowed;
}
