import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCoralsandsPreisliste } from "./coralsands-preisliste.parser.js";
import { PriceListParseError } from "./price-list.types.js";

const HEADER =
  "Hersteller,Artikelnummer,Artikelname,Händler,UVP,GTIN,TARIC-Code,UPC";
const SECOND_HEADER =
  "Hersteller,Artikelnummer,Artikelname,JTL-Wawi: Händler Netto,UVP,GTIN,TARIC-Code,UPC";

function file(...rows: string[]): string {
  return [HEADER, ...rows].join("\r\n") + "\r\n";
}

// Generated, format-faithful: comma decimals in quotes, short rows, a repeated
// header with the third price column renamed. No real supplier data.
describe("parseCoralsandsPreisliste", () => {
  it("reads quoted comma-decimal prices exactly, with brand, name, retail price and GTIN", () => {
    const parsed = parseCoralsandsPreisliste(
      file(
        'Example Instruments,1507135,Example Meter,"566,07","790,00",4006381333931,90275000,',
        'Example Instruments,13145,"Example sensor, 5 m cable","239,43","335,00",,90275000,',
      ),
    );
    assert.deepEqual(
      parsed.entries.map((e) => [
        e.supplierSku,
        e.unitPrice,
        e.listRetailPrice,
        e.gtin,
      ]),
      [
        ["1507135", "566.07", "790", "04006381333931"],
        ["13145", "239.43", "335", null],
      ],
    );
    assert.equal(parsed.entries[0]!.brand, "Example Instruments");
    assert.equal(parsed.entries[1]!.supplierName, "Example sensor, 5 m cable");
    assert.deepEqual(parsed.rejected, []);
  });

  it("reads a row that stops after the UVP cell as having no GTIN", () => {
    const parsed = parseCoralsandsPreisliste(
      file('Example,155246,Example canister,"98,92","187,95"'),
    );
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0]!.gtin, null);
  });

  it("counts a repeated header (the JTL-Wawi block) as skipped, not rejected, and reads on", () => {
    const parsed = parseCoralsandsPreisliste(
      file(
        'Example,1,First,"10,00","20,00",,',
        SECOND_HEADER,
        'Example,2,Second,"11,50","22,00",,',
      ),
    );
    assert.deepEqual(
      parsed.entries.map((e) => e.supplierSku),
      ["1", "2"],
    );
    assert.equal(parsed.skippedRows, 1);
    assert.deepEqual(parsed.rejected, []);
  });

  it("accepts a file whose FIRST header already uses the JTL-Wawi column name", () => {
    const parsed = parseCoralsandsPreisliste(
      [SECOND_HEADER, 'Example,1,First,"10,00","20,00"'].join("\n"),
    );
    assert.equal(parsed.entries[0]!.unitPrice, "10");
  });

  it("drops an 11-digit and a 4-digit GTIN cell but keeps the row and its price", () => {
    const parsed = parseCoralsandsPreisliste(
      file(
        'Example,1,Eleven,"1,00","2,00",40063813339,',
        'Example,2,Four,"1,00","2,00",1234,',
      ),
    );
    assert.equal(parsed.entries.length, 2);
    assert.deepEqual(
      parsed.entries.map((e) => e.gtin),
      [null, null],
    );
  });

  it("rejects an empty price, a dot price and a row without a code", () => {
    const parsed = parseCoralsandsPreisliste(
      file(
        'Example,1,No price,,"2,00"',
        'Example,2,Dot price,"1.5","2,00"',
        'Example,,No code,"1,00","2,00"',
      ),
    );
    assert.deepEqual(
      parsed.rejected.map((r) => r.reason),
      ["NO_PRICE", "BAD_PRICE", "NO_CODE"],
    );
  });

  it("keeps a line break inside a quoted name in one record", () => {
    const parsed = parseCoralsandsPreisliste(
      file(
        'Example,1,"Name with\nbreak","1,00","2,00"',
        'Example,2,Plain,"3,00","4,00"',
      ),
    );
    assert.deepEqual(
      parsed.entries.map((e) => [e.supplierSku, e.rowNumber]),
      [
        ["1", 2],
        ["2", 3],
      ],
    );
    assert.equal(parsed.entries[0]!.supplierName, "Name with\nbreak");
  });

  it("refuses a file without the header", () => {
    assert.throws(
      () => parseCoralsandsPreisliste("Code,Description,Price\n1,2,3\n"),
      (error) =>
        error instanceof PriceListParseError &&
        error.code === "HEADER_NOT_FOUND",
    );
  });
});
