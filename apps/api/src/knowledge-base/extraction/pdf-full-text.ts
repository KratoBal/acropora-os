import { createHash } from "node:crypto";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import {
  ALLOW_ALL,
  DISALLOW_ALL,
  parseRobots,
  robotsAllows,
  type RobotsRules,
} from "../../products/enrichment/robots.js";
import { DISCOVERY_USER_AGENT } from "../discovery/scholarly-client.js";
import { MAX_LOCATOR, type TextSection } from "./jats-text.js";

/**
 * THE OPEN PDF OF A SOURCE WITHOUT A EUROPE PMC FULL TEXT (research-kepes-
 * kiolvasas, first slice; acrobot 37378). Measured on the stage's 42 included
 * sources: 18 have no JATS, 16 of them are open access (`oaUrl`, OpenAlex's
 * `pdf_url` before its landing page). Their PDF's TEXT LAYER is read with the
 * pdfjs the API already has, one section per page, and the run checks it the
 * same way as a JATS text. No model reads an image here, and the PDF is not
 * kept: its sha256 is the source's content hash, the passages are short
 * verbatim quotes (plan J3).
 *
 * The URL comes from a third party's record, and the API runs next to the
 * fleet's own services, so (barracuda and acrobot, #1951):
 * - the URL is a public http(s) one (no address literal, no local name, no
 *   credentials, port 80 or 443), and so is every redirect, at most three;
 * - EVERY address the host resolves to is public, checked AT CONNECT TIME by
 *   the request's own lookup (`guardedFetch`): the connection opens on the
 *   address that was checked, so a name that answers public once and private
 *   the next time (DNS rebinding) gets no second resolution to slip through.
 *   Refused (`NOT_PUBLIC`, a BlockList): 0/8, 10/8, 100.64/10 (CGNAT, the
 *   tailnet), 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.168/16, 224/3,
 *   ::, ::1, 64:ff9b:1::/48, fc00::/7, fe80::/10, fec0::/10, ff00::/8, and
 *   any of the IPv4 ranges carried in an IPv6 address: mapped (dotted or
 *   hex), the old IPv4-compatible form, or NAT64 64:ff9b::/96;
 * - the body is counted WHILE it is read and the read stops past the cap
 *   (20 MB for the PDF, 512 KB for robots.txt), with or without a
 *   content-length;
 * - a landing page that names its PDF (`citation_pdf_url`) is followed to it
 *   once, through the same checks;
 * - the host's robots.txt is read first, its redirects followed (at most
 *   five, RFC 9309): a disallowed path is not fetched; an unreadable
 *   robots.txt is not taken as permission.
 */
export const MAX_PDF_BYTES = 20_000_000;
export const MAX_PDF_PAGES = 60;
export const MAX_PDF_REDIRECTS = 3;
export const PDF_TIMEOUT_MS = 30_000;
export const MAX_ROBOTS_BYTES = 512_000;
/** RFC 9309: a crawler follows at least five redirects of a robots.txt. */
export const MAX_ROBOTS_REDIRECTS = 5;
/** The product token our robots.txt reading looks for, next to `*`. */
export const RESEARCH_ROBOTS_TOKEN = "AcroporaOS-Research";
/** The guard's error code: the host resolved to an address that is not public. */
export const NOT_PUBLIC_ADDRESS = "NOT_PUBLIC_ADDRESS";

export type PdfFetch = (
  url: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
    redirect: "manual";
    signal: AbortSignal;
  },
) => Promise<Response>;

/** All addresses a host name resolves to. */
export type HostLookup = (host: string) => Promise<LookupAddress[]>;

export const systemLookup: HostLookup = (host) =>
  new Promise((resolve, reject) =>
    dnsLookup(host, { all: true, verbatim: true }, (error, addresses) =>
      error ? reject(error) : resolve(addresses),
    ),
  );

/**
 * The addresses a third party's link must not reach (barracuda and acrobot,
 * #1951). Node's BlockList also matches an IPv4-mapped IPv6 address (dotted
 * or hex, `::ffff:7f00:1`) against the IPv4 rules.
 */
const NOT_PUBLIC = new BlockList();
for (const [subnet, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT, the tailnet
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16],
  ["224.0.0.0", 3], // multicast and reserved, to 255.255.255.255
] as const)
  NOT_PUBLIC.addSubnet(subnet, prefix, "ipv4");
for (const [subnet, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b:1::", 48], // local-use NAT64
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // the deprecated site-local
  ["ff00::", 8], // multicast
] as const)
  NOT_PUBLIC.addSubnet(subnet, prefix, "ipv6");

/** An IPv6 address as its eight 16-bit groups, or null. */
function hextets(address: string): number[] | null {
  let text = address.toLowerCase();
  // a dotted IPv4 tail ("::ffff:1.2.3.4") as two groups
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(2).map(Number) as [
      number,
      number,
      number,
      number,
    ];
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const values = groups.map((g) => parseInt(g, 16));
  return values.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffff)
    ? values
    : null;
}

/**
 * The IPv4 address an IPv6 one carries in its last 32 bits, where the prefix
 * says it does: the old IPv4-compatible ::/96 and the NAT64 64:ff9b::/96.
 * (The IPv4-mapped ::ffff:0:0/96 is BlockList's own.)
 */
function embeddedIpv4(groups: number[]): string | null {
  const zeros = (from: number, to: number) =>
    groups.slice(from, to).every((g) => g === 0);
  const compatible = zeros(0, 6);
  const nat64 = groups[0] === 0x64 && groups[1] === 0xff9b && zeros(2, 6);
  if (!compatible && !nat64) return null;
  const [hi, lo] = [groups[6]!, groups[7]!];
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** A public unicast address, or not: private, local, shared and special ranges are not. */
export function publicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return !NOT_PUBLIC.check(address, "ipv4");
  if (kind !== 6) return false;
  if (NOT_PUBLIC.check(address, "ipv6")) return false;
  const groups = hextets(address);
  if (!groups) return false;
  const inner = embeddedIpv4(groups);
  return inner === null || !NOT_PUBLIC.check(inner, "ipv4");
}

/**
 * The request's own lookup: every address the name resolves to must be
 * public, or the connection is refused before it opens. The socket connects
 * to an address this function handed over, so nothing resolves twice.
 */
export function guardedLookup(
  resolve: HostLookup,
  isPublic: (address: string) => boolean = publicAddress,
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (!addresses.length)
          return callback(
            Object.assign(new Error(`no address for ${hostname}`), {
              code: "ENOTFOUND",
            }),
            "",
            4,
          );
        if (addresses.some((a) => !isPublic(a.address)))
          return callback(
            Object.assign(new Error(`${hostname}: not a public address`), {
              code: NOT_PUBLIC_ADDRESS,
            }),
            "",
            4,
          );
        if (options.all) return callback(null, addresses);
        return callback(null, addresses[0]!.address, addresses[0]!.family);
      },
      (error: NodeJS.ErrnoException) => callback(error, "", 4),
    );
  };
}

/**
 * The fetch the PDF path uses in production: node's http(s) with the guarded
 * lookup, no redirect followed (the caller checks each one), the body as a
 * stream the caller reads under its cap.
 */
export function guardedFetch(
  opts: {
    resolve?: HostLookup;
    isPublic?: (address: string) => boolean;
  } = {},
): PdfFetch {
  const lookup = guardedLookup(opts.resolve ?? systemLookup, opts.isPublic);
  return (url, init) =>
    new Promise<Response>((resolve, reject) => {
      const target = new URL(url);
      const client = target.protocol === "https:" ? https : http;
      const request = client.request(
        target,
        { method: "GET", headers: init.headers, lookup, signal: init.signal },
        (incoming) => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers))
            if (value !== undefined)
              headers.set(
                name,
                Array.isArray(value) ? value.join(", ") : value,
              );
          const status = incoming.statusCode ?? 0;
          const body =
            status === 204 || status === 304
              ? null
              : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
          if (!body) incoming.resume();
          resolve(new Response(body, { status, headers }));
        },
      );
      request.on("error", reject);
      request.end();
    });
}

/** The body, counted while it is read: null past `max`, and nothing read after that. */
export async function readCapped(
  response: Response,
  max: number,
): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  return bytes;
}

export type PdfAnswer =
  | { ok: true; bytes: Uint8Array; contentHash: string }
  | { ok: false; reason: string };

const LOCAL_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home"];

/** A public http(s) URL, or null: an address literal, a local name or an odd port is not one. */
export function publicHttpUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "80" && url.port !== "443") return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".")) return null;
  if (host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  if (LOCAL_SUFFIXES.some((s) => host.endsWith(s))) return null;
  return url;
}

/** Why a request did not answer: the address guard, a timeout, or the network. */
function failureOf(error: unknown): string {
  const e = error as {
    name?: string;
    code?: string;
    cause?: { code?: string };
  };
  if (e?.code === NOT_PUBLIC_ADDRESS || e?.cause?.code === NOT_PUBLIC_ADDRESS)
    return NOT_PUBLIC_ADDRESS;
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "TIMEOUT";
  return "NETWORK";
}

async function readRobots(
  target: URL,
  fetch: PdfFetch,
): Promise<RobotsRules | "UNREADABLE" | typeof NOT_PUBLIC_ADDRESS> {
  let url = new URL("/robots.txt", target);
  let response: Response;
  // RFC 9309 2.3.1.2: at least five redirects are followed, the last answer
  // counts (doi.org and hal.science redirect theirs; measured 2026-10-28,
  // acrobot 37413). Each step goes through the same address guard.
  for (let hops = 0; ; hops += 1) {
    try {
      response = await fetch(url.toString(), {
        method: "GET",
        headers: { "User-Agent": DISCOVERY_USER_AGENT, Accept: "text/plain" },
        redirect: "manual",
        signal: AbortSignal.timeout(PDF_TIMEOUT_MS),
      });
    } catch (error) {
      return failureOf(error) === NOT_PUBLIC_ADDRESS
        ? NOT_PUBLIC_ADDRESS
        : "UNREADABLE";
    }
    if (response.status < 300 || response.status >= 400) break;
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location || hops >= MAX_ROBOTS_REDIRECTS) return "UNREADABLE";
    const next = publicHttpUrl(new URL(location, url).toString());
    if (!next) return "UNREADABLE";
    url = next;
  }
  const status = response.status;
  // RFC 9309 would read a 401 or 403 as "no rules", but a site that closes even
  // its robots.txt to us most likely does not want us either, and the gain is
  // small: here it stays a refusal (acrobot 37414).
  if (status === 401 || status === 403) return DISALLOW_ALL;
  if (status === 429 || status >= 500) return "UNREADABLE";
  if (status >= 400) {
    await response.body?.cancel();
    return ALLOW_ALL;
  }
  const bytes = await readCapped(response, MAX_ROBOTS_BYTES);
  if (!bytes) return "UNREADABLE";
  return parseRobots(
    new TextDecoder("utf-8").decode(bytes),
    RESEARCH_ROBOTS_TOKEN,
  );
}

/**
 * The PDF a landing page names for itself: Highwire's `citation_pdf_url`
 * meta tag (HAL, OJS journals and most publishers carry it). Measured on the
 * stage's NOT_PDF sources (acrobot 37499): two HAL links and one doi.org
 * link resolve to a real PDF this way. Relative URLs are resolved against
 * the page; `&amp;` is the only entity a URL needs. Null when there is none.
 */
export function citationPdfUrl(html: Uint8Array, page: URL): string | null {
  const text = new TextDecoder("utf-8").decode(html);
  for (const tag of text.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\bname\s*=\s*["']citation_pdf_url["']/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!content) continue;
    try {
      return new URL(content.trim().replace(/&amp;/g, "&"), page).toString();
    } catch {
      return null;
    }
  }
  return null;
}

const isPdf = (bytes: Uint8Array) =>
  bytes.byteLength >= 5 &&
  new TextDecoder("latin1").decode(bytes.subarray(0, 5)) === "%PDF-";

/** The open PDF at `url`, or why not; each host's robots.txt read once. */
export async function fetchOpenPdf(
  url: string,
  fetch: PdfFetch = guardedFetch(),
): Promise<PdfAnswer> {
  let target = publicHttpUrl(url);
  if (!target) return { ok: false, reason: "NOT_PUBLIC_URL" };
  const robots = new Map<string, Awaited<ReturnType<typeof readRobots>>>();
  // a landing page's own PDF link is followed once, through the same checks
  let fromLanding = false;
  for (let hops = 0; ; hops += 1) {
    let rules = robots.get(target.host);
    if (!rules) {
      rules = await readRobots(target, fetch);
      robots.set(target.host, rules);
    }
    if (rules === NOT_PUBLIC_ADDRESS)
      return { ok: false, reason: NOT_PUBLIC_ADDRESS };
    if (rules === "UNREADABLE")
      return { ok: false, reason: "ROBOTS_UNREADABLE" };
    if (!robotsAllows(rules, target.pathname + target.search))
      return { ok: false, reason: "ROBOTS_DISALLOWED" };
    let response: Response;
    try {
      response = await fetch(target.toString(), {
        method: "GET",
        headers: {
          "User-Agent": DISCOVERY_USER_AGENT,
          Accept: "application/pdf",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(PDF_TIMEOUT_MS),
      });
    } catch (error) {
      return { ok: false, reason: failureOf(error) };
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || hops >= MAX_PDF_REDIRECTS)
        return { ok: false, reason: "TOO_MANY_REDIRECTS" };
      const next = publicHttpUrl(new URL(location, target).toString());
      if (!next) return { ok: false, reason: "NOT_PUBLIC_URL" };
      target = next;
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      return { ok: false, reason: `HTTP_${response.status}` };
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_PDF_BYTES) {
      await response.body?.cancel();
      return { ok: false, reason: "TOO_LARGE" };
    }
    const bytes = await readCapped(response, MAX_PDF_BYTES);
    if (!bytes) return { ok: false, reason: "TOO_LARGE" };
    // a landing page or a login wall is not a PDF, whatever its header says;
    // a landing page that names its PDF is followed to it, once
    if (!isPdf(bytes)) {
      const named = fromLanding ? null : citationPdfUrl(bytes, target);
      if (!named) return { ok: false, reason: "NOT_PDF" };
      const next = publicHttpUrl(named);
      if (!next) return { ok: false, reason: "NOT_PUBLIC_URL" };
      fromLanding = true;
      target = next;
      continue;
    }
    return {
      ok: true,
      bytes,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
    };
  }
}

/**
 * A word a PDF broke at a line end with a hyphen is joined back: "phos-" and
 * "phate" give "phosphate". Measured on stage (acrobot 37543, the refusal
 * detail of acropora-ai-agent #57): of nine refused passages of one PDF, seven
 * left the text where the source had the hyphen and the passage went on with
 * the word's next letter; the model writes the word whole. Only a lowercase
 * letter, a hyphen at the line's end and a lowercase letter starting the next
 * line: "Ca-" before "Mg" or "pH-" before "8" stay. A compound broken right at
 * its own hyphen ("phosphate-" / "limited") is joined too; that loss is the
 * price, and the verbatim check (unchanged) refuses such a passage as before.
 * The joined line goes on as one line; every other line break stays a newline.
 */
export function joinLineEndHyphens(lines: readonly string[]): string {
  const out: string[] = [];
  for (const line of lines) {
    const prev = out.at(-1);
    if (prev !== undefined && /\p{Ll}-$/u.test(prev) && /^\p{Ll}/u.test(line))
      out[out.length - 1] = prev.slice(0, -1) + line;
    else out.push(line);
  }
  return out.join("\n");
}

/** A heading line the references list starts with: from it on, nothing is read. */
const REFERENCES_HEADING =
  /^\s*(?:\d+\.?\s*)?(?:references|literature cited|bibliography|references and notes)\s*$/i;

export interface PdfSections {
  sections: TextSection[];
  /** Pages past `MAX_PDF_PAGES`, not read. */
  pagesDropped: number;
}

/**
 * The PDF's text layer, one section per page (`p. 3`), lines as pdfjs marks
 * them, the references list and what follows it left out. A scanned PDF has
 * no text layer and gives no section.
 */
export async function pdfSections(bytes: Uint8Array): Promise<PdfSections> {
  const task = getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    useSystemFonts: true,
  });
  const sections: TextSection[] = [];
  let pagesDropped = 0;
  try {
    const document = await task.promise;
    pagesDropped = Math.max(0, document.numPages - MAX_PDF_PAGES);
    const pages = Math.min(document.numPages, MAX_PDF_PAGES);
    for (let n = 1; n <= pages; n += 1) {
      const content = await (await document.getPage(n)).getTextContent();
      let line = "";
      const lines: string[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        } else if (item.str && !line.endsWith(" ")) line += " ";
      }
      if (line) lines.push(line);
      const cut = lines.findIndex((l) => REFERENCES_HEADING.test(l));
      const kept = (cut >= 0 ? lines.slice(0, cut) : lines)
        .map((l) => l.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const text = joinLineEndHyphens(kept);
      if (text)
        sections.push({ locator: `p. ${n}`.slice(0, MAX_LOCATOR), text });
      if (cut >= 0) break;
    }
  } finally {
    await task.destroy();
  }
  return { sections, pagesDropped };
}
