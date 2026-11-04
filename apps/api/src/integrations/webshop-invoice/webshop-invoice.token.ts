import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A VENDÉG SZÁMLA-LETÖLTÉSÉNEK ALÁÍRÁSAI (V1.1; tiszta függvények, a titkot a hívó adja).
 *
 * KÉT ALÁÍRÁS, KÉT KULCS EGY TITOKBÓL (tartománykülönítés): a kulcsok a titokból `HMAC(titok, "<cél>")`-val származnak, tehát
 * egy letöltő token soha nem érvényes kérés-aláírásnak, és fordítva, akkor sem, ha a két üzenet egyébként megegyezne.
 *
 *  - KÉRÉS-ALÁÍRÁS (a commerce szerver kéri a hivatkozást): `link-v1|<rendelés>|<ts>`, a ts egész másodperc, és legfeljebb
 *    `LINK_REQUEST_WINDOW_SECONDS` távol lehet a mától. A kérés a rendelés azonosítójára szól, mást nem tartalmaz.
 *  - LETÖLTŐ TOKEN (a vendég böngészője hozza): `<payload>.<aláírás>`, a payload base64url JSON
 *    `{v:1, o:<rendelés>, i:<számla>, j:<jti>, e:<lejárat, egész másodperc>}`. Egyetlen számlára szól, legfeljebb
 *    `DOWNLOAD_TOKEN_MAX_SECONDS` ideig él.
 *
 * Az összehasonlítás állandó idejű. Minden hiba UGYANAZ a `null`/`false`: a hívó nem tudja megkülönböztetni a rossz
 * aláírást, a lejártat és az értelmezhetetlen tokent.
 */
export const LINK_REQUEST_WINDOW_SECONDS = 60;
export const DOWNLOAD_TOKEN_MAX_SECONDS = 15 * 60;
export const SECRET_MIN_LENGTH = 32;

export interface DownloadClaims {
  orderId: string;
  invoiceId: string;
  jti: string;
  /** lejárat, egész másodperc (unix) */
  exp: number;
}

const keyFor = (secret: string, purpose: string): Buffer =>
  createHmac("sha256", secret).update(purpose).digest();

const sign = (key: Buffer, message: string): Buffer =>
  createHmac("sha256", key).update(message).digest();

const b64 = (value: Buffer | string): string =>
  Buffer.from(value).toString("base64url");

function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signLinkRequest(
  secret: string,
  orderId: string,
  ts: number,
): string {
  return b64(
    sign(keyFor(secret, "webshop-invoice/link-v1"), `link-v1|${orderId}|${ts}`),
  );
}

export function verifyLinkRequest(
  secret: string,
  request: { orderId: unknown; ts: unknown; sig: unknown },
  nowSeconds: number,
): boolean {
  const { orderId, ts, sig } = request;
  if (
    typeof orderId !== "string" ||
    orderId === "" ||
    orderId.length > 64 ||
    typeof ts !== "number" ||
    !Number.isSafeInteger(ts) ||
    typeof sig !== "string" ||
    sig.length > 128
  )
    return false;
  if (Math.abs(nowSeconds - ts) > LINK_REQUEST_WINDOW_SECONDS) return false;
  return sameBytes(
    Buffer.from(sig, "base64url"),
    sign(keyFor(secret, "webshop-invoice/link-v1"), `link-v1|${orderId}|${ts}`),
  );
}

export function mintDownloadToken(
  secret: string,
  claims: DownloadClaims,
): string {
  const payload = b64(
    JSON.stringify({
      v: 1,
      o: claims.orderId,
      i: claims.invoiceId,
      j: claims.jti,
      e: claims.exp,
    }),
  );
  const signature = b64(
    sign(keyFor(secret, "webshop-invoice/download-v1"), payload),
  );
  return `${payload}.${signature}`;
}

export function verifyDownloadToken(
  secret: string,
  token: unknown,
  nowSeconds: number,
): DownloadClaims | null {
  if (typeof token !== "string" || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts as [string, string];
  const expected = sign(keyFor(secret, "webshop-invoice/download-v1"), payload);
  if (!sameBytes(Buffer.from(signature, "base64url"), expected)) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof decoded !== "object" || decoded === null) return null;
  const { v, o, i, j, e } = decoded as Record<string, unknown>;
  if (
    v !== 1 ||
    typeof o !== "string" ||
    typeof i !== "string" ||
    typeof j !== "string" ||
    typeof e !== "number" ||
    !Number.isSafeInteger(e) ||
    o === "" ||
    i === "" ||
    j === "" ||
    j.length > 64
  )
    return null;
  if (e <= nowSeconds) return null;
  // egy hosszabb életű tokent akkor sem fogadunk el, ha az aláírása jó (a lejárat felső korlátja a szabály része)
  if (e - nowSeconds > DOWNLOAD_TOKEN_MAX_SECONDS) return null;
  return { orderId: o, invoiceId: i, jti: j, exp: e };
}
