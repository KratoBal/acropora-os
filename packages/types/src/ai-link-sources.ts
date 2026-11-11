/**
 * THE STORED LINK SOURCES OF THE AI CHAT (Acropora AI card 9d060f5c; Balázs's rule, card comment 728; plan v3
 * `agents/nautilus/atadas/TERV-ai-kulso-linkek-v3-2026-11-11.md` sections 4 and 6.3).
 *
 * The AI service's answer gate lets NO external link out by default. A host may pass only if it is on this list
 * AND one of three independent exceptions holds there: the user asked for a link (K1, any category); a
 * MANUFACTURER_DOCUMENT of the brand of one of the search hits (K2); an AUTHORITY host on a legal, authority,
 * warranty or safety question (K3). The URL never comes from the model's memory (acrobot on the card, 736): the
 * list is what turns an exception on, so an EMPTY list means no exception is active.
 *
 * One entry is one row (not a JSON column of the settings), so every addition and removal has its own audit row.
 * The rule below is the server's and the Settings form's, one function, one Hungarian sentence per refusal.
 */
export const AI_LINK_SOURCE_CATEGORIES = [
  "MANUFACTURER_DOCUMENT",
  "AUTHORITY",
] as const;

export type AiLinkSourceCategory = (typeof AI_LINK_SOURCE_CATEGORIES)[number];

export const AI_LINK_SOURCE_LIMITS = {
  brand: 100,
  note: 300,
} as const;

/** Our own domain: never an entry, the gate lets it through without a list (acrobot 46815). */
export const AI_LINK_OWN_DOMAIN = "acropora.hu";

export interface AiLinkSourceInput {
  /** The host as the gate compares it: ASCII (IDN in punycode), lower case, no scheme, port, path or trailing dot. */
  host: string;
  category: AiLinkSourceCategory;
  /** The brand's name; required for a manufacturer document, absent for an authority. */
  brand: string | null;
  note: string | null;
}

export interface AiLinkSource extends AiLinkSourceInput {
  id: string;
  createdAt: string;
}

/** What the AI SERVICE reads: what the gate compares, nothing else (no note, no id, no author). */
export interface AiLinkSourceServiceEntry {
  host: string;
  category: AiLinkSourceCategory;
  brand: string | null;
}

export type AiLinkSourceCheck =
  { ok: true; value: AiLinkSourceInput } | { ok: false; error: string };

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * The host, normalised the way the gate normalises it, or null. `new URL` does the IDN step (it runs in the browser
 * and on the server alike); everything around it is refused rather than cleaned: a scheme, a path, a port, a space
 * or an `@` means the person pasted something other than a host, and guessing which part they meant could store
 * the wrong one. An IP is refused too: the gate never treats an IP as a listed source.
 */
export function normalizeAiLinkHost(raw: string): string | null {
  const trimmed = raw.trim().replace(/\.$/, "");
  if (trimmed === "" || !/^[\p{L}\p{M}\p{N}.-]+$/u.test(trimmed)) return null;
  let host: string;
  try {
    host = new URL(`http://${trimmed}`).hostname;
  } catch {
    return null;
  }
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label)))
    return null;
  const tld = labels[labels.length - 1]!;
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) return null;
  return host;
}

const optionalText = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

export function checkAiLinkSource(input: unknown): AiLinkSourceCheck {
  const body =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};

  const host =
    typeof body.host === "string" ? normalizeAiLinkHost(body.host) : null;
  if (host === null)
    return {
      ok: false,
      error:
        "A forrás egy domain név lehet (például gyarto.com), séma, útvonal és port nélkül.",
    };
  if (host === AI_LINK_OWN_DOMAIN || host.endsWith(`.${AI_LINK_OWN_DOMAIN}`))
    return {
      ok: false,
      error: "A saját domain nem kell a listára: az AI mindig hivatkozhat rá.",
    };

  const category = body.category;
  if (
    typeof category !== "string" ||
    !(AI_LINK_SOURCE_CATEGORIES as readonly string[]).includes(category)
  )
    return {
      ok: false,
      error: "A forrás fajtája gyártói dokumentum vagy hatóság lehet.",
    };

  const brand = optionalText(body.brand);
  if (brand === undefined)
    return { ok: false, error: "A márka egy név lehet." };
  if (category === "MANUFACTURER_DOCUMENT" && brand === null)
    return {
      ok: false,
      error:
        "Gyártói dokumentumhoz márka kell: csak az ilyen márkájú termékre adott válaszban mehet ki.",
    };
  if (category === "AUTHORITY" && brand !== null)
    return { ok: false, error: "Hatósági forráshoz nem tartozik márka." };
  if (brand !== null && brand.length > AI_LINK_SOURCE_LIMITS.brand)
    return {
      ok: false,
      error: `A márka legfeljebb ${AI_LINK_SOURCE_LIMITS.brand} karakter lehet.`,
    };

  const note = optionalText(body.note);
  if (note === undefined)
    return { ok: false, error: "A megjegyzés szöveg lehet." };
  if (note !== null && note.length > AI_LINK_SOURCE_LIMITS.note)
    return {
      ok: false,
      error: `A megjegyzés legfeljebb ${AI_LINK_SOURCE_LIMITS.note} karakter lehet.`,
    };

  return {
    ok: true,
    value: {
      host,
      category: category as AiLinkSourceCategory,
      brand,
      note,
    },
  };
}
