import { DISCOVERY_USER_AGENT } from "../discovery/scholarly-client.js";
import type { TextFetch } from "./extraction-run.js";
import { readCapped } from "./pdf-full-text.js";

/**
 * A FIGURE'S IMAGE FROM THE PMC OPEN-ACCESS DATASET (research-kepes-ut).
 *
 * The PMC Article Datasets on AWS (`pmc-oa-opendata`, NCBI's own route for
 * programmatic reading of the open-access subset) hold each article's files
 * under `<PMCID>.<version>/`, the figures by the names the JATS gives them.
 * Measured 2026-10-31: all 18 phosphate figures of the stage sources are
 * there; the PMC website's own image links answered a node client with a
 * bot page (200, text/html), so they are not the route.
 *
 * The host is fixed here, never taken from a record, so the general fetch is
 * enough (the address guard of `pdf-full-text.ts` is for third-party links).
 * The listing and the image are read with a cap while reading; the image must
 * be a PNG or a JPEG by its bytes: the tiling decodes it, and fewer formats
 * are fewer decoders to trust (barracuda, #1978 review).
 */
export const PMC_OA_BUCKET = "https://pmc-oa-opendata.s3.amazonaws.com";
export const MAX_LISTING_BYTES = 512_000;
export const MAX_FIGURE_BYTES = 12_000_000;
export const FIGURE_TIMEOUT_MS = 30_000;

export type FigureImageAnswer =
  { ok: true; bytes: Uint8Array; key: string } | { ok: false; reason: string };

const PMCID = /^PMC\d{1,10}$/;
const NAME = /^[\w.-]{1,128}$/;

const isPngOrJpeg = (b: Uint8Array) =>
  (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ||
  (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff);

async function get(
  url: string,
  fetch: TextFetch,
  max: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": DISCOVERY_USER_AGENT },
      signal: AbortSignal.timeout(FIGURE_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      reason: (error as Error)?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK",
    };
  }
  if (response.status !== 200)
    return { ok: false, reason: `HTTP_${response.status}` };
  if (Number(response.headers.get("content-length") ?? "0") > max)
    return { ok: false, reason: "TOO_LARGE" };
  const bytes = await readCapped(response, max);
  return bytes ? { ok: true, bytes } : { ok: false, reason: "TOO_LARGE" };
}

/** The newest version's key for `name` ("PMC8902694.1/fiac013fig1.jpg"), or null. */
export function figureKey(
  listing: string,
  pmcid: string,
  name: string,
): string | null {
  const keys = [...listing.matchAll(/<Key>([^<]{1,300})<\/Key>/g)].map(
    (m) => m[1]!,
  );
  const candidates = /\.\w{2,4}$/.test(name)
    ? [name]
    : [`${name}.jpg`, `${name}.png`];
  let best: { key: string; version: number } | null = null;
  for (const key of keys) {
    const m = /^(PMC\d+)\.(\d+)\/([^/]+)$/.exec(key);
    if (!m || m[1] !== pmcid || !candidates.includes(m[3]!)) continue;
    const version = Number(m[2]);
    if (!best || version > best.version) best = { key, version };
  }
  return best?.key ?? null;
}

export async function fetchPmcFigureImage(
  pmcid: string,
  href: string,
  fetch: TextFetch,
): Promise<FigureImageAnswer> {
  if (!PMCID.test(pmcid) || !NAME.test(href))
    return { ok: false, reason: "BAD_NAME" };
  const listing = await get(
    `${PMC_OA_BUCKET}/?list-type=2&prefix=${encodeURIComponent(`${pmcid}.`)}&max-keys=500`,
    fetch,
    MAX_LISTING_BYTES,
  );
  if (!listing.ok) return listing;
  const key = figureKey(new TextDecoder().decode(listing.bytes), pmcid, href);
  if (!key) return { ok: false, reason: "NOT_IN_DATASET" };
  const image = await get(
    `${PMC_OA_BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`,
    fetch,
    MAX_FIGURE_BYTES,
  );
  if (!image.ok) return image;
  if (!isPngOrJpeg(image.bytes))
    return { ok: false, reason: "NOT_PNG_OR_JPEG" };
  return { ok: true, bytes: image.bytes, key };
}
