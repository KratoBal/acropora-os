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
import type {
  SupplierPdfAdapter,
  SupplierPdfParseOptions,
} from "../supplier-pdf-adapter.js";

/**
 * AQUARIOOM (Diemeringen, FR) -- the third supplier PDF adapter (Balázs,
 * 2026-09-30 06:02 UTC).
 *
 * Measured on the 5 invoices and 5 proformas from June to September 2026
 * (`exchange/aquarioom/nyers`, from the info@ mailbox). No XML is sent. The
 * cases the rules below come from:
 *
 *   - One table, "Reference | Description | Qty | Unit Price | Amount | VAT",
 *     amounts in the French form ("1 094,66": a space groups the thousands).
 *   - The same file carries a DELIVERY NOTE after the invoice with the same
 *     lines ("Reference | Description | Qty | Control"): its header differs,
 *     so its lines never enter the table. Read them, and every line would
 *     come twice.
 *   - The first row is the order reference ("CDE | AQUARIOOM Order n° 13858 |
 *     0,00 | ..."), not goods; the same order number stands on the proforma.
 *   - A long code breaks after its dash ("AA- | Smart ATO NANO G2 | ..." and
 *     "SATO270D" alone on the next line): 1 case. A long description breaks
 *     too ("... Puffer" + "Limited Edition", "... 15x20cm 2 pc. and" +
 *     "12x15cm 2 pc."): 2 cases. Neither continuation line has a "|".
 *   - A free after-sales replacement: an empty "0,00 | 0,00 | 0,00 | 0,00"
 *     row and a "Free - SAV 875 | 0,00 | ..." note, then the replaced part at
 *     0,00 ("M-GP3016CE ... | 1 | 0,00 | 0,00 | 0,00"). The part is received
 *     goods and stays a line; the two notes are not.
 *   - Shipping is not a table row but "Carriage | 21,80 €" among the totals
 *     (4 of 5 invoices). It becomes a charge line, or the lines would fall
 *     short of the net total by exactly that amount.
 *   - The proforma ("Proforma Invoice", "Proforma No. : | CM9201") has the
 *     SAME table, byte for byte (CM9201 and FA00009139 carry equal rows). It
 *     is not an invoice to receive: refused by default, read only when the
 *     caller asks (`allowProforma`, the mailbox watcher), with
 *     `documentKind: "PROFORMA"`. The order number on the first row links
 *     the proforma to its later invoice (`orderReference`).
 *
 * The seller's VAT id is "TVA Intra. : FR67529301244"; our own id on the
 * same page is "VAT Reg No. : HU23916229" and is never read as the seller's.
 */

const SELLER_VAT = "FR67529301244";
const TABLE_HEADER =
  /^Reference \| Description \| Qty \| Unit Price \| Amount \| VAT$/;
const TABLE_END =
  /^(Rate \||\d+ sur \d+|Bankverbindung|Bank Account|Banque|WEEE|=== oldal)/;
const NUMBER = String.raw`-?\d{1,3}(?: \d{3})*(?:,\d+)?`;
const ROW = new RegExp(
  String.raw`^(?<sku>[^|]*?) \| (?<name>[^|]+?) \| (?<qty>${NUMBER}) \| (?<price>${NUMBER}) \| (?<total>${NUMBER}) \| (?<vat>${NUMBER})$`,
);
const ORDER_ROW = /^CDE \| AQUARIOOM Order n° \d+/;
const CODE_TAIL = /^[A-Z0-9][A-Z0-9._/-]*$/;

/** "1 094,66" -> 1094.66 */
function frenchNumber(raw: string): number {
  return Number(raw.replace(/\s/g, "").replace(",", "."));
}

/** "30/09/2026" -> "2026-09-30" */
function frenchDate(raw: string | undefined): string | null {
  const parts = raw ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw) : null;
  return parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : null;
}

function readLines(lines: readonly string[]): SupplierInvoiceImportLine[] {
  const out: SupplierInvoiceImportLine[] = [];
  let inTable = false;
  let last: SupplierInvoiceImportLine | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (TABLE_HEADER.test(line)) {
      inTable = true;
      last = null;
      continue;
    }
    if (!inTable) continue;
    if (TABLE_END.test(line)) {
      inTable = false;
      last = null;
      continue;
    }
    if (ORDER_ROW.test(line)) continue;
    const row = ROW.exec(line);
    if (row?.groups) {
      const sku = row.groups.sku!.trim();
      // the free-replacement note ("Free - SAV 875 | 0,00 | ...") has no
      // second text cell, so it never matches ROW; a matched row without a
      // code is kept, so no line of the invoice is lost
      last = {
        lineNumber: out.length + 1,
        supplierSku: sku === "" ? null : sku,
        ean: null,
        description: row.groups.name!.trim(),
        quantity: frenchNumber(row.groups.qty!),
        unit: "db",
        unitNet: frenchNumber(row.groups.price!),
        discountPercent: null,
        lineNet: frenchNumber(row.groups.total!),
        isCharge: isChargeDescription(row.groups.name!),
      };
      out.push(last);
      continue;
    }
    // a line without a cell border continues the row above it
    if (last !== null && !line.includes("|")) {
      if (last.supplierSku?.endsWith("-") && CODE_TAIL.test(line))
        last.supplierSku += line;
      else last.description = `${last.description} ${line}`;
    }
    // any other bordered line (the empty "0,00 | 0,00 | 0,00 | 0,00" row)
    // is not an item
  }
  return out;
}

export const aquarioomPdfAdapter: SupplierPdfAdapter = {
  key: "aquarioom",
  // all 10 mails (5 invoices, 5 proformas), June-September 2026 (acrobot's brief)
  senders: ["contact@aquarioom.com"],

  matches(lines) {
    return (
      lines.some((line) => line.includes(SELLER_VAT)) &&
      lines.some((line) => TABLE_HEADER.test(line.trim()))
    );
  },

  parse(lines, options?: SupplierPdfParseOptions): SupplierInvoiceImportResult {
    const text = lines.map((line) => line.trim()).join("\n");
    const proforma = /^Proforma Invoice$/m.test(text);
    if (proforma && !options?.allowProforma)
      throw new SupplierInvoiceImportError("PROFORMA");

    const number = proforma
      ? /^Proforma No\. : \| (\S+)/m.exec(text)
      : /^Invoice No\. : \| (\S+)/m.exec(text);
    const order = /^CDE \| AQUARIOOM Order n° (\d+)/m.exec(text);
    const date = /^Date : \| (\d{2}\/\d{2}\/\d{4})/m.exec(text);
    // the net total: "Total HT Net" where there is carriage; without it, the
    // FIRST "Grand Total" (the second is what is still to pay after the
    // prepayment, "Acomptes", and is 0,00)
    const net =
      new RegExp(String.raw`Total HT Net \| (${NUMBER}) €`).exec(text) ??
      new RegExp(String.raw`Grand Total \| (${NUMBER}) €`).exec(text);
    const carriage = new RegExp(
      String.raw`^Carriage \| (${NUMBER}) €`,
      "m",
    ).exec(text);
    const vat = /TVA Intra\. : ([A-Z]{2}[0-9A-Z]{2,13})/.exec(text);
    const vatId = normalizeVatId(vat?.[1]);

    const invoiceLines = readLines(lines);
    if (invoiceLines.length === 0)
      throw new SupplierInvoiceImportError("NO_LINES");
    if (carriage) {
      const amount = frenchNumber(carriage[1]!);
      invoiceLines.push({
        lineNumber: invoiceLines.length + 1,
        supplierSku: null,
        ean: null,
        description: "Carriage",
        quantity: 1,
        unit: "db",
        unitNet: amount,
        discountPercent: null,
        lineNet: amount,
        isCharge: true,
      });
    }

    return {
      format: "PDF",
      supplier: {
        name: "Aquarioom",
        vatId,
        country: countryFromVatId(vatId),
      },
      invoiceNumber: number?.[1] ?? null,
      invoiceDate: frenchDate(date?.[1]),
      dueDate: null,
      currency: /€/.test(text) ? "EUR" : null,
      netTotal: net ? frenchNumber(net[1]!) : null,
      lines: invoiceLines,
      orderReference: order?.[1] ?? null,
      documentKind: proforma ? "PROFORMA" : "INVOICE",
      warnings: [
        "PDF-ből olvasva, nem XML-ből: vesd össze a sorokat a számlával mentés előtt.",
      ],
    };
  },
};

/**
 * THE AQUARIOOM CANDIDATE PROFILE: its code prefix names the brand ("M-GP3010",
 * "FM-14405", "AA-SS100"), while the line text often starts with the product
 * ("Smart Stir", "Pipet Dosing Set"). Only prefixes whose brand words occur
 * in our catalogue names are routed (counted 2026-09-30 on the 1927-variant
 * export): maxspect 91, fauna marin 146, flipper 21, autoaqua 17, newa 6,
 * "tropic creations" (the Roller Clean line) 12. "A-" (Aquarioom's own) is
 * not routed: 1 product carries that name, so routing would narrow wrongly.
 */
export const aquarioomCandidateProfile: CandidateProfile = {
  brandRouting: [
    { pattern: /^mj?-/, words: ["maxspect"] },
    { pattern: /^fm-/, words: ["fauna", "marin"] },
    { pattern: /^f-/, words: ["flipper"] },
    { pattern: /^aa-/, words: ["autoaqua"] },
    { pattern: /^ne-/, words: ["newa"] },
    { pattern: /^tc-/, words: ["tropic", "creations"] },
  ],
  brandAliases: [],
};
