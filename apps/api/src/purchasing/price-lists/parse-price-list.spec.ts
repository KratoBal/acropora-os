import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_PRICE_LIST_BYTES,
  decodePriceListText,
  parsePriceList,
} from "./parse-price-list.js";
import { PriceListParseError } from "./price-list.types.js";

const DEJONG_HEAD = "WEEK 99,,,\nCode,Description,Price,Stock\n";

function dejong(rows: string[]): Buffer {
  return Buffer.from(DEJONG_HEAD + rows.join("\n") + "\n", "utf8");
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof PriceListParseError ? error.code : String(error);
  }
  return undefined;
}

describe("decodePriceListText", () => {
  it("strips a UTF-8 byte-order mark", () => {
    const text = decodePriceListText(
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("Händler", "utf8"),
      ]),
    );
    assert.equal(text, "Händler");
  });

  it("falls back to Windows-1252 for a file exported on a German machine", () => {
    assert.equal(
      decodePriceListText(
        Buffer.from([0x48, 0xe4, 0x6e, 0x64, 0x6c, 0x65, 0x72]),
      ),
      "Händler",
    );
  });

  it("refuses a file that is not text (a zip, a spreadsheet)", () => {
    assert.equal(
      codeOf(() =>
        decodePriceListText(
          Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x81, 0x8d, 0x00]),
        ),
      ),
      "UNREADABLE_ENCODING",
    );
  });
});

describe("parsePriceList", () => {
  it("dispatches on the format the uploader chose", () => {
    const parsed = parsePriceList(
      "DEJONG_STOCKLIST",
      dejong(["A-1,Example,5,1"]),
    );
    assert.equal(parsed.format, "DEJONG_STOCKLIST");
    assert.equal(parsed.entries.length, 1);
  });

  it("refuses a file above the size limit before reading it", () => {
    assert.equal(
      codeOf(() =>
        parsePriceList(
          "DEJONG_STOCKLIST",
          Buffer.alloc(MAX_PRICE_LIST_BYTES + 1),
        ),
      ),
      "FILE_TOO_LARGE",
    );
  });

  it("refuses a file uploaded with the wrong format as a whole, not as rejected rows", () => {
    const hertlein = Buffer.from(
      '"Artikelnummer"|"Produktname"|"Preis"|"Preis 2"\n"1"|"Example"|"5,00"|""\n',
      "utf8",
    );
    assert.equal(
      codeOf(() => parsePriceList("DEJONG_STOCKLIST", hertlein)),
      "HEADER_NOT_FOUND",
    );
    assert.equal(
      codeOf(() => parsePriceList("CORALSANDS_PREISLISTE", hertlein)),
      "HEADER_NOT_FOUND",
    );
  });

  it("refuses a file with a header and no valid row", () => {
    assert.equal(
      codeOf(() => parsePriceList("DEJONG_STOCKLIST", dejong([]))),
      "NO_VALID_ROWS",
    );
  });

  it("refuses a file where more than a tenth of the rows are rejected", () => {
    const rows = Array.from({ length: 9 }, (_, i) => `A-${i},Example,5,1`);
    // 2 bad of 11 read = 18%
    assert.equal(
      codeOf(() =>
        parsePriceList(
          "DEJONG_STOCKLIST",
          dejong([...rows, "B-1,Bad,x,1", "B-2,Bad,y,1"]),
        ),
      ),
      "TOO_MANY_REJECTED_ROWS",
    );
  });

  it("keeps a file with a few rejected rows and reports them", () => {
    const rows = Array.from({ length: 19 }, (_, i) => `A-${i},Example,5,1`);
    // 1 bad of 20 read = 5%
    const parsed = parsePriceList(
      "DEJONG_STOCKLIST",
      dejong([...rows, "B-1,Bad,x,1"]),
    );
    assert.equal(parsed.entries.length, 19);
    assert.deepEqual(
      parsed.rejected.map((r) => r.reason),
      ["BAD_PRICE"],
    );
  });
});
