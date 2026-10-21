import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatDocument, parseIds } from "./stored-text-lines.cli.js";

/**
 * A TÁROLT SZÖVEG KIÍRÁSA (acrobot 34625). MI PIROSÍT: ha a parancs a hiányzó
 * vagy kapcsolónak látszó azonosítót elfogadja; ha a kimenet nem mondja meg a
 * mai olvasó eredményét; ha a sorok levágása csendben történik.
 */
describe("the stored text lines command", () => {
  it("takes ids only from --ids, and not a following switch", () => {
    assert.deepEqual(parseIds(["--ids", "a, b,,c"]), ["a", "b", "c"]);
    assert.deepEqual(parseIds(["--ids", "--json"]), []);
    assert.deepEqual(parseIds([]), []);
  });

  it("prints the reader's result, numbered lines, and says what it cut", () => {
    const lines = [
      "Kitalált Ltd.",
      "Invoice number KIT-0006",
      "Total 15900 HUF",
      ...Array.from({ length: 130 }, (_, i) => `sor ${i}`),
    ];
    const text = formatDocument("doc-1", "Invoice-KIT.pdf", lines);
    assert.match(text, /^== doc-1\tInvoice-KIT\.pdf\t133 sor\nolvasó: szám /);
    assert.match(text, /\n {2}2\| Invoice number KIT-0006\n/);
    assert.match(text, /\n\(\.\.\. további 13 sor\)\n/);
    assert.match(formatDocument("doc-2", "scan.pdf", null), /nem olvasható/);
  });
});
