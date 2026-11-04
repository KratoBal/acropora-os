// a class-validator dekorátorai a metaadatot olvassák, amit élesben a `main.ts` telepít
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { BillingDocumentListQueryDto } from "./billing-document-list-query.dto.js";

/**
 * A KIMENŐ LISTA FIZETÉS-SZŰRŐJE (Balázs, 2026-11-04). MI PIROSÍT: ha a két érték egyike elakad; ha a részben fizetett vagy
 * az ismeretlen külön értékként átmegy (a részben fizetett a UNPAID alá esik, az ismeretlen egyikbe sem); ha egy kis- vagy
 * nagybetűs változat vagy az üres szöveg átmegy.
 */
const hibas = (query: object) =>
  validateSync(plainToInstance(BillingDocumentListQueryDto, query)).length > 0;

describe("BillingDocumentListQueryDto: paymentState", () => {
  it("fogadja a két értéket és a hiányzót", () => {
    assert.equal(hibas({ paymentState: "PAID" }), false);
    assert.equal(hibas({ paymentState: "UNPAID" }), false);
    assert.equal(hibas({}), false);
  });

  it("minden mást elutasít", () => {
    for (const rossz of ["PARTIAL", "UNKNOWN", "paid", "", "Fizetve"])
      assert.equal(hibas({ paymentState: rossz }), true, rossz);
  });
});
