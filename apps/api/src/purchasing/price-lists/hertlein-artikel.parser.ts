import {
  compareDecimal,
  parseCommaDecimal,
  parseDotDecimal,
} from "./decimal-text.js";
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
 * HERTLEIN ARTIKEL LIST (der-aquaristik.shop export, measured 2026-10-23: 7430
 * rows, 12 columns).
 *
 * Pipe-separated, every field quoted, long descriptions with line breaks inside
 * the quotes (the record reader handles those). Columns: `Artikelnummer,
 * Artikelhersteller, Produktname, Beschreibung kurz, Beschreibung lang, EAN,
 * Kategorie, Preis, Preis 2, Steuer, Last Change, UVP`.
 *
 * === THE PRICE FIELDS, THE ONE SUBTLE PART ===
 * For 6122 of the 7430 rows `Preis 2` is empty and `Preis` is a plain comma
 * decimal (`11,20`). For the other 1308 rows `Preis 2` holds a quantity tier
 * written with a DOT decimal (`1:30.65`, always quantity 1 on this file) and
 * `Preis` is that same text with the comma-decimal price GLUED on behind it
 * (`1:30.6545,75` = `1:30.65` + `45,75`).
 *
 * The rule is a prefix cut, not a guess about where the digits split: remove
 * the exact text of `Preis 2` from the front of `Preis`; what is left must be a
 * comma decimal. Balázs's decision (2026-10-23, Commerce lépések szál, message
 * 1563133251206385667): where there are two prices, the LOWER one is ours. A row
 * whose `Preis` does not start with `Preis 2`, whose rest is not a comma
 * decimal, or whose tier quantity is not 1, is REJECTED
 * (TIER_PRICE_UNREADABLE): a price read by guessing is worse than a missing one.
 * Measured on the whole file: all 1308 rows cut cleanly, quantity 1 in all.
 *
 * `UVP` is written `6,99 EUR` on the rows that have one; the currency word is
 * cut and the rest read as a comma decimal. It is display only, so an
 * unreadable `UVP` becomes null instead of rejecting the row.
 */
export function parseHertleinArtikel(text: string): ParsedPriceList {
  const records = parseDelimited(text, "|");
  const headerAt = records
    .slice(0, 3)
    .findIndex(
      (record) =>
        columnIndex(record, ["Artikelnummer"]) >= 0 &&
        columnIndex(record, ["Produktname"]) >= 0 &&
        columnIndex(record, ["Preis"]) >= 0 &&
        columnIndex(record, ["Preis 2"]) >= 0,
    );
  if (headerAt < 0) throw new PriceListParseError("HEADER_NOT_FOUND");
  const header = records[headerAt]!;
  const codeAt = columnIndex(header, ["Artikelnummer"]);
  const brandAt = columnIndex(header, ["Artikelhersteller"]);
  const nameAt = columnIndex(header, ["Produktname"]);
  const eanAt = columnIndex(header, ["EAN"]);
  const priceAt = columnIndex(header, ["Preis"]);
  const tierAt = columnIndex(header, ["Preis 2"]);
  const retailAt = columnIndex(header, ["UVP"]);

  const collector = new EntryCollector();
  for (let i = headerAt + 1; i < records.length; i += 1) {
    const record = records[i]!;
    const rowNumber = i + 1;
    if (isBlankRecord(record)) {
      collector.skip();
      continue;
    }
    const code = cell(record, codeAt);
    if (code === "") {
      collector.reject(rowNumber, "NO_CODE");
      continue;
    }
    const priceText = cell(record, priceAt);
    if (priceText === "") {
      collector.reject(rowNumber, "NO_PRICE");
      continue;
    }
    const tierText = cell(record, tierAt);
    let unitPrice: string | null;
    if (tierText === "") {
      unitPrice = parseCommaDecimal(priceText);
      if (unitPrice === null) {
        collector.reject(rowNumber, "BAD_PRICE");
        continue;
      }
    } else {
      unitPrice = lowerOfTwo(priceText, tierText);
      if (unitPrice === null) {
        collector.reject(rowNumber, "TIER_PRICE_UNREADABLE");
        continue;
      }
    }
    const name = cell(record, nameAt);
    const brand = cell(record, brandAt);
    collector.add({
      rowNumber,
      supplierSku: code,
      supplierName: name === "" ? null : name,
      brand: brand === "" ? null : brand,
      gtin: normalizeGtin(cell(record, eanAt)),
      unitPrice,
      listRetailPrice: readRetail(cell(record, retailAt)),
    });
  }
  return collector.result("HERTLEIN_ARTIKEL");
}

/** `Preis` = `Preis 2` + the comma-decimal price; the lower of the two, or null when the rule does not hold. */
function lowerOfTwo(priceText: string, tierText: string): string | null {
  const tier = /^(\d+):(.+)$/.exec(tierText);
  if (!tier || tier[1] !== "1") return null;
  const tierPrice = parseDotDecimal(tier[2]!);
  if (tierPrice === null || !priceText.startsWith(tierText)) return null;
  const rest = parseCommaDecimal(priceText.slice(tierText.length));
  if (rest === null) return null;
  return compareDecimal(tierPrice, rest) <= 0 ? tierPrice : rest;
}

function readRetail(text: string): string | null {
  if (text === "") return null;
  return parseCommaDecimal(text.replace(/\s*EUR$/i, ""));
}
