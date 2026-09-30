import type {
  SupplierInvoiceImportLine,
  SupplierInvoiceImportResult,
} from "@acropora/types";
import type { CandidateProfile } from "@acropora/jev";

import {
  countryFromVatId,
  isChargeDescription,
  normalizeVatId,
} from "../supplier-invoice-import.common.js";
import { SupplierInvoiceImportError } from "../supplier-invoice-import.error.js";
import type { SupplierPdfAdapter } from "../supplier-pdf-adapter.js";

/**
 * HERTLEIN AQUARISTIK -- az első beszállítói PDF-illesztő (#1199 P-026).
 *
 * Minden, ami Hertlein-specifikus, ebben a fájlban áll: a táblázat fejléce,
 * a sorminta, a fejléc-mezők helye. A XML-számla NEM ide tartozik: a Hertlein
 * 2025 óta CII XML-t is küld, és azt a közös CII-olvasó viszi.
 *
 * A minta a DISCOVERY-mérésből jön (#1199 A-008, a 45 számla PDF-je): a
 * cikkszám-sorozat mind a 20 olyan számlán betűre egyezett az XML-lel, ahol
 * mindkettő megvolt. A két nehéz eset, mindkettő mérve:
 *
 *   - A cikkszám és a megnevezés EGY szövegdarabként jön, ha a cikkszámban
 *     szóköz van ("ELVOO 1000 Easy-Life Voogle 1000 ml"): 5 sor az 1422-ből.
 *     A cikkszám ilyenkor a kisbetűt nem tartalmazó vezető szavak sora, de
 *     az első szó után csak számjegyet tartalmazó szó mehet bele, így egy
 *     csupa nagybetűs márka ("MRROSSM ARKA myReef") a névben marad.
 *   - A hosszú megnevezés a következő sorba tör ("- 250 ml"): a cella nélküli
 *     rövid sor az előző tételhez tartozik.
 *
 * A PDF-ből olvasott számla MINDIG figyelmeztetést kap: nem géppel írt
 * adatból jött, hanem egy nyomtatási képből, és az ember a papírral vesse össze.
 */

const TABLE_HEADER = /^Artikelnr\b/;
const TABLE_END =
  /^(Zw\.summe|Rechnungsbetrag|Nettobetrag|Summe|Gesamt|Übertrag|=== oldal)/;
const LINE =
  /^(?<sku>[^|]{1,24}?) \| (?<name>.+?) \| (?<qty>\d+,\d{2}) \| (?<price>[\d.]+,\d{2})(?: \| (?<disc>\d+)%)? \| (?<total>-?[\d.]+,\d{2})$/;
const LINE_JOINED =
  /^(?<both>[^|]+?) \| (?<qty>\d+,\d{2}) \| (?<price>[\d.]+,\d{2})(?: \| (?<disc>\d+)%)? \| (?<total>-?[\d.]+,\d{2})$/;
const CODE_TOKEN = /^[A-Z0-9._/-]+$/;
// a lower-case code joined with its text ("fm14265ICP Fauna Marin ..."): a
// first word with a digit in it is a code, whatever its case
const MIXED_CODE_TOKEN = /^(?=.*\d)[A-Za-z0-9._/-]+$/;
const CODE_CONTINUATION = /^[A-Z0-9._/-]*\d[A-Z0-9._/-]*$/;

/** "1.136,70" -> 1136.7 */
function germanNumber(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

function germanDate(day: string, month: string, year: string): string {
  return `${year}-${month}-${day}`;
}

function splitCode(both: string): { code: string; name: string } | null {
  const tokens = both.split(/\s+/);
  if (
    !tokens[0] ||
    !(CODE_TOKEN.test(tokens[0]) || MIXED_CODE_TOKEN.test(tokens[0]))
  )
    return null;
  let k = 1;
  while (k < tokens.length - 1 && CODE_CONTINUATION.test(tokens[k]!)) k += 1;
  return {
    code: tokens.slice(0, k).join(" "),
    name: tokens.slice(k).join(" "),
  };
}

function readLines(lines: readonly string[]): {
  lines: SupplierInvoiceImportLine[];
  warnings: string[];
} {
  const out: SupplierInvoiceImportLine[] = [];
  const warnings: string[] = [];
  let inTable = false;
  let last: SupplierInvoiceImportLine | null = null;
  const push = (
    sku: string | null,
    name: string,
    groups: Record<string, string | undefined>,
  ) => {
    const description = name.trim();
    last = {
      lineNumber: out.length + 1,
      supplierSku: sku ? sku.trim() : null,
      ean: null,
      description,
      quantity: germanNumber(groups.qty!),
      unit: "db",
      unitNet: germanNumber(groups.price!),
      discountPercent: groups.disc ? Number(groups.disc) : null,
      lineNet: germanNumber(groups.total!),
      isCharge: isChargeDescription(description),
    };
    out.push(last);
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (TABLE_HEADER.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (TABLE_END.test(line)) {
      // a carried-over total ("Übertrag") keeps the table open across a page
      if (!line.startsWith("Übertrag")) inTable = false;
      last = null;
      continue;
    }
    const full = LINE.exec(line);
    if (full?.groups) {
      push(full.groups.sku!, full.groups.name!, full.groups);
      continue;
    }
    const joined = LINE_JOINED.exec(line);
    if (joined?.groups) {
      // a charge written without a code cell ("Versandkosten | 1,00 | ...")
      if (/^(rabatt|versand|porto|fracht)/i.test(joined.groups.both!)) {
        push(null, joined.groups.both!, joined.groups);
        continue;
      }
      const split = splitCode(joined.groups.both!);
      if (split) {
        push(split.code, split.name, joined.groups);
        continue;
      }
      // An item line whose code could not be split off. It is KEPT, without
      // a code: dropping it would make the invoice silently short (measured
      // on two 2022-2023 invoices before the mixed-case rule above existed:
      // 188.00 and 58.79 EUR missing, and nothing said so).
      push(null, joined.groups.both!, joined.groups);
      warnings.push(
        `${out.length}. sor: a cikkszám nem választható le a megnevezésről, ellenőrizd.`,
      );
      continue;
    }
    // a wrapped description line: no cell border, short, not a date line
    if (
      last &&
      !line.includes("|") &&
      line.length < 80 &&
      !/\d{2}\.\d{2}\.\d{4}/.test(line)
    )
      (last as SupplierInvoiceImportLine).description += ` ${line}`;
  }
  return { lines: out, warnings };
}

export const hertleinPdfAdapter: SupplierPdfAdapter = {
  key: "hertlein",
  // 62 of the 63 invoice PDFs ("Rechnung") came from this address; the 63rd
  // was our own forward. shop@der-aquaristik.shop sends order confirmations
  // with a privacy notice PDF, not invoices (exchange/a008-hertlein).
  senders: ["info@hertlein-aquaristik.de"],

  matches(lines) {
    return (
      lines.some((line) => line.includes("Hertlein Aquaristik")) &&
      lines.some((line) => TABLE_HEADER.test(line.trim()))
    );
  },

  parse(lines): SupplierInvoiceImportResult {
    const text = lines.join("\n");
    if (/Gutschrift/.test(text))
      throw new SupplierInvoiceImportError("CREDIT_NOTE");

    const number = /Rechnung(?:s)?[- ]?Nr\.?\s*[:|]?\s*\|?\s*(\d{5,7})/.exec(
      text,
    );
    const issued = /Rechnungsdatum:?\s*\|?\s*(\d{2})\.(\d{2})\.(\d{4})/.exec(
      text,
    );
    const due = /bis zum (\d{2})\.(\d{2})\.(\d{4})/.exec(text);
    const total = /Summe in €:?\s*\|?\s*([\d.]+,\d{2})/.exec(text);
    // the SELLER's id is "USt-ID:" in the footer; the buyer's own id on the
    // same page is "Ihre Ust-IdNr." and must never be read as the supplier's
    const vat = /USt-ID:\s*\|?\s*([A-Z]{2}\s?[\d ]{8,14}\d)/.exec(text);
    const vatId = normalizeVatId(vat?.[1]);
    // the footer's first cell carries the company name next to the phone
    const footer = lines.find((line) => /\|\s*Telefon:/.test(line));
    const name = footer ? footer.split("|")[0]!.trim() : "Hertlein Aquaristik";

    const { lines: invoiceLines, warnings: lineWarnings } = readLines(lines);
    if (invoiceLines.length === 0)
      throw new SupplierInvoiceImportError("NO_LINES");

    return {
      format: "PDF",
      supplier: { name, vatId, country: countryFromVatId(vatId) },
      invoiceNumber: number?.[1] ?? null,
      invoiceDate: issued
        ? germanDate(issued[1]!, issued[2]!, issued[3]!)
        : null,
      dueDate: due ? germanDate(due[1]!, due[2]!, due[3]!) : null,
      currency: /€|EUR/.test(text) ? "EUR" : null,
      netTotal: total ? germanNumber(total[1]!) : null,
      lines: invoiceLines,
      warnings: [
        "PDF-ből olvasva, nem XML-ből: vesd össze a sorokat a számlával mentés előtt.",
        ...lineWarnings,
      ],
    };
  },
};

/**
 * A HERTLEIN JELÖLT-PROFILJA a számlasor -> termék jelöltlistához (#1199
 * A-008 Stage A, `stage-a-v3`). Ami ebben áll, az a Hertleinről szóló, mért
 * tudás, a generátor maga (`@acropora/jev` `generateCandidates`) beszállító-
 * független.
 *
 *   - routing: a Hertlein cikkszám előtagja egy MÁRKÁT jelöl, soha nem
 *     terméket (`fm12345` -> Fauna Marin, `e1234567` -> Eheim);
 *   - álnév: a Hertlein a myAqua sort "Microbe-Lift" néven sorolja, a mi
 *     törzsünk ARKA néven (az ARKA forgalmazza a Microbe-Liftet). Mérve a DEV
 *     90 kódján (stage-a-v2).
 */
export const hertleinCandidateProfile: CandidateProfile = {
  brandRouting: [
    { pattern: /^fm\d{5}$/, words: ["fauna", "marin"] },
    { pattern: /^e\d{7}$/, words: ["eheim"] },
  ],
  brandAliases: [{ when: ["microbe", "lift"], alternatives: [["arka"]] }],
  titleWords: ["dr"],
};
