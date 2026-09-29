import type {
  SupplierInvoiceImportLine,
  SupplierInvoiceImportResult,
} from "@acropora/types";

import {
  countryFromVatId,
  isChargeDescription,
  normalizeVatId,
} from "../supplier-invoice-import.common.js";
import { SupplierInvoiceImportError } from "../supplier-invoice-import.error.js";
import type { SupplierPdfAdapter } from "../supplier-pdf-adapter.js";

/**
 * DE JONG MARINELIFE -- a második beszállítói PDF-illesztő (#1199 P-026).
 *
 * A minta a 2019 és 2026 közötti 98 számlájukból jön (acrobot exportja,
 * `exchange/a008-dejong`, 141 levél, az emlékeztetők nélkül): a 93 számlán a
 * tételsorok összege centre egyezik a nettó végösszeggel, az 5 jóváírást ez az
 * illesztő elutasítja. XML-t nem küldenek (0 a 141 levél mellékletei között). A
 * táblázat három fejléc-változatban jön (HS-kód nélkül 22, HS-kóddal 74,
 * származási országgal is 2); a sorminta mindet viszi. A mért nehéz esetek a
 * 2462 tételsorból:
 *
 *   - Többoldalas számlán a következő oldal egy áthozott összeggel indul
 *     ("Transport | € | 6.417,61"): a táblázat nem zárul le rajta, és tétel
 *     sem lesz belőle.
 *   - A cikkszám-oszlop kb. 20 karakteres, a hosszabb kód vége a következő
 *     sorba törik, egymagában ("PHILIPS-2020-CONTROL" + "LER"): a rövid,
 *     csupa nagybetűs darab az előző sor cikkszámához tartozik. 9 eset, mind
 *     19-20 karakteres kód után.
 *   - Kedvezményes soron az ár és a kedvezmény egy cellában jön
 *     ("428,16 10,00%"): 25 eset; egyszer % jel nélkül ("| 100,00 |").
 *   - Hosszú kód a megnevezéssel egy cellában ("DJM-075015-B-BIO-BOX
 *     Bio-based plastic bag set"): az első szó a kód. 2 eset, az egyiknél
 *     utána még egy HS-kód cella is áll, és az nem lehet a megnevezés.
 *   - Egy "!" jel a kód mellett ("AO-PAR-010152 !"): nem a kód része. 1 eset.
 *   - A kód szóközt is tartalmazhat ("DJM-072015 B", "AI-Prime16HD black"):
 *     ahogy a cellában áll, úgy marad. 4 eset.
 *   - Kód nélküli tétel: a cikkszám cellájában egy pont áll (élőállat,
 *     egyedi tétel). Kód nélkül marad.
 *   - A hosszú megnevezés két cellára esik szét ("Balling Light Calcium-Mix |
 *     - 2 kg"): a megnevezés a cellahatáron át tart, és egy szóközzel
 *     egyesül. 34 eset.
 *   - CITES-engedélyszám és megjegyzés a tételek között ("Cites Nr:...",
 *     "Outlet product, ..."): nem tétel, és nem is a megnevezés része.
 *
 * Az eladó adószáma a "VAT No.:" (kettősponttal) mezőben áll. Ugyanezen a
 * lapon a VEVŐÉ (a mienk) "VAT No. |" alakban, kettőspont nélkül: azt soha nem
 * szabad a szállítóénak olvasni (32 számlán mindkettő ott van).
 */

const TABLE_HEADER = /^Qty \| Item Code \| Description\b/;
const TABLE_END = /^(Subtotal|Please pay|Our terms|=== oldal)/;
const AMOUNTS = String.raw`\| € \| (?<price>-?[\d.]+,\d{1,5})(?: \| | )(?<disc>-?\d+,\d{2})%? \| € \| (?<total>-?[\d.]+,\d{2})$`;
const LINE = new RegExp(
  String.raw`^(?<qty>-?\d+(?:,\d+)?) \| (?<sku>[^|]+?) \| (?<name>.+?)(?: \| (?<origin>[A-Z]{2}))?(?: \| (?<hs>\d{6,10}))? ` +
    AMOUNTS,
);
const LINE_JOINED = new RegExp(
  String.raw`^(?<qty>-?\d+(?:,\d+)?) \| (?<both>[^|]+?) ` + AMOUNTS,
);
const CODE_TOKEN = /^(?=.*[\d-])[A-Z0-9][A-Za-z0-9._/-]*$/;
const CODE_TAIL = /^[A-Z0-9-]{1,6}$/;
// De Jong's own charge codes: "SC-090012 Schenker 1/2 pallet" says no
// "shipping", the code does
const CHARGE_CODE = /^SC-\d+$/;

/** "1.025,00" -> 1025 */
function dutchNumber(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

/** "23-09-2026" -> "2026-09-23" */
function dutchDate(raw: string | undefined): string | null {
  const parts = raw ? /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw) : null;
  return parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : null;
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
    sku: string,
    name: string,
    groups: Record<string, string | undefined>,
  ) => {
    // a trailing "!" is a mark printed next to the code, not part of it
    const trimmed = sku.replace(/\s+!+$/, "").trim();
    const code = trimmed === "." ? null : trimmed;
    // a long description can come split over two cells ("Calcium-Mix | - 2 kg")
    const description = name.replace(/ \| /g, " ").trim();
    const discount = dutchNumber(groups.disc!);
    last = {
      lineNumber: out.length + 1,
      supplierSku: code,
      ean: null,
      description,
      quantity: dutchNumber(groups.qty!),
      unit: "db",
      unitNet: dutchNumber(groups.price!),
      discountPercent: discount === 0 ? null : discount,
      lineNet: dutchNumber(groups.total!),
      isCharge:
        (code !== null && CHARGE_CODE.test(code)) ||
        isChargeDescription(description),
    };
    out.push(last);
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (TABLE_HEADER.test(line)) {
      inTable = true;
      last = null;
      continue;
    }
    // the carried-over total at the top of a page ("Transport | € | ...")
    // is neither an end nor an item, so it passes without a rule of its own
    if (!inTable) continue;
    if (TABLE_END.test(line)) {
      inTable = false;
      last = null;
      continue;
    }
    const full = LINE.exec(line);
    // a code joined with its text, followed by an HS code cell: the "name"
    // is then only the HS code ("DJM-075012-T-BIO-BOX Bio-based ... | 39239000")
    const hsAsName =
      full?.groups && !full.groups.hs && /^\d{6,10}$/.test(full.groups.name!);
    if (full?.groups && !hsAsName) {
      push(full.groups.sku!, full.groups.name!, full.groups);
      continue;
    }
    const joined = hsAsName ? full : LINE_JOINED.exec(line);
    if (joined?.groups) {
      const [first, ...rest] = (joined.groups.both ?? joined.groups.sku!).split(
        /\s+/,
      );
      if (first && rest.length > 0 && CODE_TOKEN.test(first)) {
        push(first, rest.join(" "), joined.groups);
      } else {
        // kept without a code: a dropped line would make the invoice short
        push(".", joined.groups.both!, joined.groups);
        warnings.push(
          `${out.length}. sor: a cikkszám nem választható le a megnevezésről, ellenőrizd.`,
        );
      }
      continue;
    }
    // the tail of a code that did not fit its column
    if (last !== null && CODE_TAIL.test(line)) {
      const item: SupplierInvoiceImportLine = last;
      if (item.supplierSku !== null) item.supplierSku += line;
      last = null;
      continue;
    }
    // anything else between the lines (a CITES number, a note) is not an item
  }
  return { lines: out, warnings };
}

export const deJongPdfAdapter: SupplierPdfAdapter = {
  key: "dejong",

  matches(lines) {
    return (
      // the company name is text on only 2 of the 98 invoices, a logo on the rest; the
      // mail domain is text on every one of them
      lines.some((line) => line.includes("dejongmarinelife.nl")) &&
      lines.some((line) => TABLE_HEADER.test(line.trim()))
    );
  },

  parse(lines): SupplierInvoiceImportResult {
    const text = lines.map((line) => line.trim()).join("\n");
    if (/^Credit note$/m.test(text))
      throw new SupplierInvoiceImportError("CREDIT_NOTE");

    const number = /^Invoice No\. \| : \| (\d{6,10})/m.exec(text);
    const due = /\| Due Date \| : \| (\d{2}-\d{2}-\d{4})/.exec(text);
    const issued = /^Invoice Date \| : \| (\d{2}-\d{2}-\d{4})/m.exec(text);
    // "Subtotal | Amount excl. VAT | ..." heads the row of totals below it
    const total =
      /Total to be paid\n€ \| -?[\d.]+,\d{2} \| € \| (-?[\d.]+,\d{2})/.exec(
        text,
      );
    // the SELLER's id: "VAT No.:" with a colon. The buyer's own id on the same
    // page is "VAT No. |" without one.
    const vat = /VAT No\.: \| ([A-Z]{2}[0-9A-Z]{2,13})/.exec(text);
    const vatId = normalizeVatId(vat?.[1]);

    const { lines: invoiceLines, warnings: lineWarnings } = readLines(lines);
    if (invoiceLines.length === 0)
      throw new SupplierInvoiceImportError("NO_LINES");

    return {
      format: "PDF",
      supplier: {
        name: "De Jong Marinelife B.V.",
        vatId,
        country: countryFromVatId(vatId),
      },
      invoiceNumber: number?.[1] ?? null,
      invoiceDate: dutchDate(issued?.[1]),
      dueDate: dutchDate(due?.[1]),
      currency: /€|EUR/.test(text) ? "EUR" : null,
      netTotal: total ? dutchNumber(total[1]!) : null,
      lines: invoiceLines,
      warnings: [
        "PDF-ből olvasva, nem XML-ből: vesd össze a sorokat a számlával mentés előtt.",
        ...lineWarnings,
      ],
    };
  },
};
