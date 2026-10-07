/**
 * AZ ÁTIRÁNYÍTÁS ÚTJA (SEO P0 PR 6, C5). Egy függvény, a forrásnál és a
 * kiszolgálásnál (PR 7) ugyanaz, különben egy régi cím az egyik oldalon talál, a
 * másikon nem.
 *
 * - teljes URL-ből csak az út marad (a domain nem része a szabálynak);
 * - a query és a horgony elmarad: a mért régi címek között nincs query-alapú (0/1901);
 * - percent-dekódolt, NFC (egy `%C3%A1` és egy szétbontott `á` ugyanaz az út);
 * - záró `/` nélkül, a gyökér `/` marad;
 * - a kis- és nagybetű MEGMARAD a tárolt alakban (1886 nagybetűs régi cím); a
 *   keresés a `redirectPathLower` alakon fut (D2).
 *
 * A perjeles UNAS-SefUrl (107) egy útként marad: csak a záró `/` megy le.
 */
export function normalizeRedirectPath(input: string): string | null {
  let ut = input.trim();
  if (!ut) return null;
  ut = ut.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "");
  ut = ut.split(/[?#]/, 1)[0] ?? "";
  try {
    ut = decodeURIComponent(ut);
  } catch {
    // egy hibás percent-kód (`%E0%A4%A`) nyersen marad: nem dobunk el egy régi címet
  }
  ut = ut.normalize("NFC");
  if (/[\s\u0000-\u001f\u007f]/.test(ut)) return null;
  if (!ut.startsWith("/")) ut = `/${ut}`;
  while (ut.length > 1 && ut.endsWith("/")) ut = ut.slice(0, -1);
  return ut;
}

/** A kisbetűs keresés kulcsa (D2): a `sourcePathLower` oszlop értéke. */
export function redirectPathLower(path: string): string {
  return path.toLowerCase();
}

/** A termék webshop-címe (G2): `/hu/termek/{slug}`. */
export function webshopProductPath(slug: string): string {
  return `/hu/termek/${slug}`;
}
