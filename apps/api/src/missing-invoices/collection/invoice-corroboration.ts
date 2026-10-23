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
  /** A név jellemző szava (a normalizált név első, legalább négybetűs szava). */
  distinctiveWord: (name: string) => string | null;
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
  const distinctive = facts.supplierNames
    .map((name) => hooks.distinctiveWord(name))
    .filter((word): word is string => word !== null);
  if (distinctive.some((word) => words.has(word))) return "NAME";
  const domain = senderDomain(sender);
  if (domain && distinctive.some((word) => domain.includes(word)))
    return "SENDER";
  return null;
}
