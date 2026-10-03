import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractBulkReefSupplyStatement,
  withBulkReefSupplyTable,
} from "./bulk-reef-supply-extract.js";
import type { PageStatement } from "./page-extract.js";

/** The table as bulkreefsupply.com prints it (shape measured 2026-10-03, values invented). */
const SPECS = `<div class="additional-attributes-wrapper table-wrapper">
        <table class="data table additional-attributes" id="product-attribute-specs-table">
            <caption class="table-caption">More Information</caption>
            <tbody>
                <tr>
                    <th class="col label" scope="row">SKU</th>
                    <td class="col data" data-th="SKU">999001</td>
                </tr>
                <tr>
                    <th class="col label" scope="row">UPC</th>
                    <td class="col data" data-th="UPC">036000291452</td>
                </tr>
                <tr>
                    <th class="col label" scope="row">Aquarium Type</th>
                    <td class="col data" data-th="Aquarium&#x20;Type">Saltwater, Freshwater</td>
                </tr>
            </tbody>
        </table></div>`;

describe("bulkreefsupply.com More Information táblázata", () => {
  it("a UPC sort vonalkódként veszi ki, a címkével együtt", () => {
    const statement = extractBulkReefSupplyStatement(
      `<html><body>${SPECS}</body></html>`,
    );
    assert.equal(statement.note, null);
    assert.deepEqual(
      statement.values.map((v) => [v.field, v.raw]),
      [["ean", "036000291452"]],
    );
    assert.match(statement.values[0]!.excerpt, /specs-table "UPC"/);
  });

  it("a bolt saját SKU számát nem veszi át", () => {
    const fields = extractBulkReefSupplyStatement(SPECS).values.map(
      (v) => v.field,
    );
    assert.ok(!fields.includes("manufacturerSku"));
  });

  it("UPC sor nélkül nincs adat; táblázat nélkül és két táblázat mellett sem", () => {
    const noUpc = SPECS.replace(/<tr>\s*<th[^>]*>UPC[\s\S]*?<\/tr>/, "");
    assert.equal(extractBulkReefSupplyStatement(noUpc).note, "NO_VALUES");
    assert.equal(
      extractBulkReefSupplyStatement("<p>UPC 036000291452</p>").note,
      "NO_STRUCTURED_DATA",
    );
    const two = extractBulkReefSupplyStatement(SPECS + SPECS);
    assert.equal(two.note, "AMBIGUOUS_PRODUCT");
    assert.equal(two.values.length, 0);
  });

  it("a JSON-LD értékei maradnak, a táblázat csak a hiányzó mezőt tölti", () => {
    const structured: PageStatement = {
      values: [{ field: "brand", raw: "Kitalált", excerpt: "ld+json brand" }],
      note: null,
    };
    const merged = withBulkReefSupplyTable(structured, SPECS);
    assert.deepEqual(
      merged.values.map((v) => v.field),
      ["brand", "ean"],
    );
    const withEan: PageStatement = {
      values: [
        { field: "ean", raw: "5901234123457", excerpt: "ld+json gtin13" },
      ],
      note: null,
    };
    assert.equal(withBulkReefSupplyTable(withEan, SPECS), withEan);
  });
});
