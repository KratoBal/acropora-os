export type TaskLinkResult = { valid: true; value?: string } | { valid: false };

/**
 * A task's link is rendered as an anchor `href` in the web UI, so the
 * scheme is a security boundary, not a formatting preference: a
 * `javascript:` or `data:` URL would execute in the reader's session. Only
 * absolute http(s) URLs are accepted, and anything else is rejected
 * outright rather than sanitised - a silently rewritten link is worse than
 * a refused one, because the author never learns their link was changed.
 *
 * An empty or whitespace-only input is valid and means "no link".
 */
export function parseTaskLink(raw: string | undefined): TaskLinkResult {
  const trimmed = raw?.trim();
  if (!trimmed) return { valid: true };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false };
  }

  return { valid: true, value: parsed.toString() };
}
