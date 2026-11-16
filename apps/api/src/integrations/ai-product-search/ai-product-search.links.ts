import { domainToASCII } from "node:url";

import { IANA_TLDS } from "./ai-product-search.tlds.js";

/**
 * EXTERNAL LINKS OUT OF THE TEXT THE MODEL READS (card 9d060f5c, plan v3 R3; Balázs's rule, card comment 728).
 *
 * The projection is where the catalogue's text leaves our side: what goes out here, the model reads, and an external
 * address in it can end up in an answer. Until now the text was clean only as a side effect (the HTML cleaner takes
 * an address in an attribute away with the tag, a plain-text one it leaves; `no-urls-in-answer.spec.ts`). Behind
 * `AI_PRODUCT_SEARCH_STRIP_LINKS` (exactly `true`, off by default) the descriptions and the parameters' text values
 * lose every address that is not our own domain. The AI service's answer gate (R2) is the protection for what the
 * model says from its own memory; this only removes what the catalogue would hand it.
 *
 * THE RECOGNITION IS A COPY of acropora-ai-agent `apps/api/src/answer-link-guard.ts` at b3b591a (#75), with the
 * `sourceHostKey` of its follow-up (acrobot 46930: a stored source matches with or without `www.`), from
 * `FILE_EXTENSION_TLDS` to `findLinks`, so both sides read the same text as an address. Two changes, marked "OS
 * addition": every link carries its position, and `findLinks` returns them. A change to the recognition belongs in
 * both places; the ai-agent spec is the matrix, `ai-product-search.links.spec.ts` repeats its rows that matter here.
 */

const fold = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const FILE_EXTENSION_TLDS = new Set(["zip", "mov"]);

/**
 * Words that are TLDs AND the ordinary next word after "pont"/"dot" ("ez pont
 * az", "pont ma", "the dot is"). A spelled-out separator is read only before a
 * TLD that is none of these; a bracketed dot is read before anything.
 */
export const SPELLED_SEPARATOR_STOPWORDS = new Set([
  // Hungarian, folded ("jó" is "jo", "és" is "es")
  "az",
  "is",
  "ma",
  "jo",
  "ott",
  "de",
  "be",
  "ki",
  "se",
  "ne",
  "mint",
  "es",
  // English
  "to",
  "in",
  "at",
  "it",
  "be",
  "do",
  "no",
  "so",
  "as",
  "by",
  "my",
  "me",
  "us",
  "am",
  "one",
  "now",
  "new",
  "how",
  "you",
  "best",
  "top",
  "fit",
  "fun",
  "win",
  "pro",
  "plus",
  "live",
  "love",
  "life",
  "care",
  "fish",
  "pet",
  "shop",
  "tips",
  "eco",
  "bio",
  "red",
  "blue",
  "black",
  "green",
  "pink",
  "gold",
]);

export interface FoundLink {
  /** Normalised ASCII host, lower case, no port, no trailing dot; an IP as written. */
  host: string;
  ip: boolean;
  /** The path, when the form carries one ("" otherwise). */
  path: string;
}

/** A found link and where it stands in the text (OS addition: the projection cuts it out). */
export interface PlacedLink extends FoundLink {
  start: number;
  end: number;
}

const LABEL =
  "[\\p{L}\\p{M}\\p{N}](?:[\\p{L}\\p{M}\\p{N}-]*[\\p{L}\\p{M}\\p{N}])?";
// what ends an address in running text: space, quotes, brackets, angle brackets
const URL_BODY = "[^\\s<>\"'`()\\[\\]{}]";

/**
 * The host as the guard compares it: ASCII (IDN to punycode), lower case, the
 * trailing dot off, and a Hungarian case ending off the last label
 * ("acropora.hu-n", "redsea.com-on"): the ending is grammar, not a label.
 * Text that does not normalise (an invalid IDN) stays as it was, lower case:
 * it is never our domain, so it is a violation.
 */
export function normalizeHost(raw: string): string {
  let host = raw.trim().replace(/\.+$/, "");
  const ascii = domainToASCII(host);
  host = (ascii === "" ? host : ascii).toLowerCase().replace(/\.+$/, "");
  const labels = host.split(".");
  const last = labels[labels.length - 1] ?? "";
  const dash = last.indexOf("-");
  if (
    labels.length > 1 &&
    !IANA_TLDS.has(last) &&
    dash > 0 &&
    IANA_TLDS.has(last.slice(0, dash))
  )
    labels[labels.length - 1] = last.slice(0, dash);
  return labels.join(".");
}

/**
 * The key a host is compared with the stored source list by (acrobot 46930): EXACT, except a leading `www.`, on both
 * sides, so an entry "redseafish.com" covers "www.redseafish.com" and back; any other subdomain is another host.
 */
export const sourceHostKey = (host: string) => host.replace(/^www\./, "");

const isIPv4 = (host: string) =>
  /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) &&
  host.split(".").every((part) => Number(part) <= 255);

/** Host and path out of an address with an authority part; a URL that does not parse still gives its host. */
function fromAuthority(withScheme: string): FoundLink {
  const trimmed = withScheme.replace(/[.,;:!?]+$/, "");
  try {
    const url = new URL(trimmed);
    const hostname = url.hostname;
    if (hostname.startsWith("["))
      return { host: hostname.slice(1, -1), ip: true, path: url.pathname };
    const host = normalizeHost(hostname);
    return { host, ip: isIPv4(host), path: url.pathname };
  } catch {
    const authority =
      trimmed.replace(/^[^:]*:\/\//, "").split(/[/?#\\]/)[0] ?? "";
    const host = normalizeHost(
      authority.slice(authority.lastIndexOf("@") + 1).replace(/:\d*$/, ""),
    );
    return { host, ip: isIPv4(host), path: "" };
  }
}

const SCHEME_URL = new RegExp(
  `\\b[a-z][a-z0-9+.-]{1,15}:\\/\\/${URL_BODY}+`,
  "giu",
);
const SCHEMELESS_URL = new RegExp(
  `(?<![\\p{L}\\p{N}:/])\\/\\/${URL_BODY}+`,
  "gu",
);
const WWW_URL = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}.@-])www\\.${URL_BODY}+`,
  "giu",
);
const IPV6 = /\[[0-9a-f.]*:[0-9a-f.]*:[0-9a-f:.]*\]/giu;
const IPV4 = /(?<![\p{N}.])(?:\d{1,3}\.){3}\d{1,3}(?![\p{N}]|\.\d)/gu;
const BRACKET_DOT =
  "\\s*(?:\\[\\s*\\.\\s*\\]|\\(\\s*\\.\\s*\\)|\\{\\s*\\.\\s*\\})\\s*";
const BRACKETED = new RegExp(
  `${LABEL}(?:(?:${BRACKET_DOT}|\\.)${LABEL})*${BRACKET_DOT}${LABEL}(?:(?:${BRACKET_DOT}|\\.)${LABEL})*`,
  "gu",
);
// a word between spaces, or in brackets: "idopontban" or "anecdote" hold the word, not the separator
const SPELLED_DOT =
  "(?:\\s+(?:pont|dot)\\s+|\\s*[\\[({]\\s*(?:pont|dot)\\s*[\\])}]\\s*)";
const SPELLED = new RegExp(`${LABEL}(?:${SPELLED_DOT}${LABEL})+`, "giu");
const BARE = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}_.\\/-])(?:${LABEL}\\.)+${LABEL}(?![\\p{L}\\p{M}\\p{N}_]|\\.[\\p{L}\\p{M}\\p{N}])(?::\\d{1,5})?(\\/${URL_BODY}*)?`,
  "gu",
);

/** The last label is a real TLD (a case ending after a hyphen aside). */
const onRealTld = (host: string) => IANA_TLDS.has(host.split(".").pop() ?? "");

/**
 * Every address in the text, in the order of the passes (plan 5.1). Each pass
 * blanks what it took, so a URL is not counted again as a bare domain.
 */
export function findLinks(text: string): PlacedLink[] {
  let rest = text;
  const found: PlacedLink[] = [];
  // `group` is the first capture group (only BARE has one: the path), "" when there is none. OS addition: the
  // offset is the first number among the callback's arguments; the blanking keeps the length, so it is the
  // position in the ORIGINAL text in every pass
  const take = (
    pattern: RegExp,
    read: (whole: string, group: string) => FoundLink | null,
  ) => {
    rest = rest.replace(pattern, (whole: string, ...more: unknown[]) => {
      const link = read(whole, typeof more[0] === "string" ? more[0] : "");
      if (!link) return whole;
      const start =
        more.find((item): item is number => typeof item === "number") ?? 0;
      // the sentence's own punctuation after an address is not part of it (fromAuthority drops it for the host too)
      const end = start + whole.replace(/[.,;:!?]+$/, "").length;
      found.push({ ...link, start, end });
      return " ".repeat(whole.length);
    });
  };

  take(SCHEME_URL, (whole) => fromAuthority(whole));
  take(SCHEMELESS_URL, (whole) => fromAuthority(`http:${whole}`));
  take(WWW_URL, (whole) => fromAuthority(`http://${whole}`));
  take(IPV6, (whole) => ({
    host: whole.slice(1, -1).toLowerCase(),
    ip: true,
    path: "",
  }));
  take(IPV4, (whole) =>
    isIPv4(whole) ? { host: whole, ip: true, path: "" } : null,
  );
  take(BRACKETED, (whole) => ({
    host: normalizeHost(whole.replace(new RegExp(BRACKET_DOT, "gu"), ".")),
    ip: false,
    path: "",
  }));
  take(SPELLED, (whole) => {
    const labels = whole.split(new RegExp(SPELLED_DOT, "iu"));
    if (SPELLED_SEPARATOR_STOPWORDS.has(fold(labels[labels.length - 1] ?? "")))
      return null;
    const host = normalizeHost(labels.join("."));
    return onRealTld(host) ? { host, ip: false, path: "" } : null;
  });
  take(BARE, (whole, path) => {
    const host = normalizeHost(whole.replace(/(?::\d{1,5})?(?:\/.*)?$/su, ""));
    const tld = host.split(".").pop() ?? "";
    if (!IANA_TLDS.has(tld) || FILE_EXTENSION_TLDS.has(tld)) return null;
    return { host, ip: false, path };
  });
  return found;
}

/** Our domain or a subdomain of it, on a label boundary. An IP never is. */
export const OWN_DOMAIN = "acropora.hu";

export const isOwnHost = (link: FoundLink) =>
  !link.ip &&
  (link.host === OWN_DOMAIN || link.host.endsWith(`.${OWN_DOMAIN}`));

export const STRIP_LINKS_ENV = "AI_PRODUCT_SEARCH_STRIP_LINKS";

/** Exactly `true` turns the stripping on; anything else leaves the projection as it was. Read per call. */
export const stripLinksEnabled = (
  environment: NodeJS.ProcessEnv = process.env,
): boolean => environment[STRIP_LINKS_ENV] === "true";

export interface StrippedText {
  text: string;
  /** The hosts taken out, in order, unique: for the log, never the URL. */
  hosts: string[];
}

/**
 * The text without its external addresses; our own stay. What an address leaves behind is tidied: the space it
 * stood in, an empty pair of brackets (a markdown link's target, "(https://x.com)"), a space before punctuation.
 */
export function stripExternalLinks(text: string): StrippedText {
  const external = findLinks(text)
    .filter((link) => !isOwnHost(link))
    .sort((a, b) => a.start - b.start);
  if (external.length === 0) return { text, hosts: [] };
  let out = "";
  let at = 0;
  for (const link of external) {
    if (link.start < at) continue;
    out += text.slice(at, link.start);
    at = link.end;
  }
  out += text.slice(at);
  const tidy = out
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}|<\s*>/g, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .trim();
  return { text: tidy, hosts: [...new Set(external.map((link) => link.host))] };
}

/**
 * The parameters payload with every string value stripped the same way (keys are names, not text, and stay). Any
 * other value (a number, a boolean, null) passes as it is.
 */
export function stripExternalLinksDeep(
  value: unknown,
  hosts: Set<string> = new Set(),
): unknown {
  if (typeof value === "string") {
    const stripped = stripExternalLinks(value);
    stripped.hosts.forEach((host) => hosts.add(host));
    return stripped.text;
  }
  if (Array.isArray(value))
    return value.map((item) => stripExternalLinksDeep(item, hosts));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        stripExternalLinksDeep(item, hosts),
      ]),
    );
  return value;
}
