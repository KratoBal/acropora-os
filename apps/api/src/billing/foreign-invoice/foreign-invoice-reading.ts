import type {
  IncomingReadingField,
  IncomingReadingSource,
  IncomingReadingValues,
  SupplierInvoiceImportResult,
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

const decimal = (value: number) => value.toFixed(2);
const HU_TAX = /^\d{8}-\d-\d{2}$/;

// ---- a kinyerés ------------------------------------------------------------

export function readForeignInvoice(input: ForeignReadingInput): ForeignReading {
  const values: IncomingReadingValues = { ...EMPTY };
  const sources: ForeignReading["sources"] = {};
  const warnings: string[] = [];
  const set = <K extends IncomingReadingField>(
    field: K,
    value: IncomingReadingValues[K] | null | undefined,
    source: IncomingReadingSource,
  ) => {
    if (value === null || value === undefined || value === "") return;
    if (values[field] !== null) return; // az előző (erősebb) forrás nyer
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
    set("issueDate", labelledDate(lines, ISSUE_LABEL), "TEXT");
    set("dueDate", labelledDate(lines, DUE_LABEL), "TEXT");
    set("fulfillmentDate", labelledDate(lines, SUPPLY_LABEL), "TEXT");

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
  if (pairing.gross)
    set("grossAmount", decimal(Number(pairing.gross)), "PAIRING");

  // 4. egyeztetés: egy rossz szám rosszabb, mint egy üres
  const net = values.netAmount !== null ? Number(values.netAmount) : null;
  const vat = values.vatAmount !== null ? Number(values.vatAmount) : null;
  const gross = values.grossAmount !== null ? Number(values.grossAmount) : null;
  if (net !== null && vat !== null && gross !== null) {
    if (Math.abs(net + vat - gross) > 0.02) {
      warnings.push(
        `A kiolvasott nettó (${decimal(net)}) és ÁFA (${decimal(vat)}) nem adja ki a bruttót (${decimal(gross)}); a kettőt kézzel kell beírni.`,
      );
      values.netAmount = null;
      values.vatAmount = null;
      delete sources.netAmount;
      delete sources.vatAmount;
    }
  } else if (net !== null && gross !== null && vat === null) {
    // a hiányzó ÁFA a kettő különbsége: számítás, nem találgatás
    values.vatAmount = decimal(gross - net);
    sources.vatAmount = sources.grossAmount === "PAIRING" ? "PAIRING" : "TEXT";
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

  return { values, sources, warnings, hasText };
}
