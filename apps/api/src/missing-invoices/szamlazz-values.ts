/**
 * A SZÁMLÁZZ.HU ÜZENETEK KÉT MEZŐJE, AMIT AZ XSD LAZÁBBAN KÖT, MINT AHOGY
 * ELŐSZÖR OLVASTUK (acrobot 25807, éles hiba 2026-10-01 15:00:47 és 15:00:48 UTC:
 * két bejövő számla „a devizanem nem háromjegyű kód” miatt 400-at kapott, tehát a
 * Számlázz.hu 72 órán át újraküldi, és a tartósan hibát adó fogadót
 * inaktiválhatja).
 *
 *   devizanem  az XSD-ben `string` (szamlabe.xsd 139., szamla.xsd 140.,
 *              banktranz.xsd 29. sor), nem háromjegyű kód. A Számlázz.hu a
 *              forintot gyakran „Ft”-ként írja.
 *   kelt, erteknap
 *              `xs:date`, ami időzóna-utótagot is megenged
 *              (`2026-10-01+02:00`, `2026-10-01Z`).
 *
 * A SZABÁLY: amit az XSD megenged, az egész üzenetet nem buktathatja el. Egy
 * ismeretlen pénznem-szöveg nyersen tárolódik (a párosító egyszerűen nem talál
 * hozzá terhelést, és ez látszik); csak a valóban hibás üzenet kap 400-at.
 */

/**
 * A pénznem a párosító alakjában: a forint minden ismert írásmódja HUF, egy
 * háromjegyű kód nagybetűsen, bármi más nyersen (levágott szóközzel).
 */
export function szamlazzCurrency(raw: string): string {
  const value = raw.trim();
  const folded = value.toUpperCase().replace(/\.$/, "");
  if (folded === "FT" || folded === "HUF" || folded === "FORINT") return "HUF";
  if (/^[A-Z]{3}$/.test(folded)) return folded;
  return value;
}

const XS_DATE = /^(\d{4}-\d{2}-\d{2})(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Egy `xs:date` napja (ÉÉÉÉ-HH-NN), az időzóna-utótag nélkül; `null`, ha nem
 * dátum. A nap a kiállító naptári napja: az utótag ezen nem változtat.
 */
export function xsDateDay(raw: string): string | null {
  const match = XS_DATE.exec(raw.trim());
  if (!match) return null;
  const day = match[1]!;
  const parsed = new Date(`${day}T00:00:00Z`);
  // a Date a 02-31-et is elfogadná (március 3.): a nap visszaolvasása dönt
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === day ? day : null;
}
