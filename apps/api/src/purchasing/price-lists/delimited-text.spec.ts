import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDelimited } from "./delimited-text.js";

describe("parseDelimited", () => {
  it("splits records and fields", () => {
    assert.deepEqual(parseDelimited("a,b,c\n1,2,3\n", ","), [
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps a line break inside a quoted field in ONE record", () => {
    const records = parseDelimited('"a"|"line one\nline two"|"c"\n"d"|"e"|"f"\n', "|");
    assert.equal(records.length, 2);
    assert.deepEqual(records[0], ["a", "line one\nline two", "c"]);
    assert.deepEqual(records[1], ["d", "e", "f"]);
  });

  it("reads a doubled quote inside a quoted field as one quote", () => {
    assert.deepEqual(parseDelimited('"say ""hi""",x', ","), [['say "hi"', "x"]]);
  });

  it("keeps the delimiter inside quotes", () => {
    assert.deepEqual(parseDelimited('"566,07","790,00"', ","), [["566,07", "790,00"]]);
  });

  it("treats a quote in the middle of an unquoted field as text", () => {
    assert.deepEqual(parseDelimited('5" pipe,x', ","), [['5" pipe', "x"]]);
  });

  it("reads CRLF, a lone CR, a missing final newline and empty cells", () => {
    assert.deepEqual(parseDelimited("a,,c\r\n,,\rlast", ","), [
      ["a", "", "c"],
      ["", "", ""],
      ["last"],
    ]);
  });

  it("returns a blank line as one empty cell and no record for an empty tail", () => {
    assert.deepEqual(parseDelimited("a\n\nb\n", ","), [["a"], [""], ["b"]]);
    assert.deepEqual(parseDelimited("", ","), []);
  });
});
