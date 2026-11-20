/**
 * A SZÁLLÍTÓ BANKSZÁMLASZÁMA A SZÁMLA PDF-JÉNEK SZÖVEGÉBŐL (acrobot 58396, 58428; task os-lejaro-bankszamla-potlas-20261120).
 * TISZTA FÜGGVÉNY: a `pdfTextLines` soraiból (a cellák " | "-tal elválasztva) olvas, adatbázishoz és fájlhoz nem nyúl.
 *
 * MIÉRT PDF: a Lejáró számlák 63 sorából 56-nál sem a feed, sem a NAV, sem a korábbi terhelés nem ad számlaszámot (acrobot mérése,
 * 2026-11-20), a begyűjtött PDF viszont 35 sornál megvan, és a számlaszám szinte mindig ott áll.
 *
 * NEM TALÁLGAT. Egy szám csak akkor jelölt, ha MINDHÁROM igaz:
 *   1. ALAKJA számlaszám: magyar 8-8 vagy 8-8-8 számjegyű, vagy a saját országa hosszával megegyező IBAN;
 *   2. ELLENŐRZŐ ÖSSZEGE érvényes: a hazai szám első 8 jegye önmagában, a második része (8 vagy 16 jegy) EGYBEN 9-7-3-1 súlyozású, 10-zel osztható
 *      (`hungarianPartValid`); egy 8-8-8 alakú találat vagy teljes egészében érvényes, vagy NEM jelölt (soha nem csonkul 16 jegyűre); az IBAN mod 97 szerint 1.
 *      Egy tetszőleges 16 jegyű szám (számlaszám, rendelésszám, vonalkód) 1% eséllyel megy át, ezért ez NEM elég önmagában;
 *   3. CÍMKE áll mellette, ugyanabban a sorban vagy az előzőben (a táblázatos számlán a címke a cella fölött áll): bankszámla, IBAN,
 *      bank account, Kontonummer, Bankverbindung. A „számlaszám” címke ÖNMAGÁBAN gyengébb (a számla száma is „számlaszám”), ezért
 *      azzal csak a tagolt alak (kötőjel vagy szóköz a blokkok között) fogadható el, a tagolatlan 16 jegyű nem.
 * A saját bankszámláink (`ownAccounts`, számjegyek) kiesnek: azok a vevő, nem a szállító számlaszámai.
 *
 * KIMENET: a KÜLÖNBÖZŐ (normalizált) jelöltek. A hívó dönt: egy jelölt = kitölthető, több = „nincs adat, N jelölt” (a két devizaszámla
 * közül nem választunk), nulla = nincs adat. A normalizálás megegyezik a Hiányzó számlák `normalizeAccount`-jával (a spec őrzi).
 */

export type SupplierAccountKind = "HU_ACCOUNT" | "IBAN";

export interface SupplierAccountCandidate {
  /** összevethető alak: a hazai 8-8(-8) számjegyei (a 24 jegyű, 8 nullára végződő a 16 jegyű), az IBAN szóköz nélkül, nagybetűvel */
  readonly account: string;
  readonly kind: SupplierAccountKind;
  /** a címke, amelyik mellett állt (`BANK` a bank-címke, `GENERIC` a „számlaszám”) */
  readonly label: "BANK" | "GENERIC";
  /** az oldalvég-jelek nélkül számolt sor sorszáma, 0-tól (a hibakereséshez) */
  readonly line: number;
}

const WEIGHTS = [9, 7, 3, 1] as const;

/**
 * A HAZAI (GIRO) SZÁMLASZÁM RÉSZEINEK ELLENŐRZÉSE (barracuda, #2791 review). A szám két részből áll: az ELSŐ 8 jegy (pénzforgalmi jelzőszám) ellenőrző jeggyel, önmagában;
 * a MÁSODIK RÉSZ 8 vagy 16 jegy, EGYBEN ellenőrzött: a 9-7-3-1 súlyok a teljes részen végigfutnak (négyesével ismétlődnek), az utolsó jegy az ellenőrző jegy. Tehát
 * a 8-8-8 alak 2. és 3. blokkja akkor érvényes, ha a két blokk súlyozott összegének ÖSSZEGE osztható 10-zel, nem külön-külön.
 * Ez a függvény egy 8 vagy 16 jegyű részre mond igent vagy nemet.
 */
export function hungarianPartValid(part: string): boolean {
  if (!/^(?:\d{8}|\d{16})$/.test(part)) return false;
  let sum = 0;
  for (let index = 0; index < part.length; index += 1)
    sum += Number(part[index]) * WEIGHTS[index % 4]!;
  return sum % 10 === 0;
}

/** Az IBAN hossza országonként (a nem listázott ország nem jelölt: nem találgatunk). */
const IBAN_LENGTH: Readonly<Record<string, number>> = {
  AT: 20,
  BE: 16,
  BG: 22,
  CH: 21,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  EE: 20,
  ES: 24,
  FI: 18,
  FR: 27,
  GB: 22,
  GR: 27,
  HR: 21,
  HU: 28,
  IE: 22,
  IT: 27,
  LT: 20,
  LU: 20,
  LV: 21,
  MT: 31,
  NL: 18,
  NO: 15,
  PL: 28,
  PT: 25,
  RO: 24,
  SE: 24,
  SI: 19,
  SK: 24,
};

/** ISO 13616 mod 97 (a számjegyekre bontott maradékkal, nagy szám nélkül). */
export function ibanValid(compact: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  if (IBAN_LENGTH[compact.slice(0, 2)] !== compact.length) return false;
  const rotated = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const char of rotated) {
    const digits =
      char >= "A" && char <= "Z" ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits)
      remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** Ugyanaz a normalizálás, mint a Hiányzó számlák `normalizeAccount`-jában (a spec egyezteti). */
export function normalizeSupplierAccount(value: string): string {
  let text = value.replace(/[\s-]/g, "").toUpperCase();
  if (/^HU\d{26}$/.test(text)) text = text.slice(4);
  if (/^\d{24}$/.test(text) && text.endsWith("00000000"))
    text = text.slice(0, 16);
  return text;
}

const fold = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** A bank-címkék (ékezet nélkül, kisbetűvel): a számla száma ezekkel NEM keverhető össze. */
const BANK_LABEL =
  /bank ?szamla|bank ?account|\biban\b|kontonummer|bankverbindung|bank details|bank detail|rekeningnummer|numero de compte/;
/** A „számlaszám” önmagában: a számla száma is ez, tehát csak a tagolt alakot engedi. */
const GENERIC_LABEL = /szamla ?szam|account (?:no|number)|konto\b/;

const HU_ACCOUNT_PATTERN =
  /(?<!\d)(\d{8})([- ]?)(\d{8})(?:([- ]?)(\d{8}))?(?!\d)/g;
const IBAN_PATTERN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{2,4}){3,8}\b/g;

function labelOf(
  folded: readonly string[],
  index: number,
): "BANK" | "GENERIC" | null {
  const near = [folded[index], index > 0 ? folded[index - 1] : ""].join(" | ");
  if (BANK_LABEL.test(near)) return "BANK";
  if (GENERIC_LABEL.test(near)) return "GENERIC";
  return null;
}

export function supplierAccountCandidates(
  lines: readonly string[],
  ownAccounts: readonly string[] = [],
): SupplierAccountCandidate[] {
  // az oldalvég-jel sor MARAD (címkét és számot nem hordoz): így az előző oldal utolsó sora nem lehet a következő oldal első sorának „előző sora”
  const text = lines;
  const folded = text.map(fold);
  const own = new Set(
    ownAccounts.map((account) => normalizeSupplierAccount(account)),
  );
  const found = new Map<string, SupplierAccountCandidate>();
  const keep = (candidate: SupplierAccountCandidate) => {
    if (own.has(candidate.account)) return;
    const earlier = found.get(candidate.account);
    // ugyanaz a számlaszám többször: a BANK címke erősebb a GENERIC-nél
    if (!earlier || (earlier.label === "GENERIC" && candidate.label === "BANK"))
      found.set(candidate.account, candidate);
  };

  text.forEach((line, index) => {
    const label = labelOf(folded, index);
    if (!label) return;

    for (const match of line.matchAll(HU_ACCOUNT_PATTERN)) {
      const [, first, separator, second, thirdSeparator, third] = match;
      // az első 8 jegy önmagában, a második rész (8 vagy 16 jegy) EGYBEN; ha van harmadik blokk, vagy a teljes 24 jegyű szám érvényes, vagy a találat NEM
      // jelölt: soha nem esik vissza az első két blokkra (egy elírt vagy rosszul olvasott 3. blokkból idegen, rövidebb számlaszám lenne)
      const rest = third === undefined ? second! : `${second}${third}`;
      if (!hungarianPartValid(first!) || !hungarianPartValid(rest)) continue;
      const tagolt =
        separator !== "" ||
        (third !== undefined && (thirdSeparator ?? "") !== "");
      // a „számlaszám” címkével csak a tagolt alak elég: a tagolatlan 16 jegyű a számla száma is lehet
      if (label === "GENERIC" && !tagolt) continue;
      const raw = `${first}${rest}`;
      keep({
        account: normalizeSupplierAccount(raw),
        kind: "HU_ACCOUNT",
        label,
        line: index,
      });
    }

    for (const match of line.matchAll(IBAN_PATTERN)) {
      const compact = match[0].replace(/ /g, "");
      if (!ibanValid(compact)) continue;
      // az IBAN betűvel kezdődik és hosszra, ellenőrző összegre is érvényes: a „számlaszám” címke mellett sem lehet a számla száma
      keep({
        account: normalizeSupplierAccount(compact),
        kind: "IBAN",
        label,
        line: index,
      });
    }
  });
  return [...found.values()];
}

/** A kinyerés eredménye egy számlára: a döntés a jelöltek DARABSZÁMÁBÓL jön, soha nem sorrendből. */
export type SupplierAccountVerdict =
  | { readonly state: "ONE"; readonly account: string }
  | { readonly state: "SEVERAL"; readonly count: number }
  | { readonly state: "NONE" };

export function supplierAccountVerdict(
  candidates: readonly SupplierAccountCandidate[],
): SupplierAccountVerdict {
  const distinct = [...new Set(candidates.map((c) => c.account))];
  if (distinct.length === 1) return { state: "ONE", account: distinct[0]! };
  if (distinct.length > 1) return { state: "SEVERAL", count: distinct.length };
  return { state: "NONE" };
}

/**
 * Megjelenítési alak: a hazai szám 8-8(-8) kötőjelekkel, az IBAN négyes csoportokban. A kimenő riportban SOHA nem a teljes számot írjuk
 * (csak a végét): ezt a lista használja, ahol a számlaszám a cél.
 */
export function formatSupplierAccount(account: string): string {
  if (/^\d{16}$/.test(account))
    return `${account.slice(0, 8)}-${account.slice(8)}`;
  if (/^\d{24}$/.test(account))
    return `${account.slice(0, 8)}-${account.slice(8, 16)}-${account.slice(16)}`;
  return account.replace(/(.{4})/g, "$1 ").trim();
}
