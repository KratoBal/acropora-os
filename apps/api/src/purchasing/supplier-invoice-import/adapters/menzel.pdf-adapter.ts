import type {
  SupplierInvoiceImportLine,
  SupplierInvoiceImportResult,
} from "@acropora/types";

import { isChargeDescription } from "../supplier-invoice-import.common.js";
import { SupplierInvoiceImportError } from "../supplier-invoice-import.error.js";
import type { SupplierPdfAdapter } from "../supplier-pdf-adapter.js";

/**
 * MCM MENZEL (Büchenbach, DE) -- the fourth supplier PDF adapter (Balázs,
 * 2026-09-30 10:10: Hanna, Menzel and Marine-Aquatics into the expected
 * arrivals; the Menzel is nautilus's).
 *
 * Measured on the ONE Menzel invoice there is (20260404, 2026-05-15, a
 * pick-up at a trade fair; the info@ mailbox holds no other in 180 days). No
 * XML is sent. What that invoice shows, and each rule below comes from it:
 *
 *   - One table, "Anzahl | Artnr. | Bezeichnung | MwSt. | Listenpreis |
 *     Rabatt | Einzelpreis | Gesamtpreis", German amounts ("2.233,94 €"). The
 *     header repeats on every page, and "Übertrag | N €" carries the running
 *     total over the page break: that line is no item.
 *   - The discount cell is there on some rows and missing on others ON THE SAME
 *     INVOICE ("0% | 4,90 € | 15% | 4,17 € | 16,68 €" and "0% | 57,50 € |
 *     57,50 € | 172,50 €"), so a row is read from the END: the line total and
 *     the unit price are the last two cells, the VAT rate is the first
 *     percentage after the article number.
 *   - A "(A)" mark can stand in its own cell, before the VAT rate or on the
 *     continuation line; it is not part of the name.
 *   - A name can break onto the next line ("Amblyeleotris aurora lg mit" +
 *     "Symbiosegrundel"), with or without a cell border. A CITES line
 *     ("Cites Nummer: DE-00219/26") follows some livestock rows: it is a
 *     permit number, not the name.
 *   - The unit price read is the one AFTER the discount (Einzelpreis): on all
 *     36 rows quantity x Einzelpreis is the line total to the cent. The list
 *     price with the discount would miss it by the rounding of the unit price.
 *   - "Summe" is the net total: the invoice is an intra-EU supply at 0% (§4
 *     Nr. 1b UStG).
 *
 * WHO IT IS FROM. The seller's name and VAT id are NOT in the text layer (the
 * letterhead is an image); only OUR VAT id is ("USt-ID-Nr.: HU23916229"). The
 * invoice is recognised by Menzel's SEPA creditor id (DE60ZZZ00002702958,
 * printed with the mandate reference) together with the table header. The
 * seller's VAT id is a constant: DE366930447, from Menzel's web imprint
 * (address and owner match the invoice mail's signature), checked valid in
 * VIES on 2026-09-30T09:18:27Z (acrobot; the German VIES returns validity
 * only, no name or address).
 *
 * WHAT ONE INVOICE CANNOT TELL, and is therefore NOT read or guessed:
 *   - the order reference: "zum Auftrag:" holds free text on this invoice
 *     ("15% Trade Fair Discount"), so `orderReference` stays null;
 *   - shipping: this was a pick-up, no charge line; a shipped invoice's box or
 *     freight line is a charge only if the shared word list knows its word;
 *   - a credit note: refused as CREDIT_NOTE on the word "Gutschrift", as with
 *     Hertlein, rather than read with an unknown layout.
 */

const CREDITOR_ID = "DE60ZZZ00002702958";
const SELLER_VAT = "DE366930447";
const TABLE_HEADER =
  /^Anzahl \| Artnr\. \| Bezeichnung \| MwSt\. \| Listenpreis \| Rabatt \| Einzelpreis \| Gesamtpreis$/;
const TABLE_END = /^(Summe \||Zu zahlender Betrag|=== oldal)/;
const EURO = /^-?\d{1,3}(?:\.\d{3})*,\d{2} €$/;
const PERCENT = /^\d+(?:,\d+)?%$/;
const QUANTITY = /^\d+(?:,\d+)?$/;

/** "2.233,94 €" -> 2233.94 */
function germanAmount(raw: string): number {
  return Number(
    raw.replace("€", "").trim().replace(/\./g, "").replace(",", "."),
  );
}

/** "15.05.2026" -> "2026-05-15" */
function germanDate(raw: string | undefined): string | null {
  const parts = raw ? /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw) : null;
  return parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : null;
}

/** A cell that only marks the row: "(A)", or "(A) ab 3 Stück/p.St.". */
const isMark = (cell: string) => cell.startsWith("(A)");

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
    const cells = line.split(" | ").map((cell) => cell.trim());
    if (cells[0] === "Übertrag") continue;
    // the permit number of a livestock row: not its name
    if (line.startsWith("Cites Nummer")) continue;

    const vatAt = cells.findIndex((cell, i) => i >= 2 && PERCENT.test(cell));
    if (
      cells.length >= 6 &&
      QUANTITY.test(cells[0]!) &&
      vatAt > 2 &&
      EURO.test(cells.at(-1)!) &&
      EURO.test(cells.at(-2)!)
    ) {
      const description = cells
        .slice(2, vatAt)
        .filter((cell) => !isMark(cell))
        .join(" ");
      last = {
        lineNumber: out.length + 1,
        supplierSku: cells[1] || null,
        ean: null,
        description,
        quantity: germanAmount(cells[0]!),
        unit: "db",
        unitNet: germanAmount(cells.at(-2)!),
        discountPercent: null,
        lineNet: germanAmount(cells.at(-1)!),
        isCharge: isChargeDescription(description),
      };
      out.push(last);
      continue;
    }
    // any other table line continues the row above it
    if (last !== null) {
      const tail = cells.filter((cell) => cell && !isMark(cell)).join(" ");
      if (tail) {
        last.description = `${last.description} ${tail}`;
        last.isCharge = isChargeDescription(last.description);
      }
    }
  }
  return out;
}

export const menzelPdfAdapter: SupplierPdfAdapter = {
  key: "menzel",
  // the one invoice mail (2026-05-15)
  senders: ["accounting@mcm-menzel.de"],

  matches(lines) {
    return (
      lines.some((line) => line.includes(CREDITOR_ID)) &&
      lines.some((line) => TABLE_HEADER.test(line.trim()))
    );
  },

  parse(lines): SupplierInvoiceImportResult {
    const text = lines.map((line) => line.trim()).join("\n");
    if (/Gutschrift/.test(text))
      throw new SupplierInvoiceImportError("CREDIT_NOTE");

    const number = /^Rechnungs-Nr\.: \| (\S+)/m.exec(text);
    const date = /^Datum: \| (\d{2}\.\d{2}\.\d{4})/m.exec(text);
    const total = /^Summe \| (-?[\d.]+,\d{2}) €/m.exec(text);

    const invoiceLines = readLines(lines);
    if (invoiceLines.length === 0)
      throw new SupplierInvoiceImportError("NO_LINES");

    return {
      format: "PDF",
      supplier: { name: "MCM Menzel", vatId: SELLER_VAT, country: "DE" },
      invoiceNumber: number?.[1] ?? null,
      invoiceDate: germanDate(date?.[1]),
      dueDate: null,
      currency: /€/.test(text) ? "EUR" : null,
      netTotal: total ? germanAmount(total[1]!) : null,
      lines: invoiceLines,
      orderReference: null,
      documentKind: "INVOICE",
      warnings: [
        "PDF-ből olvasva, nem XML-ből: vesd össze a sorokat a számlával mentés előtt.",
      ],
    };
  },
};
