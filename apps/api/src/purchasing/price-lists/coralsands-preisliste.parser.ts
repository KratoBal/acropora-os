import { parseCommaDecimal } from "./decimal-text.js";
import { parseDelimited } from "./delimited-text.js";
import {
  EntryCollector,
  cell,
  columnIndex,
  isBlankRecord,
} from "./entry-collector.js";
import { normalizeGtin } from "./gtin.js";
import {
  PriceListParseError,
  type ParsedPriceList,
} from "./price-list.types.js";

/**
 * CORALSANDS PREISLISTE (measured on the September 2026 file, 2026-10-23).
 *
 * Comma-separated with a comma DECIMAL (`"566,07"`, quoted), eight columns:
 * `Hersteller, Artikelnummer, Artikelname, Händler, UVP, GTIN, TARIC-Code, UPC`.
 * Rows may be shorter than the header (a row can stop after `UVP`), so a missing
 * cell is an empty cell. The German and the English file are identical
 * (acrobot's measurement, memory 2471): one parser serves both.
 *
 * `Händler` is the dealer price, the one we pay. The file is two exports
 * joined: record 746 repeats the header with the third price column renamed
 * `JTL-Wawi: Händler Netto`. That name is evidence that the dealer column is a
 * NET price, but it is the file's own word for one block of it, not our
 * measurement; the screen therefore says "listaár" until a Coralsands invoice
 * line confirms it (acrobot, 2026-10-23). A repeated header is recognised by
 * its `Artikelnummer` cell and counted as skipped, not rejected.
 */
export function parseCoralsandsPreisliste(text: string): ParsedPriceList {
  const records = parseDelimited(text, ",");
  const headerAt = records.findIndex(
    (record) =>
      columnIndex(record, ["Artikelnummer"]) >= 0 &&
      columnIndex(record, ["Artikelname"]) >= 0 &&
      columnIndex(record, ["Händler", "JTL-Wawi: Händler Netto"]) >= 0,
  );
  if (headerAt < 0) throw new PriceListParseError("HEADER_NOT_FOUND");
  const header = records[headerAt]!;
  const brandAt = columnIndex(header, ["Hersteller"]);
  const codeAt = columnIndex(header, ["Artikelnummer"]);
  const nameAt = columnIndex(header, ["Artikelname"]);
  const priceAt = columnIndex(header, ["Händler", "JTL-Wawi: Händler Netto"]);
  const retailAt = columnIndex(header, ["UVP"]);
  const gtinAt = columnIndex(header, ["GTIN"]);

  const collector = new EntryCollector();
  for (let i = headerAt + 1; i < records.length; i += 1) {
    const record = records[i]!;
    const rowNumber = i + 1;
    if (isBlankRecord(record)) {
      collector.skip();
      continue;
    }
    const code = cell(record, codeAt);
    if (code.toLowerCase() === "artikelnummer") {
      collector.skip();
      continue;
    }
    if (code === "") {
      collector.reject(rowNumber, "NO_CODE");
      continue;
    }
    const priceText = cell(record, priceAt);
    if (priceText === "") {
      collector.reject(rowNumber, "NO_PRICE");
      continue;
    }
    const unitPrice = parseCommaDecimal(priceText);
    if (unitPrice === null) {
      collector.reject(rowNumber, "BAD_PRICE");
      continue;
    }
    const retailText = cell(record, retailAt);
    const name = cell(record, nameAt);
    const brand = cell(record, brandAt);
    collector.add({
      rowNumber,
      supplierSku: code,
      supplierName: name === "" ? null : name,
      brand: brand === "" ? null : brand,
      gtin: normalizeGtin(cell(record, gtinAt)),
      unitPrice,
      listRetailPrice: retailText === "" ? null : parseCommaDecimal(retailText),
    });
  }
  return collector.result("CORALSANDS_PREISLISTE");
}
