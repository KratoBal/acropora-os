import type { ExtractedValue } from "./page-extract.js";

/**
 * THE PACK SIZE, CONFIRMED ON THE MANUFACTURER'S PAGE (T4.4 S1a, card 8639ac2a, task t-20261114-jev-s1-szovegolvaso).
 *
 * The S1 gate needs `packSize` (or `volume`), and the pilot-20 run had it MISSING on 20 of 20 products: the
 * manufacturers' pages carry no schema.org Product, so `page-extract.ts` reads no `size`. This reader does NOT read a
 * size off the page. It takes OUR size, the one the product's own name states (`nameSize`), and looks for that same size
 * where the page names ITS product: the <title>, the <h1>, or a variant selector (an <option>, or an element whose class
 * names a swatch). Found there, the page agrees with us, and the reconciler decides as for any other field.
 *
 * WHY NOT THE PAGE'S OWN SIZE (measured on the pilot's 15 readable pages, 2026-11-14): the title or h1 held a size on 3
 * pages, and one of them was wrong for our product (Korallen-Zucht Amino Acid High Concentrate: the page title says
 * 10 ml, our product is the 100 ml); the pages list 0 to 11 sizes each, a family page all of them.
 *
 * WHY NOT ANYWHERE IN THE TEXT (same measurement): on the Modern Reef pages our 100 ml stands in the title and the h1,
 * and also in the related products' links (`woocommerce-LoopProduct-link`). A size in a related product's link is that
 * product's size, not ours; free text, links and attributes therefore never confirm.
 */

const SIZE = /(?<![\d.,])(\d+(?:[.,]\d+)?)\s?(ml|l|g|kg)\b/gi;

export interface NameSize {
  /** As the reconciler compares it: the amount with a dot, a space, the unit in lower case ("100 ml", "0.5 l"). */
  raw: string;
  /** A pattern for the same size on a page: "100ml", "100 ml", "0,5 l" alike. */
  pattern: RegExp;
}

/**
 * The one size the product's name states, or null: no size, two different sizes (a set, "250 ml + 100 ml"), or a
 * multipack ("3x5000ml", "2 x 100 ml"), where the name's size is not the pack's.
 */
export function nameSize(name: string): NameSize | null {
  if (/\d\s*[x×]\s*\d/i.test(name)) return null;
  const sizes = new Map<string, { amount: string; unit: string }>();
  for (const m of name.matchAll(SIZE)) {
    const amount = m[1]!.replace(",", ".");
    const unit = m[2]!.toLowerCase();
    sizes.set(`${amount} ${unit}`, { amount, unit });
  }
  if (sizes.size !== 1) return null;
  const [raw, { amount, unit }] = [...sizes][0]!;
  const number = amount.replace(".", "[.,]");
  return {
    raw,
    pattern: new RegExp(`(?<![\\d.,])${number}\\s?${unit}\\b`, "i"),
  };
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

/** The places where a page names its own product, in order: the title, the h1, the variant selector. */
function ownProductTexts(html: string): string[] {
  const clean = html.replace(
    /<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi,
    " ",
  );
  const out: string[] = [];
  for (const m of clean.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi))
    out.push(text(m[1]!));
  for (const m of clean.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi))
    out.push(text(m[1]!));
  for (const m of clean.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi))
    out.push(text(m[1]!));
  // an element whose class names a swatch (a variant button; "shopengine_swatch" on the Aquaforest pages, so no word
  // boundary before it), up to its own closing tag
  for (const m of clean.matchAll(
    /<(span|div|li|button|a)\b[^>]*\bclass\s*=\s*["'][^"']*swatch[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi,
  ))
    out.push(text(m[2]!));
  return out.filter((t) => t !== "");
}

/**
 * The page's agreement with our name's size, as a `packSize` value with the place it stands as the excerpt; null when
 * the page does not name that size for its own product.
 */
export function confirmPackSize(
  html: string,
  size: NameSize,
): ExtractedValue | null {
  const where = ownProductTexts(html).find((t) => size.pattern.test(t));
  if (!where) return null;
  return {
    field: "packSize",
    raw: size.raw,
    excerpt: where.slice(0, 200),
  };
}
