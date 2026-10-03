import type { ExtractedValue, PageStatement } from "./page-extract.js";

/**
 * WHAT A BULKREEFSUPPLY.COM PRODUCT PAGE STATES IN ITS "MORE INFORMATION" TABLE.
 *
 * The page's JSON-LD carries the name and the brand, and its `sku` is the
 * shop's own number. The barcode is only in one fixed, labelled table
 * (measured 2026-10-03 on three product pages, two of them with a UPC):
 *
 *   <table class="data table additional-attributes" id="product-attribute-specs-table">
 *     <tr><th class="col label" scope="row">UPC</th>
 *         <td class="col data" data-th="UPC">852464008265</td></tr>
 *
 * Only the `UPC` row is read, by its exact label; no prose. Owner approval
 * for this reader: Balázs 2026-10-03 12:33 UTC ("Igen").
 *
 * Deliberately NOT taken:
 * - `SKU` is the shop's own number (`252721`), not the manufacturer's.
 * - No weight row exists on these pages.
 */
const SPEC_TABLE =
  /<table\b[^>]*\bid\s*=\s*["']product-attribute-specs-table["'][^>]*>([\s\S]*?)<\/table>/gi;
const ROW =
  /<tr\b[^>]*>\s*<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;

const LABEL_FIELD: Readonly<Record<string, ExtractedValue["field"]>> = {
  upc: "ean",
};

function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractBulkReefSupplyStatement(html: string): PageStatement {
  const tables = [...html.matchAll(SPEC_TABLE)];
  if (tables.length === 0) return { values: [], note: "NO_STRUCTURED_DATA" };
  if (tables.length > 1) return { values: [], note: "AMBIGUOUS_PRODUCT" };
  const values = new Map<ExtractedValue["field"], ExtractedValue>();
  for (const row of tables[0]![1]!.matchAll(ROW)) {
    const label = plain(row[1]!);
    const field = LABEL_FIELD[label.toLowerCase()];
    const raw = plain(row[2]!);
    if (!field || !raw || values.has(field)) continue;
    values.set(field, {
      field,
      raw: raw.slice(0, 200),
      excerpt: `specs-table "${label}" = ${JSON.stringify(raw.slice(0, 120))}`,
    });
  }
  return {
    values: [...values.values()],
    note: values.size ? null : "NO_VALUES",
  };
}

/**
 * The JSON-LD values stay; a table value fills only a field the JSON-LD did
 * not state, so one page never states one field twice.
 */
export function withBulkReefSupplyTable(
  structured: PageStatement,
  html: string,
): PageStatement {
  const table = extractBulkReefSupplyStatement(html);
  const stated = new Set(structured.values.map((value) => value.field));
  const added = table.values.filter((value) => !stated.has(value.field));
  if (added.length === 0) return structured;
  return { values: [...structured.values, ...added], note: null };
}
