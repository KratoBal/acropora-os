import {
  ACROPORA_COMPANY,
  INCOMING_READING_SOURCE_LABELS,
  type IncomingReadingField,
  type IncomingReadingSource,
  type IncomingReadingValues,
  type SupplierInvoiceImportResult,
} from "@acropora/types";

import {
  amountValue,
  labelledTotal,
  onlyCurrency,
  readInvoiceText,
} from "../../missing-invoices/collection/invoice-text.js";

/**
 * A POSTAFIÓKOS (KÜLFÖLDI) SZÁMLA MEZŐINEK KINYERÉSE (kártya e4c3b0fb; terv:
 * agents/murena/megosztas/kulfoldi-szamla-terv-2026-10-07.md).
 *
 * NEM MÁSODIK KINYERŐ: a meglévő kettőre épül. Ha a beszállítói illesztő
 * (`importResult`: Aquarioom, De Jong, …) ismerte a PDF-et, az az elsődleges
 * forrás; a többit az általános szövegolvasó (`invoice-text.ts`) segédjeivel
 * olvassuk, címke szerint, angol, német, holland, francia és magyar alakban.
 *
 * KÉT SZABÁLY, AMI MINDEN MEZŐRE ÁLL:
 * 1. Egy mező CÍMKÉZETT értékből jön, nem találgatásból. A címke nélküli
 *    dátum vagy összeg üres marad: azt ember tölti ki.
 * 2. Egy rossz szám rosszabb, mint egy üres. Ha a nettó és az ÁFA nem adja ki
 *    a bruttót, a kettő üres marad, és egy figyelmeztetés mondja meg, miért;
 *    egy kétértelmű dátum (03/04/2026) sem kerül be.
 *
 * Tiszta függvény: nem olvas adatbázist és nem nyit PDF-et.
 */

export interface ForeignReadingInput {
  /** a PDF szövegrétegének sorai; `null`, ha nincs szövegréteg (szkennelt) */
  lines: readonly string[] | null;
  /** a beszállítói illesztő eredménye, ha az ismerte a PDF-et */
  adapter: SupplierInvoiceImportResult | null;
  /** amit a banki párosítás tud a dokumentumról (a mai lista sora is ebből jön) */
  pairing: {
    number: string;
    supplierName: string;
    /** YYYY-MM-DD */
    date: string;
    gross: string | null;
    currency: string;
    debits: readonly { amount: string; currency: string }[];
  };
}

export interface ForeignReading {
  values: IncomingReadingValues;
  sources: Partial<Record<IncomingReadingField, IncomingReadingSource>>;
  warnings: string[];
  hasText: boolean;
}

const EMPTY: IncomingReadingValues = {
  supplierName: null,
  supplierTaxNumber: null,
  supplierEuTaxNumber: null,
  documentNumber: null,
  issueDate: null,
  fulfillmentDate: null,
  dueDate: null,
  currency: null,
  netAmount: null,
  vatAmount: null,
  grossAmount: null,
};

// ---- dátum ----------------------------------------------------------------

const MONTHS: Record<string, number> = {};
const monthNames: [number, string[]][] = [
  [1, ["january", "jan", "januar", "januari", "janvier", "január"]],
  [
    2,
    ["february", "feb", "februar", "februari", "février", "fevrier", "február"],
  ],
  [3, ["march", "mar", "märz", "maerz", "maart", "mars", "március"]],
  [4, ["april", "apr", "avril", "április"]],
  [5, ["may", "mai", "mei", "május"]],
  [6, ["june", "jun", "juni", "juin", "június"]],
  [7, ["july", "jul", "juli", "juillet", "július"]],
  [8, ["august", "aug", "augustus", "août", "aout", "augusztus"]],
  [9, ["september", "sep", "sept", "septembre", "szeptember"]],
  [10, ["october", "oct", "oktober", "octobre", "október"]],
  [11, ["november", "nov", "novembre"]],
  [12, ["december", "dec", "dezember", "décembre", "decembre"]],
];
for (const [month, names] of monthNames)
  for (const name of names) MONTHS[name] = month;

const pad = (n: number) => String(n).padStart(2, "0");

function validDate(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Az első dátum egy szövegben, YYYY-MM-DD alakban, vagy `null`.
 *
 * A PERJELES SZÁMDÁTUM KÉTÉRTELMŰ: a `03/04/2026` amerikai alakban március 4.,
 * európaiban április 3. Ha mindkét rész legfeljebb 12, nem döntünk (`null`):
 * azt ember tölti ki. A pontos (`03.04.2026`) alak európai, az egyértelmű.
 */
export function parseForeignDate(text: string): string | null {
  const iso = /(?<!\d)(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?!\d)/.exec(text);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dotted = /(?<!\d)(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})(?!\d)/.exec(text);
  if (dotted)
    return validDate(Number(dotted[3]), Number(dotted[2]), Number(dotted[1]));

  const slashed = /(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?!\d)/.exec(text);
  if (slashed) {
    const a = Number(slashed[1]);
    const b = Number(slashed[2]);
    if (a <= 12 && b <= 12 && a !== b) return null;
    return a > 12
      ? validDate(Number(slashed[3]), b, a)
      : validDate(Number(slashed[3]), a, b);
  }

  const word = String.raw`([\p{L}]{3,10})\.?`;
  // „October 3, 2026” és „Oct 3 2026”
  const monthFirst = new RegExp(
    String.raw`${word}\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})`,
    "u",
  ).exec(text);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1]!.toLowerCase()];
    if (month)
      return validDate(Number(monthFirst[3]), month, Number(monthFirst[2]));
  }
  // „3 October 2026”, „3. Oktober 2026”, „3 okt. 2026”
  const dayFirst = new RegExp(
    String.raw`(?<!\d)(\d{1,2})\.?\s+${word}\s+(\d{4})`,
    "u",
  ).exec(text);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2]!.toLowerCase()];
    if (month)
      return validDate(Number(dayFirst[3]), month, Number(dayFirst[1]));
  }
  // „2026. október 3.”
  const hungarian = new RegExp(
    String.raw`(\d{4})\.\s+${word}\s+(\d{1,2})\.?`,
    "u",
  ).exec(text);
  if (hungarian) {
    const month = MONTHS[hungarian[2]!.toLowerCase()];
    if (month)
      return validDate(Number(hungarian[1]), month, Number(hungarian[3]));
  }
  return null;
}

// ---- címkék ---------------------------------------------------------------

const ISSUE_LABEL =
  /(invoice\s+date|date\s+of\s+issue|issue\s+date|date\s+issued|issued\s+on|rechnungsdatum|ausstellungsdatum|factuurdatum|date\s+de\s+(la\s+)?facture|date\s+d['’][ée]mission|sz[áa]mla\s+kelte|ki[áa]ll[íi]t[áa]s\s+d[áa]tuma)/iu;
const DUE_LABEL =
  /(due\s+date|date\s+due|payment\s+due|due\s+on|f[äa]lligkeitsdatum|f[äa]llig|zahlbar\s+bis|vervaldatum|uiterste\s+betaaldatum|date\s+d['’][ée]ch[ée]ance|[ée]ch[ée]ance|fizet[ée]si\s+hat[áa]rid[őo])/iu;
const SUPPLY_LABEL =
  /(date\s+of\s+supply|supply\s+date|delivery\s+date|leistungsdatum|lieferdatum|leveringsdatum|date\s+de\s+livraison|teljes[íi]t[ée]s(\s+d[áa]tuma)?)/iu;
const NET_LABEL =
  /(subtotal|sub-total|net\s+amount|total\s+excl(\.|uding|usive)?|amount\s+excl(\.|uding)?|nettobetrag|summe\s+netto|zwischensumme|netto|subtotaal|totaal\s+excl|montant\s+ht|total\s+ht|sous-total|nett[óo](\s+[öo]sszesen)?)/iu;
const VAT_LABEL =
  /(\bvat\b|\btax\b|\bmwst\b|\bust\b|umsatzsteuer|mehrwertsteuer|\bbtw\b|\btva\b|[áa]fa\b)/iu;
/** ezek a sorok nem ÁFA-ÖSSZEGET hordoznak: adószám, mentesség, nettó vagy bruttó végösszeg */
const NOT_VAT_AMOUNT =
  /(number|\bno\b\.?|\bnr\b\.?|\bid\b|idnr|ust-?id|identification|nummer|registration|reg\.|excl|incl|zzgl|inkl|including|excluding|\bht\b|\bttc\b|subtotal|total\s+(amount|due)|amount\s+due)/iu;
const REVERSE_CHARGE =
  /(reverse\s+charge|steuerschuldnerschaft\s+des\s+leistungsempf[äa]ngers|btw\s+verlegd|autoliquidation|ford[íi]tott\s+ad[óo]z[áa]s)/iu;

/** A címke utáni rész ugyanazon a soron, vagy (ha ott semmi) a következő sor. */
function afterLabel(
  lines: readonly string[],
  label: RegExp,
  skip?: RegExp,
): string[] {
  const places: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.normalize("NFC");
    if (skip && skip.test(line)) continue;
    const hit = label.exec(line);
    if (!hit) continue;
    const rest = line.slice(hit.index + hit[0].length);
    places.push(rest.trim() ? rest : (lines[i + 1] ?? ""));
  }
  return places;
}

function labelledDate(lines: readonly string[], label: RegExp): string | null {
  const found = new Set(
    afterLabel(lines, label)
      .map(parseForeignDate)
      .filter((d): d is string => d !== null),
  );
  // több különböző címkés dátum: nem döntünk
  return found.size === 1 ? [...found][0]! : null;
}

/**
 * Összegek egy szövegben, a százalékot (27%) kihagyva. Betűhöz tapadó szám
 * nem összeg: az `IE9999999XX` adószám számjegyei nem ÁFA.
 */
function amountsIn(text: string): number[] {
  const re =
    /(?<![\d.,\p{L}])([-−]\s?)?(\d{1,3}(?:[  .,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d.,]*\s?%)(?![\d\p{L}])/gu;
  return [...text.matchAll(re)]
    .map((m) => (m[1] ? -1 : 1) * amountValue(m[2]!))
    .filter((v) => Number.isFinite(v));
}

function labelledAmount(
  lines: readonly string[],
  label: RegExp,
  skip?: RegExp,
): number | null {
  const found = new Set<number>();
  for (const place of afterLabel(lines, label, skip)) {
    const values = amountsIn(place);
    if (values.length) found.add(values[values.length - 1]!);
  }
  return found.size === 1 ? [...found][0]! : null;
}

/**
 * AZ OSSZESITO SOR: "Összesen: | nettó | ÁFA | bruttó" (kártya dbab22cd, az első kiserlet).
 *
 * A magyar (Számlázz.hu és társai) számlák táblázata a végén egy "Összesen:" sort ad három összeggel,
 * a fejléce `nettó | áfa | bruttó`. A cimkézett olvasó ezt nem találta meg: a címke és az összeg
 * nem egy sorban áll, vagy a sorban három szám van. Mérve a hangoló félen (2026-10-21): a feed
 * csoport 7 számlájából a nettó és a bruttó egyet sem olvasott ki.
 *
 * NEM TALÁLGATÁS, HÁROM FELTÉTEL EGYÜTT: (1) a sor "Összesen"-nel kezdődik és PONTOSAN három összeg áll
 * benne; (2) valamelyik előtte álló sor (nem feltétlenül a táblázat fejléce: az első olyan, amelyben a
 * "nettó" a "bruttó" előtt áll; az aritmetika a tévedést kiszűri) fejléc-szerű; (3) a három összeg kijön:
 * nettó + ÁFA = bruttó (két fillér tűréssel, nem negatív ÁFA). Több, egymástól eltérő ilyen sor (több
 * táblázat) vagy bármelyik feltétel hiánya: nem döntünk.
 *
 * A NEGATÍV ÁFA KIZÁRÁSA A JÓVÁÍRÓ (mind a három összeg negatív) SZÁMLÁT IS ÜRESEN HAGYJA: biztonságos,
 * csak tudni kell róla a mérésnél (barracuda, #1795).
 */
const TOTALS_LABEL = /^\s*(összesen|osszesen|mind[öo]sszesen|total)\b\s*:?/iu;
const NET_HEADER = /nett[óo]|netto/iu;
const GROSS_HEADER = /brutt[óo]|brutto/iu;

export function totalsRow(
  lines: readonly string[],
): { net: number; vat: number; gross: number } | null {
  const found = new Map<string, { net: number; vat: number; gross: number }>();
  lines.forEach((raw, index) => {
    const line = raw.normalize("NFC");
    const hit = TOTALS_LABEL.exec(line);
    if (!hit) return;
    const values = amountsIn(line.slice(hit.index + hit[0].length));
    if (values.length !== 3) return;
    const [net, vat, gross] = values as [number, number, number];
    if (vat < 0 || Math.abs(net + vat - gross) > 0.02) return;
    const header = lines.slice(0, index).some((earlier) => {
      const n = earlier.normalize("NFC").search(NET_HEADER);
      const g = earlier.normalize("NFC").search(GROSS_HEADER);
      return n >= 0 && g > n;
    });
    if (!header) return;
    found.set(`${net}|${vat}|${gross}`, { net, vat, gross });
  });
  return found.size === 1 ? [...found.values()][0]! : null;
}

/**
 * A FEJLEC-SOR ALATTI ERTEKSOR (kártya dbab22cd, harmadik kísérlet): a magyar számla metaadat-táblázata
 * egy fejléc-sor (`Számlaszám | Fizetési mód`, vagy `Teljesítés kelte | Számla kelte | Fizetési határidő`)
 * és alatta az értékek, CELLÁNKÉNT egymás alatt. A címkézett olvasó a címke utáni szöveget keresi, ez
 * a cella alatti cellát.
 *
 * FELTÉTELEK EGYÜTT: a fejléc-sor és az alatta álló sor CELLASZÁMA egyezik; a cimkét felismerjük (pontos
 * cella, nem részlet); a dátum-cella EGYETLEN dátumot tartalmaz (egy "2026.10.03-2026.10.05" tartomány
 * nem); a számlaszám-cella nem üres, tartalmaz számjegyet és legfeljebb 40 karakter. Egy mezőre több,
 * egymástól eltérő jelölt: nem döntünk.
 */
type TableField =
  "documentNumber" | "issueDate" | "fulfillmentDate" | "dueDate";
const TABLE_LABELS: [TableField, RegExp][] = [
  [
    "documentNumber",
    /^(sz[áa]mlasz[áa]m|sz[áa]mla\s+sz[áa]ma|sz[áa]mla\s+sorsz[áa]ma|sorsz[áa]m|sorsz[áa]ma|invoice\s+(no|number)\.?|rechnungs(nummer|nr\.?))\s*:?$/iu,
  ],
  [
    "issueDate",
    /^(sz[áa]mla\s+kelte|kelte|kelt|ki[áa]ll[íi]t[áa]s\s+(d[áa]tuma|kelte)|invoice\s+date|rechnungsdatum)\s*:?$/iu,
  ],
  [
    "fulfillmentDate",
    /^(teljes[íi]t[ée]s(\s+kelte|\s+d[áa]tuma)?|date\s+of\s+supply|leistungsdatum)\s*:?$/iu,
  ],
  [
    "dueDate",
    /^(fizet[ée]si\s+hat[áa]rid[őo]|esed[ée]kess[ée]g|due\s+date|f[äa]lligkeitsdatum)\s*:?$/iu,
  ],
];
const DATE_IN_CELL =
  /(?<!\d)(\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}\.\s?\d{1,2}\.\s?\d{4})(?!\d)/gu;

export function tableRowFields(
  lines: readonly string[],
): Partial<Record<TableField, string>> {
  const found = new Map<TableField, Set<string>>();
  lines.forEach((raw, index) => {
    const header = raw
      .normalize("NFC")
      .split(" | ")
      .map((cell) => cell.trim());
    const next = lines[index + 1]
      ?.normalize("NFC")
      .split(" | ")
      .map((cell) => cell.trim());
    if (header.length < 2 || !next || next.length !== header.length) return;
    header.forEach((label, column) => {
      const field = TABLE_LABELS.find(([, pattern]) =>
        pattern.test(label),
      )?.[0];
      if (!field) return;
      const cell = next[column] ?? "";
      let value: string | null = null;
      if (field === "documentNumber") {
        value = cell && /\d/.test(cell) && cell.length <= 40 ? cell : null;
      } else if ((cell.match(DATE_IN_CELL) ?? []).length === 1) {
        value = parseForeignDate(cell);
      }
      if (!value) return;
      if (!found.has(field)) found.set(field, new Set());
      found.get(field)!.add(value);
    });
  });
  const result: Partial<Record<TableField, string>> = {};
  for (const [field, values] of found)
    if (values.size === 1) result[field] = [...values][0]!;
  return result;
}

/**
 * A SZALLITO NEVE A SZOVEGBOL (kártya dbab22cd, második kísérlet). Eddig az olvasó a szállító nevét
 * a szövegből SOHA nem olvasta (csak az illesztő vagy a párosítás adta): a hangoló félen 22,7 %.
 *
 * Mérve a hangoló félen: a név 22-ből 20 számlán megvan a szövegben, 11-nél a legelső sorban, 6-nál az
 * "Eladó ... | Vevő ..." fejléc alatti sor első celláiban. EZ A KETTŐ az, amit olvasunk, és mindkettőhöz
 * JOGI FORMA kell a névben (Kft., Zrt., GmbH, Ltd, ...): egy jogi forma nélküli első sor lehet "SZÁMLA" vagy
 * "Invoice" is, azt nem találgatjuk. A saját cégünk neve (a vevő) soha nem lehet a szállító.
 *
 * Ha a két hely MÁS nevet ad, nem döntünk. Az illesztő és a banki párosítás neve elsőbbséget élvez
 * (ez csak a hiányt tölti), tehát élesben, párosítással, semmi nem változik: a nyereség ott van, ahol
 * párosítás nincs.
 */
const LEGAL_FORM =
  /(?<![\p{L}\p{N}])(kft|zrt|nyrt|kkt|bt|gmbh|ag|ltd|limited|inc|llc|b\.?v\.?|s\.?r\.?l|sarl|s\.?a\.?s|oy)(?![\p{L}\p{N}])/iu;
const SELLER_HEADER = /el[áa]d[óo]|kiáll[íi]t[óo]|sz[áa]ll[íi]t[óo]/iu;
const BUYER_HEADER = /vev[őo]/iu;

function plausibleName(raw: string | undefined): string | null {
  const name = (raw ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) return null;
  if (!LEGAL_FORM.test(name)) return null;
  const buyer = ACROPORA_COMPANY.name.toLowerCase().split(/\s+/)[0]!;
  if (name.toLowerCase().includes(buyer)) return null;
  return name;
}

export function supplierNameFromText(lines: readonly string[]): string | null {
  const candidates = new Set<string>();
  const first = lines.find((line) => line.trim());
  const top = plausibleName(first?.split(" | ")[0]);
  if (top) candidates.add(top);
  lines.forEach((line, index) => {
    const sellerAt = line.search(SELLER_HEADER);
    const buyerAt = line.search(BUYER_HEADER);
    if (sellerAt < 0 || buyerAt < 0 || sellerAt > buyerAt) return;
    const below = plausibleName(lines[index + 1]?.split(" | ")[0]);
    if (below) candidates.add(below);
  });
  return candidates.size === 1 ? [...candidates][0]! : null;
}

const decimal = (value: number) => value.toFixed(2);
const HU_TAX = /^\d{8}-\d-\d{2}$/;
const EU_NOT_HU =
  /^(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI)[0-9A-Z]{2,13}$/;

/** Egy EU-tagállam közösségi adószáma, a magyar kivételével (`NL802708705B01`, `IE4143435AH`). */
export function isEuNotHungarian(value: string | null | undefined): boolean {
  return EU_NOT_HU.test((value ?? "").replace(/\s/g, "").toUpperCase());
}

// ---- a kinyerés ------------------------------------------------------------

export function readForeignInvoice(input: ForeignReadingInput): ForeignReading {
  const values: IncomingReadingValues = { ...EMPTY };
  const sources: ForeignReading["sources"] = {};
  const warnings: string[] = [];
  // az első nem tárolható érték mezőnként; a figyelmeztetés a végén megy ki,
  // amikor már látszik, kitöltötte-e egy másik forrás
  const refused: Partial<Record<IncomingReadingField, string>> = {};
  const set = <K extends IncomingReadingField>(
    field: K,
    value: IncomingReadingValues[K] | null | undefined,
    source: IncomingReadingSource,
  ) => {
    if (value === null || value === undefined || value === "") return;
    if (values[field] !== null) return; // az előző (erősebb) forrás nyer
    // ami az oszlopába nem fér, az nem foglalja el a mezőt: egy gyengébb, de
    // tárolható forrás még kitöltheti, különben kézi marad (lásd `storable`)
    if (!fitsColumn(field, value)) {
      refused[field] ??= value;
      return;
    }
    values[field] = value;
    sources[field] = source;
  };

  const { adapter, pairing } = input;
  const lines = input.lines?.filter((line) => line.trim()) ?? [];
  const hasText = lines.length > 0;

  /*
    1. a beszállítói illesztő. A díjbekérőt is ez olvassa (Aquarioom,
    `documentKind: PROFORMA`): abból jóváhagyott számla-sor nem lehet, tehát az
    adatát nem vesszük át (barracuda visszamérése, acrobot 27623).
  */
  if (adapter?.documentKind === "PROFORMA")
    warnings.push(
      "A beszállítói olvasó díjbekérőnek látta a PDF-et: az adatait nem vettük át.",
    );
  if (adapter && adapter.documentKind !== "PROFORMA") {
    set("supplierName", adapter.supplier.name, "ADAPTER");
    set("supplierEuTaxNumber", adapter.supplier.vatId, "ADAPTER");
    set("documentNumber", adapter.invoiceNumber, "ADAPTER");
    set("issueDate", adapter.invoiceDate, "ADAPTER");
    set("dueDate", adapter.dueDate, "ADAPTER");
    set("currency", adapter.currency?.toUpperCase(), "ADAPTER");
    if (adapter.netTotal !== null)
      set("netAmount", decimal(adapter.netTotal), "ADAPTER");
  }

  // 2. a PDF szövege
  if (hasText) {
    const text = readInvoiceText(lines);
    set("documentNumber", text.invoiceNumber, "TEXT");
    if (text.supplierTaxNumber) {
      if (HU_TAX.test(text.supplierTaxNumber))
        set("supplierTaxNumber", text.supplierTaxNumber, "TEXT");
      else set("supplierEuTaxNumber", text.supplierTaxNumber, "TEXT");
    }
    /*
      A FEJLEC ALATTI CELLA ELOBBRE VALO A DATUMNAL (a cimke a sor VEGEN all): a cimkézett olvasó a
      "Fizetési határidő" cimke utáni üres rész miatt a KÖVETKEZŐ SOR ELSŐ dátumát vette volna (a
      teljesítésit); az oszlop szerinti olvasás pontos. A mintán a három dátum egy napra esett, ezért
      nem mutatkozott; kitalált szövegen kiderült.
    */
    const table = tableRowFields(lines);
    set("issueDate", table.issueDate, "TEXT");
    set("fulfillmentDate", table.fulfillmentDate, "TEXT");
    set("dueDate", table.dueDate, "TEXT");
    set("issueDate", labelledDate(lines, ISSUE_LABEL), "TEXT");
    set("dueDate", labelledDate(lines, DUE_LABEL), "TEXT");
    set("fulfillmentDate", labelledDate(lines, SUPPLY_LABEL), "TEXT");
    // a számlaszámot a cimkézett olvasás után csak az üres hely tölti
    set("documentNumber", table.documentNumber, "TEXT");

    const total = labelledTotal(lines);
    if (total) {
      set("grossAmount", decimal(Number(total.gross)), "TEXT");
      set("currency", total.currency, "TEXT");
    }
    set("currency", onlyCurrency(lines), "TEXT");

    const net = labelledAmount(lines, NET_LABEL);
    if (net !== null) set("netAmount", decimal(net), "TEXT");
    const vat = labelledAmount(lines, VAT_LABEL, NOT_VAT_AMOUNT);
    if (vat !== null) set("vatAmount", decimal(vat), "TEXT");
    else if (REVERSE_CHARGE.test(lines.join("\n")))
      set("vatAmount", decimal(0), "TEXT");
    // a cimkézett olvasás után: ami már megvan, azt az összesítő sor nem írja felül, és ha egy már
    // meglévő érték ELTÉR az összesítő sortól (két táblázat, másik összeg), az sor semmit nem tölt:
    // a három mező nem mondhat ellent egymásnak (barracuda, #1795)
    const totals = totalsRow(lines);
    const agrees = (
      field: "netAmount" | "vatAmount" | "grossAmount",
      amount: number,
    ) =>
      values[field] === null ||
      Math.abs(Number(values[field]) - amount) <= 0.02;
    if (
      totals &&
      agrees("netAmount", totals.net) &&
      agrees("vatAmount", totals.vat) &&
      agrees("grossAmount", totals.gross)
    ) {
      set("netAmount", decimal(totals.net), "TEXT");
      set("vatAmount", decimal(totals.vat), "TEXT");
      set("grossAmount", decimal(totals.gross), "TEXT");
    }
  } else {
    warnings.push(
      "A PDF-nek nincs szövegrétege (szkennelt számla): a mezőket kézzel kell kitölteni.",
    );
  }

  // 3. amit a banki párosítás tud
  set("supplierName", pairing.supplierName, "PAIRING");
  set("documentNumber", pairing.number, "PAIRING");
  set("issueDate", pairing.date, "PAIRING");
  set("currency", pairing.currency?.toUpperCase(), "PAIRING");
  // a név a szövegből csak a HIÁNYT tölti: az illesztő és a párosítás neve elsőbbséget élvez
  if (values.supplierName === null && hasText)
    set("supplierName", supplierNameFromText(lines), "TEXT");
  /*
    A PÁROSÍTÁS BRUTTÓJA GYENGE FORRÁS (barracuda, acrobot 27658): illesztős
    külföldi számlánál ez az illesztő NETTÓJA, kártyás fizetésnél a TERHELÉS,
    a terhelés devizájában. Ezért csak EGYEZŐ devizánál vesszük át, és nem
    számolunk belőle ÁFÁ-t (lent): különben az ÁFA bruttó mínusz nettó lenne,
    és a nettó + ÁFA = bruttó ellenőrzés szerkezetileg mindig zöld.
  */
  if (
    pairing.gross &&
    (values.currency === null ||
      values.currency === pairing.currency?.toUpperCase())
  )
    set("grossAmount", decimal(Number(pairing.gross)), "PAIRING");

  // 4. egyeztetés: egy rossz szám rosszabb, mint egy üres
  const net = values.netAmount !== null ? Number(values.netAmount) : null;
  const vat = values.vatAmount !== null ? Number(values.vatAmount) : null;
  const gross = values.grossAmount !== null ? Number(values.grossAmount) : null;
  const pairingGross = sources.grossAmount === "PAIRING";
  if (net !== null && vat !== null && gross !== null) {
    if (Math.abs(net + vat - gross) > 0.02) {
      if (pairingGross) {
        // a nettó és az ÁFA a számláról jön, a gyenge forrás a bruttó: az megy
        warnings.push(
          `A párosítás összege (${decimal(gross)}) nem egyezik a kiolvasott nettó (${decimal(net)}) és ÁFA (${decimal(vat)}) összegével; a bruttót kézzel kell beírni.`,
        );
        values.grossAmount = null;
        delete sources.grossAmount;
      } else {
        warnings.push(
          `A kiolvasott nettó (${decimal(net)}) és ÁFA (${decimal(vat)}) nem adja ki a bruttót (${decimal(gross)}); a kettőt kézzel kell beírni.`,
        );
        values.netAmount = null;
        values.vatAmount = null;
        delete sources.netAmount;
        delete sources.vatAmount;
      }
    }
  } else if (net !== null && gross !== null && vat === null && !pairingGross) {
    // a hiányzó ÁFA a számlán olvasott bruttó és nettó különbsége: számítás,
    // nem találgatás. A párosítás bruttójából NEM (lásd fent); a fordított
    // adózás 0 ÁFÁ-ját a REVERSE_CHARGE szabály adja.
    values.vatAmount = decimal(gross - net);
    sources.vatAmount = sources.grossAmount ?? "TEXT";
  } else if (
    net !== null &&
    gross !== null &&
    vat === null &&
    pairingGross &&
    Math.abs(net - gross) <= 0.02 &&
    isEuNotHungarian(values.supplierEuTaxNumber)
  ) {
    /*
      KÖZÖSSÉGI BESZERZÉSNEK LÁTSZIK, DE NEM TÖLTJÜK KI (Balázs, De Jong
      Marinelife, acrobot 34628 és 34653). Ha a nettó és a bruttó két független
      forrásból egyezik, a fenti ág már 0 ÁFÁ-t számol. Ide csak az a sor jut,
      ahol a bruttó a PÁROSÍTÁSBÓL jön: illesztős számlánál az az illesztő
      nettója, tehát az egyezés szerkezeti, nem bizonyíték arra, hogy nincs
      ÁFA. Az ellenőrző lap ezért megnevezi a mezőt és az okot.
    */
    warnings.push(
      `Közösségi beszerzésnek látszik (${values.supplierEuTaxNumber}, a nettó egyenlő a bruttóval), de a bruttó a banki párosításból jön, nem a számláról: az ÁFÁ-t kézzel kell megadni (közösségi beszerzésnél 0).`,
    );
  }

  /*
    A BANKI EGYEZTETÉS CSAK A SZÖVEGBŐL OLVASOTT BRUTTÓRA: a párosítás bruttója
    kártyás fizetésnél MAGA A TERHELÉS (`cardPayment`), azzal összevetni
    önmagához mérés, ami mindig egyezik (barracuda visszamérése).
  */
  if (gross !== null && sources.grossAmount === "TEXT" && values.currency) {
    const same = pairing.debits.filter(
      (debit) => debit.currency.toUpperCase() === values.currency,
    );
    if (same.length === pairing.debits.length && same.length > 0) {
      const paid = same.reduce((sum, debit) => sum + Number(debit.amount), 0);
      if (Math.abs(paid - gross) > 0.02)
        warnings.push(
          `A bruttó (${decimal(gross)} ${values.currency}) eltér a banki terheléstől (${decimal(paid)} ${values.currency}).`,
        );
    }
  }

  for (const [field, value] of Object.entries(refused) as [
    IncomingReadingField,
    string,
  ][]) {
    const source = sources[field];
    warnings.push(
      unstorableWarning(
        field,
        value,
        values[field] !== null && source
          ? `helyette a(z) „${INCOMING_READING_SOURCE_LABELS[source]}” értéke áll`
          : "kézzel kell megadni",
      ),
    );
  }
  storable(values, sources, warnings);
  return { values, sources, warnings, hasText };
}

/*
  A TÁROLHATÓSÁG ŐRE (kulfoldi-szamla-olvasas-hiba, 2026-10-14). Az éles
  időzítő 2026-10-13 08:29 óta minden futásnál egy `PrismaClientKnownRequestError`-on
  állt meg: egy sor olvasata nem fért az oszlopába, és az írás mindig ugyanott
  bukott. A legvalószínűbb két ok a deviza (`VarChar(3)`; az illesztő devizája
  csak nagybetűsítve jön át) és egy félreolvasott összeg (`Decimal(18,2)`, 16
  egész jegy). Ami nem fér el, az a mezőt nem foglalja el (`set`), és ami az
  egyeztetésben számolódik, az a végén még egyszer átmegy ugyanezen (`storable`).
  A 2. szabály szerint egy rossz szám rosszabb, mint egy üres: a sor
  figyelmeztetéssel kézi kitöltésre vár, ahelyett hogy a futást állítaná meg.
*/
const STORABLE_CURRENCY = /^[A-Z]{3}$/;
const STORABLE_AMOUNT = /^-?\d{1,16}(\.\d{1,2})?$/;
const STORABLE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FIELD_LABEL: Partial<Record<IncomingReadingField, string>> = {
  currency: "deviza",
  netAmount: "nettó",
  vatAmount: "ÁFA",
  grossAmount: "bruttó",
  issueDate: "kelt",
  fulfillmentDate: "teljesítés",
  dueDate: "fizetési határidő",
};

function storableDate(value: string): boolean {
  const match = STORABLE_DATE.exec(value);
  return (
    !!match &&
    validDate(Number(match[1]), Number(match[2]), Number(match[3])) === value
  );
}

const COLUMN_CHECK: Partial<
  Record<IncomingReadingField, (value: string) => boolean>
> = {
  currency: (value) => STORABLE_CURRENCY.test(value),
  netAmount: (value) => STORABLE_AMOUNT.test(value),
  vatAmount: (value) => STORABLE_AMOUNT.test(value),
  grossAmount: (value) => STORABLE_AMOUNT.test(value),
  issueDate: storableDate,
  fulfillmentDate: storableDate,
  dueDate: storableDate,
};

/** Elfér-e az érték a mező oszlopában (a szöveges mezők korlátlanok). */
export function fitsColumn(
  field: IncomingReadingField,
  value: string,
): boolean {
  return COLUMN_CHECK[field]?.(value) ?? true;
}

function unstorableWarning(
  field: IncomingReadingField,
  value: string,
  then = "kézzel kell megadni",
): string {
  const shown = value.length > 40 ? `${value.slice(0, 40)}…` : value;
  return `A kiolvasott ${FIELD_LABEL[field] ?? field} („${shown}”) nem tárolható; ${then}.`;
}

/** Kiüríti, ami az oszlopába nem férne, és megmondja, miért. */
export function storable(
  values: IncomingReadingValues,
  sources: ForeignReading["sources"],
  warnings: string[],
): void {
  for (const field of Object.keys(COLUMN_CHECK) as IncomingReadingField[]) {
    const value = values[field];
    if (value === null || fitsColumn(field, value)) continue;
    warnings.push(unstorableWarning(field, value));
    values[field] = null;
    delete sources[field];
  }
}
