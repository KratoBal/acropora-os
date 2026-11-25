// a class-validator dekorátorai a metaadatot olvassák, amit élesben a `main.ts` telepít
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { SupplierListQueryDto } from "./supplier.dto.js";

/**
 * A PARTNEREK LISTÁJÁNAK RENDEZÉSI KÉRÉSE (kártya 2f6369a4). MI PIROSÍT: ha egy fehér-listás mező vagy irány elakad (a szűrőkkel
 * együtt is); ha a fehér listán kívüli mező (az e-mail, az állapot, egy kitalált név) vagy irány átmegy.
 */
const hibas = (query: object) =>
  validateSync(plainToInstance(SupplierListQueryDto, query)).length > 0;

describe("SupplierListQueryDto: sort és direction", () => {
  it("a fehér-listás mezőt és a két irányt elfogadja (a szűrőkkel is), és nélkülük is érvényes", () => {
    assert.equal(hibas({}), false);
    for (const sort of ["code", "name", "country", "contactPersonName"])
      for (const direction of ["asc", "desc"])
        assert.equal(
          hibas({ sort, direction, kind: "SERVICE", status: "ALL" }),
          false,
          `${sort} ${direction}`,
        );
  });

  it("a fehér listán kívüli mezőt és irányt elutasítja", () => {
    for (const sort of [
      "email",
      "status",
      "taxNumber",
      "id",
      "constructor",
      "",
    ])
      assert.equal(hibas({ sort }), true, `sort ${sort}`);
    for (const direction of ["up", "ASC", "", "1"])
      assert.equal(hibas({ direction }), true, `direction ${direction}`);
  });
});
