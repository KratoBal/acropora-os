import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseHertleinArtikel } from "./hertlein-artikel.parser.js";
import { PriceListParseError } from "./price-list.types.js";

const HEADER =
  '"Artikelnummer"|"Artikelhersteller"|"Produktname"|"Beschreibung kurz"|"Beschreibung lang"|"EAN"|"Kategorie"|"Preis"|"Preis 2"|"Steuer"|"Last Change"|"UVP"';

interface Row {
  code?: string;
  brand?: string;
  name?: string;
  longText?: string;
  ean?: string;
  price: string;
  price2?: string;
  retail?: string;
}

// Generated, format-faithful: pipe-separated, every field quoted.
function line(row: Row): string {
  const cells = [
    row.code ?? "10000001",
    row.brand ?? "",
    row.name ?? "Example product 100 ml",
    "Short text",
    row.longText ?? "Long text",
    row.ean ?? "",
    "Category",
    row.price,
    row.price2 ?? "",
    "1",
    "",
    row.retail ?? "",
  ];
  return cells.map((cell) => `"${cell.replace(/"/g, '""')}"`).join("|");
}

function file(...rows: Row[]): string {
  return [HEADER, ...rows.map(line)].join("\r\n") + "\r\n";
}

describe("parseHertleinArtikel", () => {
  it("reads a plain comma price when there is no second price", () => {
    const parsed = parseHertleinArtikel(
      file(
        { code: "10000001", price: "11,20" },
        { code: "10000002", price: "4,10" },
      ),
    );
    assert.deepEqual(
      parsed.entries.map((e) => [e.supplierSku, e.unitPrice]),
      [
        ["10000001", "11.2"],
        ["10000002", "4.1"],
      ],
    );
    assert.deepEqual(parsed.rejected, []);
  });

  it("cuts the tier text off the front of Preis and keeps the LOWER price (tier is lower)", () => {
    // Preis is "1:30.65" with "45,75" glued behind it
    const parsed = parseHertleinArtikel(
      file({ price: "1:30.6545,75", price2: "1:30.65" }),
    );
    assert.equal(parsed.entries[0]!.unitPrice, "30.65");
  });

  it("keeps the lower price when the glued comma price is the lower one", () => {
    const parsed = parseHertleinArtikel(
      file({ price: "1:45.7530,65", price2: "1:45.75" }),
    );
    assert.equal(parsed.entries[0]!.unitPrice, "30.65");
  });

  it("does not guess where the digits split: 1:3.34,92 is 3.3 and 4,92 only through the prefix", () => {
    // Preis 2 = "1:3.3": the rest "4,92" is the comma price
    const parsed = parseHertleinArtikel(
      file({ price: "1:3.34,92", price2: "1:3.3" }),
    );
    assert.equal(parsed.entries[0]!.unitPrice, "3.3");
  });

  it("reads a tier written with four decimals", () => {
    const parsed = parseHertleinArtikel(
      file({ price: "1:2.15972,40", price2: "1:2.1597" }),
    );
    assert.equal(parsed.entries[0]!.unitPrice, "2.1597");
  });

  it("rejects a row where Preis does not start with Preis 2, the rest is not a comma price, or the tier is not quantity 1", () => {
    const parsed = parseHertleinArtikel(
      file(
        { code: "1", price: "9,99", price2: "1:30.65" },
        { code: "2", price: "1:30.65abc", price2: "1:30.65" },
        { code: "3", price: "6:30.6545,75", price2: "6:30.65" },
        { code: "4", price: "1:30,6545,75", price2: "1:30,65" },
        { code: "5", price: "1:30.65", price2: "1:30.65" },
      ),
    );
    assert.deepEqual(
      parsed.rejected.map((r) => r.reason),
      Array(5).fill("TIER_PRICE_UNREADABLE"),
    );
    assert.equal(parsed.entries.length, 0);
  });

  it("rejects a row whose Preis starts with DIFFERENT tier text of the same length, even if a comma price follows", () => {
    // "1:31.00" is not "1:30.65"; cutting seven characters would leave a valid-looking 45,75
    const parsed = parseHertleinArtikel(
      file({ price: "1:31.0045,75", price2: "1:30.65" }),
    );
    assert.deepEqual(
      parsed.rejected.map((r) => r.reason),
      ["TIER_PRICE_UNREADABLE"],
    );
    assert.equal(parsed.entries.length, 0);
  });

  it("rejects a non-comma plain price and an empty price", () => {
    const parsed = parseHertleinArtikel(
      file(
        { code: "1", price: "11.20" },
        { code: "2", price: "" },
        { code: "", price: "5,00" },
      ),
    );
    assert.deepEqual(
      parsed.rejected.map((r) => r.reason),
      ["BAD_PRICE", "NO_PRICE", "NO_CODE"],
    );
  });

  it("keeps a line break inside a quoted description in the same record and counts rows by record", () => {
    const parsed = parseHertleinArtikel(
      file(
        { code: "1", price: "1,00", longText: "first line\nsecond line" },
        { code: "2", price: "2,00" },
      ),
    );
    assert.deepEqual(
      parsed.entries.map((e) => [e.supplierSku, e.rowNumber]),
      [
        ["1", 2],
        ["2", 3],
      ],
    );
  });

  it("normalizes an EAN, drops one of a wrong length, and reads brand, name and the UVP with its currency word", () => {
    const parsed = parseHertleinArtikel(
      file(
        {
          code: "1",
          brand: "Example Brand",
          name: 'Example "quoted" name',
          ean: "4006381333931",
          price: "5,00",
          retail: "6,99 EUR",
        },
        { code: "2", ean: "40063813339", price: "5,00", retail: "n/a" },
        { code: "3", ean: "0036000291452", price: "5,00" },
      ),
    );
    const [first, second, third] = parsed.entries;
    assert.equal(first!.gtin, "04006381333931");
    assert.equal(first!.brand, "Example Brand");
    assert.equal(first!.supplierName, 'Example "quoted" name');
    assert.equal(first!.listRetailPrice, "6.99");
    assert.equal(second!.gtin, null);
    assert.equal(second!.listRetailPrice, null);
    assert.equal(third!.gtin, "00036000291452");
    assert.equal(parsed.rejected.length, 0);
  });

  it("counts an identical repeat of a code and rejects a repeat with a different price", () => {
    const parsed = parseHertleinArtikel(
      file(
        { code: "1", price: "239,00" },
        { code: "1", price: "239,00" },
        { code: "2", price: "5,00" },
        { code: "2", price: "6,00" },
      ),
    );
    assert.equal(parsed.entries.length, 2);
    assert.equal(parsed.duplicateRows, 1);
    assert.deepEqual(
      parsed.rejected.map((r) => r.reason),
      ["CONFLICTING_DUPLICATE"],
    );
  });

  it("refuses a file whose header is missing", () => {
    assert.throws(
      () => parseHertleinArtikel("Code,Description,Price\n1,2,3\n"),
      (error) =>
        error instanceof PriceListParseError &&
        error.code === "HEADER_NOT_FOUND",
    );
  });
});
