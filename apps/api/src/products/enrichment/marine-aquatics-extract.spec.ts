import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractMarineAquaticsStatement } from "./marine-aquatics-extract.js";

/** The row list as marine-aquatics.eu prints it (shape measured 2026-10-03, values invented). */
const DATA_ROWS = `<div class="block details"><div class="block-inner">
      <ul class="data-row">
          <li><span>Výrobce:</span> <strong>Kitalált Gyártó GmbH</strong></li>
          <li><span>Katalogové číslo:</span> <strong>Kit 250</strong></li>
          <li><span>EAN:</span>  <strong>5901234123457</strong></li>
          <li><span>Záruka (měsíců): </span>
              <strong>24</strong></li>
          <li><span>Hmotnost: </span> <strong>0,25 kg</strong></li>
          <li><span>Hmotnost balení: </span> <strong>0,3 kg</strong></li>
      </ul></div></div>`;

describe("marine-aquatics.eu címkézett sorai", () => {
  it("a vonalkódot és a nettó súlyt veszi ki, a címkével együtt", () => {
    const statement = extractMarineAquaticsStatement(
      `<html><body>${DATA_ROWS}</body></html>`,
    );
    assert.equal(statement.note, null);
    assert.deepEqual(
      statement.values.map((v) => [v.field, v.raw]),
      [
        ["ean", "5901234123457"],
        ["weight", "0,25 kg"],
      ],
    );
    assert.match(statement.values[0]!.excerpt, /data-row "EAN"/);
  });

  it("a bolt saját katalógusszámát, a gyártó cégnevét és a csomagolt súlyt nem veszi át", () => {
    const fields = extractMarineAquaticsStatement(DATA_ROWS).values.map(
      (v) => v.field,
    );
    assert.ok(!fields.includes("manufacturerSku"));
    assert.ok(!fields.includes("brand"));
    assert.equal(fields.filter((f) => f === "weight").length, 1);
  });

  it("sorlista nélkül nincs adat; két terméklista mellett semmit nem vesz át", () => {
    assert.equal(
      extractMarineAquaticsStatement("<html><p>EAN: 5901234123457</p></html>")
        .note,
      "NO_STRUCTURED_DATA",
    );
    const two = extractMarineAquaticsStatement(DATA_ROWS + DATA_ROWS);
    assert.equal(two.note, "AMBIGUOUS_PRODUCT");
    assert.equal(two.values.length, 0);
  });
});
