import { createHash } from "node:crypto";

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
 * The URL comes from a third party's record, so it is held to a public
 * http(s) host (no address literal, no local name, no credentials, no odd
 * port), every redirect is checked again, at most three are followed, and
 * the host's robots.txt is read first (a disallowed path is not fetched; an
 * unreadable robots.txt is not guessed at).
 */
export const MAX_PDF_BYTES = 20_000_000;
export const MAX_PDF_PAGES = 60;
export const MAX_PDF_REDIRECTS = 3;
export const PDF_TIMEOUT_MS = 30_000;
export const MAX_ROBOTS_BYTES = 512_000;
/** The product token our robots.txt reading looks for, next to `*`. */
export const RESEARCH_ROBOTS_TOKEN = "AcroporaOS-Research";

export type PdfFetch = (
  url: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
    redirect: "manual";
    signal: AbortSignal;
  },
) => Promise<Response>;

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

async function readRobots(
  target: URL,
  fetch: PdfFetch,
): Promise<RobotsRules | "UNREADABLE"> {
  let response: Response;
  try {
    response = await fetch(new URL("/robots.txt", target).toString(), {
      method: "GET",
      headers: { "User-Agent": DISCOVERY_USER_AGENT, Accept: "text/plain" },
      redirect: "manual",
      signal: AbortSignal.timeout(PDF_TIMEOUT_MS),
    });
  } catch {
    return "UNREADABLE";
  }
  const status = response.status;
  // a robots.txt that redirects is not followed: the host's rule is not guessed
  if (status >= 300 && status < 400) return "UNREADABLE";
  if (status === 401 || status === 403) return DISALLOW_ALL;
  if (status === 429 || status >= 500) return "UNREADABLE";
  if (status >= 400) return ALLOW_ALL;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ROBOTS_BYTES) return "UNREADABLE";
  return parseRobots(
    new TextDecoder("utf-8").decode(bytes),
    RESEARCH_ROBOTS_TOKEN,
  );
}

const isPdf = (bytes: Uint8Array) =>
  bytes.byteLength >= 5 &&
  new TextDecoder("latin1").decode(bytes.subarray(0, 5)) === "%PDF-";

/** The open PDF at `url`, or why not; each host's robots.txt read once. */
export async function fetchOpenPdf(
  url: string,
  fetch: PdfFetch,
): Promise<PdfAnswer> {
  let target = publicHttpUrl(url);
  if (!target) return { ok: false, reason: "NOT_PUBLIC_URL" };
  const robots = new Map<string, RobotsRules | "UNREADABLE">();
  for (let hops = 0; ; hops += 1) {
    let rules = robots.get(target.host);
    if (!rules) {
      rules = await readRobots(target, fetch);
      robots.set(target.host, rules);
    }
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
      return {
        ok: false,
        reason:
          (error as Error)?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK",
      };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || hops >= MAX_PDF_REDIRECTS)
        return { ok: false, reason: "TOO_MANY_REDIRECTS" };
      const next = publicHttpUrl(new URL(location, target).toString());
      if (!next) return { ok: false, reason: "NOT_PUBLIC_URL" };
      target = next;
      continue;
    }
    if (response.status !== 200)
      return { ok: false, reason: `HTTP_${response.status}` };
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_PDF_BYTES) return { ok: false, reason: "TOO_LARGE" };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_PDF_BYTES)
      return { ok: false, reason: "TOO_LARGE" };
    // a landing page or a login wall is not a PDF, whatever its header says
    if (!isPdf(bytes)) return { ok: false, reason: "NOT_PDF" };
    return {
      ok: true,
      bytes,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
    };
  }
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
      const text = kept.join("\n");
      if (text)
        sections.push({ locator: `p. ${n}`.slice(0, MAX_LOCATOR), text });
      if (cut >= 0) break;
    }
  } finally {
    await task.destroy();
  }
  return { sections, pagesDropped };
}
