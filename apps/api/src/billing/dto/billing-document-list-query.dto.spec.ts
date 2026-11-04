// a class-validator dekorátorai a metaadatot olvassák, amit élesben a `main.ts` telepít
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { BillingDocumentListQueryDto } from "./billing-document-list-query.dto.js";

/**
 * A KIMENŐ LISTA KELT-SZŰRŐJE VALÓDI NAPOT KÉR (barracuda, #2170 review). MI PIROSÍT: ha a 2026-13-45 vagy a 2026-02-30
 * átmegy (a lekérdezésben érvénytelen dátum lenne, 500 a 400 helyett); ha egy rendes nap vagy egy szökőnap elakad;
 * ha a nem naptári alak (idő, szöveg) átmegy.
 */
const hibas = (query: object) =>
  validateSync(plainToInstance(BillingDocumentListQueryDto, query)).length > 0;

describe("BillingDocumentListQueryDto: from és to", () => {
  it("valódi napot fogad, a szökőnapot is, és nélkülük is érvényes", () => {
    assert.equal(hibas({ from: "2026-10-01", to: "2026-10-31" }), false);
    assert.equal(hibas({ from: "2028-02-29" }), false);
    assert.equal(hibas({}), false);
  });

  it("nem létező napot elutasít", () => {
    for (const rossz of [
      "2026-13-45",
      "2026-02-30",
      "2027-02-29",
      "2026-00-10",
    ]) {
      assert.equal(hibas({ from: rossz }), true, `from ${rossz}`);
      assert.equal(hibas({ to: rossz }), true, `to ${rossz}`);
    }
  });

  it("a nem napi alakot elutasít", () => {
    for (const rossz of ["2026-10-01T00:00:00Z", "okt 1", "2026-1-1", ""])
      assert.equal(hibas({ from: rossz }), true, rossz);
  });
});
