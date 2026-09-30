import type {
  SupplierInvoiceImportLine,
  SupplierInvoiceImportResult,
} from "@acropora/types";

import {
  countryFromVatId,
  isChargeDescription,
  round2,
} from "../supplier-invoice-import.common.js";
import { SupplierInvoiceImportError } from "../supplier-invoice-import.error.js";
import type {
  SupplierPdfAdapter,
  SupplierPdfParseOptions,
} from "../supplier-pdf-adapter.js";

/**
 * MARINE AQUATICS (Ptýrov, CZ) -- the fourth supplier PDF adapter (Balázs,
 * 2026-09-30, acrobot 24888).
 *
 * Measured on the 8 PDFs of 7 mails from April to September 2026
 * (`exchange/beszallitok/marine-aquatics`, from the info@ mailbox): 5
 * invoices, 1 of them sent twice, 1 account invoice, 1 shipping invoice and
 * 1 proforma. All are printed by the same accounting program (Money S3). No
 * XML is sent. The cases the rules below come from:
 *
 *   - One table, "Item description | Catalog.number | Unit Qty | excl. VAT |
 *     Discount | VAT % | ... | Total". A goods row is "name | code | qty | unit
 *     | unit price | discount | % | VAT rate | VAT | total". Amounts use the
 *     Czech form ("3 698,88": a space groups the thousands). A dotted rule
 *     stands between the rows on invoices; it is not a row.
 *   - A shipping row has no unit ("DPD - ZONE I (Export) trans - HUNGARY |
 *     1,00 | 21,10 | ..."), and most have no code either; one does ("DPD
 *     transportation up to 18kg - HUNGARY | DPD HU18 | 1,00 | 9,90 | ...").
 *   - An account invoice settles the proforma's prepayment with a negative
 *     row ("PRE-PAYMENT 52600057 (TAX ...) | 1,00 | -359,40 | ..."). That row
 *     is a payment, not goods: it is skipped, and the net total is the TOTAL
 *     row's (359,40), not the 0,00 still due.
 *   - The document total is rounded to a whole euro ("Note: The amounts are
 *     rounded."): 644,10 of lines give "TOTAL | 644,00", 101,90 give 102,00,
 *     4 248,28 give 4 249,00. The difference becomes a charge line, or every
 *     invoice would show a warning; a difference of 1 euro or more is not
 *     rounding, and is left for the warning.
 *   - The order number stands on the invoice and the proforma alike ("Order
 *     No.: | 18067"); it ties them together (`orderReference`). The shipping
 *     invoice has an empty "Order No.:": it is keyed by its own number.
 *   - The proforma ("PROFORMA INVOICE | 52600057") has the same table. It is
 *     refused by default, read only when the caller asks (`allowProforma`,
 *     the mailbox watcher), with `documentKind: "PROFORMA"`.
 *
 * The seller's VAT id is the first "Tax identity: | CZ02622386"; our own id
 * stands on the same page in the same form ("Tax identity: | HU..."), so
 * only the seller's known id is read.
 */

const SELLER_VAT = "CZ02622386";
const TABLE_HEADER = /^Item description \| Catalog\.number \| Unit Qty \|/;
const TABLE_END =
  /^(Price \| VAT \| Total|Currency: [A-Z]{3} \| Price|Discount %:|VAT Rate \||TOTAL \||=== oldal)/;
const DOTTED_RULE = /^\.{10,}/;
const NUMBER = String.raw`-?\d{1,3}(?: \d{3})*(?:,\d+)?`;
const NUMBER_CELL = new RegExp(`^${NUMBER}$`);
const UNIT_CELL = /^[a-z]{1,5}$/;
const PREPAYMENT = /^PRE-PAYMENT\b/i;
const UNIT_LABELS: Record<string, string> = { pcs: "db", kg: "kg" };

/** "3 698,88" -> 3698.88 */
function czechNumber(raw: string): number {
  return Number(raw.replace(/\s/g, "").replace(",", "."));
}

/** "20.04.2026" -> "2026-04-20" */
function czechDate(raw: string | undefined): string | null {
  const parts = raw ? /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw) : null;
  return parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : null;
}

interface Row {
  name: string;
  sku: string | null;
  quantity: number;
  unit: string | null;
  unitNet: number;
  discount: number;
  total: number;
}

/**
 * One table row, read from its right end: the last five cells are always
 * "discount | % | VAT rate | VAT | total", before them the unit price, then
 * an optional unit, the quantity, an optional code, and the name.
 */
function readRow(line: string): Row | null {
  const cells = line.split(" | ").map((cell) => cell.trim());
  if (cells.length < 8) return null;
  const tail = cells.slice(-5);
  if (
    !NUMBER_CELL.test(tail[0]!) ||
    tail[1] !== "%" ||
    !NUMBER_CELL.test(tail[2]!) ||
    !NUMBER_CELL.test(tail[3]!) ||
    !NUMBER_CELL.test(tail[4]!)
  )
    return null;
  const head = cells.slice(0, -5);
  const price = head.pop()!;
  if (!NUMBER_CELL.test(price)) return null;
  const unit = UNIT_CELL.test(head.at(-1) ?? "") ? head.pop()! : null;
  const quantity = head.pop();
  if (quantity === undefined || !NUMBER_CELL.test(quantity)) return null;
  if (head.length === 0 || head.length > 2) return null;
  return {
    name: head[0]!,
    sku: head[1] ?? null,
    quantity: czechNumber(quantity),
    unit,
    unitNet: czechNumber(price),
    discount: czechNumber(tail[0]!),
    total: czechNumber(tail[4]!),
  };
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
    if (!inTable || DOTTED_RULE.test(line)) continue;
    if (TABLE_END.test(line)) {
      inTable = false;
      last = null;
      continue;
    }
    const row = readRow(line);
    if (row) {
      last = null;
      if (PREPAYMENT.test(row.name)) continue;
      last = {
        lineNumber: out.length + 1,
        supplierSku: row.sku,
        ean: null,
        description: row.name,
        quantity: row.quantity,
        unit: row.unit ? (UNIT_LABELS[row.unit] ?? row.unit) : "db",
        unitNet: row.unitNet,
        discountPercent: row.discount === 0 ? null : row.discount,
        lineNet: row.total,
        // a row without a unit is a service row: every one of them in the
        // samples is transport ("DPD ...", "RABEN pallet shipping")
        isCharge: row.unit === null || isChargeDescription(row.name),
      };
      out.push(last);
      continue;
    }
    // a line without a cell border continues the row above it
    if (last !== null && !line.includes("|"))
      last.description = `${last.description} ${line}`;
  }
  return out;
}

export const marineAquaticsPdfAdapter: SupplierPdfAdapter = {
  key: "marine-aquatics",
  // all 7 mails (April-September 2026, acrobot's search of info@)
  senders: ["r.macek@marine-aquatics.eu"],

  matches(lines) {
    return (
      lines.some((line) => line.includes(SELLER_VAT)) &&
      lines.some((line) => TABLE_HEADER.test(line.trim()))
    );
  },

  parse(lines, options?: SupplierPdfParseOptions): SupplierInvoiceImportResult {
    const text = lines.map((line) => line.trim()).join("\n");
    const proforma = /^PROFORMA INVOICE \| /m.test(text);
    if (proforma && !options?.allowProforma)
      throw new SupplierInvoiceImportError("PROFORMA");

    const number = proforma
      ? /^PROFORMA INVOICE \| (\S+)/m.exec(text)
      : /^INVOICE - TAX DOCUMENT \| (\S+)/m.exec(text);
    const order = /^Order No\.: \| (\S+)/m.exec(text);
    const date = /^Invoice date: \| (\d{2}\.\d{2}\.\d{4})/m.exec(text);
    const due = /^Due date: \| (\d{2}\.\d{2}\.\d{4})/m.exec(text);
    const total = new RegExp(String.raw`^TOTAL \| (${NUMBER}) \|`, "m").exec(
      text,
    );
    const currency =
      /^Currency: ([A-Z]{3})\b/m.exec(text) ??
      new RegExp(String.raw`Total amount: \| ${NUMBER} \| ([A-Z]{3})\b`).exec(
        text,
      ) ??
      /\| VAT % \| ([A-Z]{3}) \| Total$/m.exec(text);
    const vatId = text.includes(SELLER_VAT) ? SELLER_VAT : null;

    const invoiceLines = readLines(lines);
    if (invoiceLines.length === 0)
      throw new SupplierInvoiceImportError("NO_LINES");
    const netTotal = total ? czechNumber(total[1]!) : null;
    if (netTotal !== null) {
      const rounding = round2(
        netTotal - invoiceLines.reduce((sum, line) => sum + line.lineNet, 0),
      );
      if (rounding !== 0 && Math.abs(rounding) < 1)
        invoiceLines.push({
          lineNumber: invoiceLines.length + 1,
          supplierSku: null,
          ean: null,
          description: "Kerekítés",
          quantity: 1,
          unit: "db",
          unitNet: rounding,
          discountPercent: null,
          lineNet: rounding,
          isCharge: true,
        });
    }

    return {
      format: "PDF",
      supplier: {
        name: "Marine Aquatics s.r.o.",
        vatId,
        country: countryFromVatId(vatId),
      },
      invoiceNumber: number?.[1] ?? null,
      invoiceDate: czechDate(date?.[1]),
      dueDate: czechDate(due?.[1]),
      currency: currency?.[1] ?? null,
      netTotal,
      lines: invoiceLines,
      orderReference: order?.[1] ?? null,
      documentKind: proforma ? "PROFORMA" : "INVOICE",
      warnings: [
        "PDF-ből olvasva, nem XML-ből: vesd össze a sorokat a számlával mentés előtt.",
      ],
    };
  },
};
