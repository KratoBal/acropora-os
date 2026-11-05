import { SECRET_MIN_LENGTH } from "./webshop-invoice.token.js";

/**
 * A VENDÉG SZÁMLA-LETÖLTÉS BEÁLLÍTÁSA. Titok nélkül (vagy túl rövid titokkal) mindkét végpont 404-et ad: a hiányzó beállítás
 * sosem jelent "bárki hívhatja".
 *
 *  - `WEBSHOP_INVOICE_SECRET`: a commerce szerverrel KÖZÖS titok (legalább 32 karakter), kizárólag a két szerveren él.
 *  - `WEBSHOP_INVOICE_PUBLIC_BASE_URL`: az OS publikus API-címe, amire a vendég böngészője a letöltő hivatkozást kapja.
 */
export const WEBSHOP_INVOICE_SECRET_ENV = "WEBSHOP_INVOICE_SECRET";
export const WEBSHOP_INVOICE_PUBLIC_BASE_URL_ENV =
  "WEBSHOP_INVOICE_PUBLIC_BASE_URL";
export const WEBSHOP_INVOICE_ENVIRONMENT = Symbol(
  "WEBSHOP_INVOICE_ENVIRONMENT",
);

export function webshopInvoiceSecret(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = env[WEBSHOP_INVOICE_SECRET_ENV]?.trim();
  return value && value.length >= SECRET_MIN_LENGTH ? value : null;
}

/** A publikus alap-cím, záró perjel nélkül; hiányzó vagy értelmezhetetlen: `null`. */
export function webshopInvoicePublicBase(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env[WEBSHOP_INVOICE_PUBLIC_BASE_URL_ENV]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.search || url.hash) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}
