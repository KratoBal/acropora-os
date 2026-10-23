import { moneyValues } from "./invoice-text.js";

/**
 * A SZÁM EGYEDÜL NEM KÖT (kártya 285d8ffc, barracuda 35534 a #1826 átnézésén).
 * A gyűjtő egy PDF-et egy bejövő számlához köt, ha a szövegében egy ISMERT számla
 * száma áll (a NAV-sorokból, a Számlázz.hu feedből, a rögzített beszerzésekből),
 * de a szám nyilvános adat: aki ismeri, a számlához illő számmal rossz PDF-et
 * küldhet, és az a könyvelői csomagba kerülhet. A kötéshez ezért a szám mellé egy
 * MÁSODIK, a számlasorból jövő jel is kell:
 *
 *   - AMOUNT: az ismert számla bruttó összege pénzösszegként áll a szövegben;
 *   - NAME: az ismert szállítónév jellemző szava önálló szóként áll a szövegben;
 *   - SENDER: a feladó címének tartománya tartalmazza a szállítónév jellemző szavát
 *     (gumiprofi.hu ~ "Gumi-Profi Team Kft.").
 *
 * Egyik sem: a fájl NEM köt (a szám elesik), ember hozzárendeli (UNASSIGNED).
 * A jel NEM hitelesít: aki a szállító nevét és a számát is tudja, a nevet a
 * szövegbe írhatja. A küszöböt emeli, nem zárja; ezt a PR kimondja.
 */
export interface KnownInvoiceFacts {
  /** Az ismert számla bruttó összege centben (több forrás, több érték is lehet). */
  grossCents: readonly number[];
  /** Az ismert számla szállítójának nevei (NAV, feed, beszerzés). */
  supplierNames: readonly string[];
}

export type Corroboration = "AMOUNT" | "NAME" | "SENDER";

export interface CorroborationHooks {
  normalizeName: (name: string) => string;
}

/**
 * ÁLTALÁNOS SZAVAK, AMELYEK NEM AZONOSÍTANAK EGY SZÁLLÍTÓT (barracuda 35766): a
 * "Magyar Telekom" jellemző szava "magyar", a "Global Trade"-é "global", és ezek
 * szinte minden magyar, illetve nemzetközi számla szövegében önálló szóként
 * állnak, tehát a név-jel magától teljesülne. A lista ítélet, nem mérés: rövid
 * és szándékosan szűk, bővíthető, ha egy valódi szállítónál kiderül, hogy a
 * jel magától teljesül.
 */
const GENERIC_SIGN_WORDS = new Set([
  "magyar",
  "magyarorszag",
  "hungary",
  "global",
  "trade",
  "trading",
  "service",
  "services",
  "team",
  "group",
  "system",
  "systems",
  "solutions",
  "europe",
  "european",
  "euro",
  "center",
  "centre",
  "partner",
  "partners",
  "holding",
  "consulting",
  "logistics",
  "szolgaltato",
  "szolgáltató",
  "ipari",
  "kozponti",
  "központi",
]);

/**
 * A SZÁLLÍTÓNÉV JELLEMZŐ SZAVAI: a normalizált név legalább négybetűs szavai az
 * általános szavak nélkül, legfeljebb az első kettő. A név-jelhez MINDEGYIK kell
 * (a "Gumi Profi" egy "gumi" szóra nem elég), a feladó-jelhez az első.
 */
export function nameSigns(
  name: string,
  normalizeName: (name: string) => string,
): string[] {
  return normalizeName(name)
    .split(" ")
    .filter((word) => word.length >= 4 && !GENERIC_SIGN_WORDS.has(word))
    .slice(0, 2);
}

/** A feladó címének tartománya betűkre-számjegyekre szűrve ("A <a@gumi-profi.hu>" -> "gumiprofihu"). */
export function senderDomain(sender: string | null | undefined): string | null {
  const address = /<([^>]+)>/.exec(sender ?? "")?.[1] ?? sender ?? "";
  const domain = address.split("@")[1]?.trim().toLowerCase();
  return domain ? domain.replace(/[^\p{L}\p{N}]/gu, "") : null;
}

export function corroboratedBy(
  lines: readonly string[],
  facts: KnownInvoiceFacts,
  sender: string | null | undefined,
  hooks: CorroborationHooks,
): Corroboration | null {
  const text = lines.join("\n");
  const values = moneyValues(text);
  if (facts.grossCents.some((cents) => cents > 0 && values.has(cents)))
    return "AMOUNT";
  const words = new Set(hooks.normalizeName(text).split(" "));
  const signs = facts.supplierNames
    .map((name) => nameSigns(name, hooks.normalizeName))
    .filter((words) => words.length > 0);
  if (signs.some((needed) => needed.every((word) => words.has(word))))
    return "NAME";
  const domain = senderDomain(sender);
  if (domain && signs.some((needed) => domain.includes(needed[0]!)))
    return "SENDER";
  return null;
}
