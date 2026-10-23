import { parseSpreadsheetDotDecimal } from "./decimal-text.js";
import { parseDelimited } from "./delimited-text.js";
import {
  EntryCollector,
  cell,
  columnIndex,
  isBlankRecord,
} from "./entry-collector.js";
import {
  PriceListParseError,
  type ParsedPriceList,
} from "./price-list.types.js";

/**
 * DE JONG MARINELIFE WEEKLY STOCKLIST (measured on week 41, 2026-10-23).
 *
 * Comma-separated. The file starts with 13 lines of letterhead and prose
 * (company, phone, "WEEK 41", paragraphs), then the header
 * `Code,Description,Price,Stock,Order`, then the rows. The header is FOUND, not
 * assumed at a line number: the letterhead changes from week to week.
 *
 * `Price` is a dot decimal exported from a spreadsheet, so 575 of the 7075
 * prices carry binary-float noise (`138.88999999999999`); they are read with
 * `parseSpreadsheetDotDecimal`, which cleans exactly that and nothing else.
 * Balázs's decision (2026-10-22) is that on this
 * list the prices are OUR purchase prices. There is no barcode column: a De
 * Jong row pairs by its supplier code or by name, never by EAN.
 *
 * Rows with a title only (`TANKBRED FISHES:`) have no description and no price:
 * they are section titles, counted as skipped. A row that names a product but
 * has no price is REJECTED (NO_PRICE), not skipped, because it is a product
 * someone may look for.
 */
export function parseDeJongStocklist(text: string): ParsedPriceList {
  const records = parseDelimited(text, ",");
  const headerAt = records.findIndex(
    (record) =>
      cell(record, 0).toLowerCase() === "code" &&
      cell(record, 1).toLowerCase() === "description" &&
      cell(record, 2).toLowerCase() === "price",
  );
  if (headerAt < 0) throw new PriceListParseError("HEADER_NOT_FOUND");
  const header = records[headerAt]!;
  const codeAt = columnIndex(header, ["Code"]);
  const nameAt = columnIndex(header, ["Description"]);
  const priceAt = columnIndex(header, ["Price"]);

  const collector = new EntryCollector();
  for (let i = headerAt + 1; i < records.length; i += 1) {
    const record = records[i]!;
    const rowNumber = i + 1;
    if (isBlankRecord(record)) {
      collector.skip();
      continue;
    }
    const code = cell(record, codeAt);
    const name = cell(record, nameAt);
    const priceText = cell(record, priceAt);
    if (priceText === "" && name === "") {
      collector.skip();
      continue;
    }
    if (code === "") {
      collector.reject(rowNumber, "NO_CODE");
      continue;
    }
    if (priceText === "") {
      collector.reject(rowNumber, "NO_PRICE");
      continue;
    }
    const unitPrice = parseSpreadsheetDotDecimal(priceText);
    if (unitPrice === null) {
      collector.reject(rowNumber, "BAD_PRICE");
      continue;
    }
    collector.add({
      rowNumber,
      supplierSku: code,
      supplierName: name === "" ? null : name,
      brand: null,
      gtin: null,
      unitPrice,
      listRetailPrice: null,
    });
  }
  return collector.result("DEJONG_STOCKLIST");
}
