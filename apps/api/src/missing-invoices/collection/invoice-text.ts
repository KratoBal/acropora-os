/**
 * EGY ISMERETLEN SZÁLLÍTÓ PDF-JÉNEK ÁLTALÁNOS OLVASÁSA (kártya 3e75c2f4).
 *
 * A szállítói illesztők (`supplier-invoice-import`) szállítónként olvasnak, és
 * mindent kivesznek. A begyűjtött PDF-ek nagy része viszont olyan szállítótól
 * jön, akinek nincs illesztője; ezekből csak annyi kell, amennyi a NAV-sorhoz
 * köti őket: a SZÁMLASZÁM és a szállító ADÓSZÁMA (a kulcs a párosításban:
 * `mergeSameInvoice`). A kelet és a bruttót a NAV-sor adja, amint a kettő
 * összeért.
 *
 * NINCS KALIBRÁLVA VALÓDI MINTÁN (2026-10-01): a címkék a magyar és az angol
 * számlák szokásos feliratai. A mérés a 31 augusztusi „Eredeti hiányzik”
 * NAV-sor ellen jön, az acrobot által kért mintán; addig a begyűjtés kapcsolója
 * KI marad.
 */
import { ACROPORA_COMPANY } from "@acropora/types";

export interface InvoiceTextReading {
  invoiceNumber: string | null;
  /** Honnan jött a szám; a mérés és a hibakeresés ebből látja, melyik szabály vitte. */
  numberFrom: "NAV" | "BANK" | "LABEL" | "FILE_NAME" | null;
  /** A szállító adószáma: az első, ami nem a miénk (magyar vagy EU-s alak). */
  supplierTaxNumber: string | null;
}

export interface InvoiceTextHints {
  /**
   * A szállító (adószám szerint) NAV-ban ismert számlaszámai. Ha egyik a
   * szövegben áll, az a szám: ezt nem kitaláljuk, hanem megtaláljuk.
   */
  navNumbers?: (supplierTaxBase: string) => readonly string[];
  /** A fájl neve és a levél tárgya: a szám sokszor ott is áll. */
  fileName?: string;
  subject?: string | null;
}

/**
 * A SZÁMLA-SZÓ ÖNÁLLÓ SZÓKÉNT: a „bankszámlaszám” nem számla. A `\b` az
 * ékezetes betűt nem tartja betűnek, ezért saját határ áll itt.
 */
const INVOICE_WORD =
  /(?<!\p{L})(számla|szamla|e-számla|invoice|rechnung|facture|faktura|fattura|factura|díjbekérő|díjértesítő|díjértesítés)(?!\p{L})/iu;

/**
 * A SZÁMLASZÁM CÍMKÉI. A sorrend számít: a hosszabb, pontosabb címke áll
 * elöl, különben a „Számla” magában elvinné a „Számla sorszáma” sort.
 */
const NUMBER_LABELS = [
  "számla sorszáma",
  "számla száma",
  "számlaszám",
  "számla sorszám",
  "sorszám",
  "invoice number",
  "invoice no.",
  "invoice no",
  "invoice #",
  "rechnungsnummer",
  "rechnung nr.",
  "rechnung nr",
  "numéro de facture",
  "facture n°",
];

/**
 * A „számlaszám” a magyarban a BANKSZÁMLA száma is (mérve 2026-10-01, az info@
 * augusztusi mintáján: a saját számláinkon a címke után a bankszámlánk állt).
 * Ez az alak ezért nem számlaszám.
 */
const BANK_ACCOUNT = /^\d{8}-\d{8}(-\d{8})?$/;

/** Egy számlaszám alakja: betűvel vagy számmal kezdődik, legalább 3 jel. */
const NUMBER_TOKEN = /^[#:.\s]*([A-Za-z0-9][A-Za-z0-9\-/_.]{2,39})/;

/**
 * Magyar adószám (`12345678-1-12`), vagy EU-s közösségi adószám. Az EU-s alak
 * az országkód után CSAK számjegy (a francia és a holland saját alakjával): a
 * betűs változat a mintán BIC-kódot (`DRESDEFF510`) és szót (`CONFIRMATION`)
 * fogott.
 */
const TAX_NUMBER =
  /(?<![\dA-Za-z])(\d{8}-\d-\d{2}|FR[0-9A-Z]{2}\d{9}|NL\d{9}B\d{2}|ATU\d{8}|[A-Z]{2}\d{8,12})(?![\dA-Za-z])/g;

const usable = (value: string | undefined): string | null => {
  const cleaned = value?.replace(/[.]$/, "");
  return cleaned && /\d/.test(cleaned) && !BANK_ACCOUNT.test(cleaned)
    ? cleaned
    : null;
};

function labelledValue(lines: readonly string[], label: string): string | null {
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i]!.toLowerCase();
    let at = lower.indexOf(label);
    // a címke önálló szó legyen: a „bankszámlaszám” nem „számlaszám”
    while (at > 0 && /\p{L}/u.test(lower[at - 1]!))
      at = lower.indexOf(label, at + 1);
    if (at < 0) continue;
    const rest = lines[i]!.slice(at + label.length);
    const sameLine = usable(NUMBER_TOKEN.exec(rest)?.[1]);
    if (sameLine) return sameLine;
    // a címke alatti sorban áll az érték (táblázatos fejléc)
    const next = usable(NUMBER_TOKEN.exec(lines[i + 1] ?? "")?.[1]);
    if (!rest.trim() && next) return next;
  }
  return null;
}

/** Betű és szám, minden más nélkül: a `KS26/09229` és a `KS2609229` így egy. */
export const compactNumber = (value: string): string =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, "");

const taxBase = (tax: string): string =>
  tax.replace(/^HU/, "").replace(/\D/g, "").slice(0, 8);

/**
 * A SZÁMLA SZÁMA EGY BANKI TERHELÉS KÖZLEMÉNYÉBEN. A jelöltek: amit az olvasó
 * számnak talált, és a fájlnév meg a tárgy szavai, ha a PDF szövegében is
 * állnak. Legalább 5 karakter és benne számjegy, mint a párosító 1. szabályánál.
 *
 * A külföldi szállító számlája nincs a NAV-ban, tehát a NAV-kulcs soha nem
 * viszi; a közlemény viszont sokszor szó szerint megnevezi (mérve 2026-10-01,
 * éles: Amblard, „485,40 EUR F2602896 ...”, a levélben F2602896.PDF).
 */
export function numberInNarratives(
  lines: readonly string[],
  reading: InvoiceTextReading,
  hints: Pick<InvoiceTextHints, "fileName" | "subject">,
  narratives: readonly string[],
): string | null {
  const compactText = compactNumber(lines.join("\n"));
  const fromName = `${hints.fileName ?? ""} ${hints.subject ?? ""}`
    .split(/[^A-Za-z0-9/_-]+/)
    .map((token) => token.replace(/^[-_/]+|[-_/]+$/g, ""))
    .filter((token) => compactText.includes(compactNumber(token)));
  const compactNarratives = narratives.map(compactNumber);
  return (
    [reading.invoiceNumber, ...fromName]
      .filter((n): n is string => n !== null)
      .filter((n) => compactNumber(n).length >= 5 && /\d/.test(n))
      .filter((n) => !BANK_ACCOUNT.test(n))
      .find((n) =>
        compactNarratives.some((narrative) =>
          narrative.includes(compactNumber(n)),
        ),
      ) ?? null
  );
}

export function looksLikeInvoice(text: string): boolean {
  return INVOICE_WORD.test(text);
}

/**
 * DÍJBEKÉRŐ-E. A könyvelőnek nem számla (a Hiányzó számlák „Csak díjbekérő”
 * állapota), ezért a kind ennek alapján PROFORMA, ha illesztő nem olvasta.
 */
const PROFORMA_WORD =
  /(?<!\p{L})(díjbekérő|dijbekero|előlegbekérő|proforma|pro forma|pro-forma)(?!\p{L})/iu;

export function looksLikeProforma(text: string): boolean {
  return PROFORMA_WORD.test(text);
}

export function readInvoiceText(
  lines: readonly string[],
  hints: InvoiceTextHints = {},
): InvoiceTextReading {
  const text = lines.join("\n");
  const ours = ACROPORA_COMPANY.taxNumberBase;
  const supplierTaxNumber =
    [...text.matchAll(TAX_NUMBER)]
      .map((m) => m[1] as string)
      .find((tax) => taxBase(tax) !== ours) ?? null;
  const reading = (
    invoiceNumber: string | null,
    numberFrom: InvoiceTextReading["numberFrom"],
  ): InvoiceTextReading => ({ invoiceNumber, numberFrom, supplierTaxNumber });

  const compactText = compactNumber(text);
  if (supplierTaxNumber && hints.navNumbers) {
    // a leghosszabb elöl: egy rövid szám egy hosszabbnak a része is lehet
    const found = [...hints.navNumbers(taxBase(supplierTaxNumber))]
      .sort((a, b) => compactNumber(b).length - compactNumber(a).length)
      .find(
        (number) =>
          compactNumber(number).length >= 4 &&
          compactText.includes(compactNumber(number)),
      );
    if (found) return reading(found, "NAV");
  }
  for (const label of NUMBER_LABELS) {
    const labelled = labelledValue(lines, label);
    if (labelled) return reading(labelled, "LABEL");
  }
  const fromName = `${hints.fileName ?? ""} ${hints.subject ?? ""}`
    .split(/[^A-Za-z0-9/_-]+/)
    .map((token) => token.replace(/^[-_/]+|[-_/]+$/g, ""))
    .find(
      (token) =>
        token.length >= 5 &&
        /\d/.test(token) &&
        !BANK_ACCOUNT.test(token) &&
        compactText.includes(compactNumber(token)),
    );
  return fromName ? reading(fromName, "FILE_NAME") : reading(null, null);
}
