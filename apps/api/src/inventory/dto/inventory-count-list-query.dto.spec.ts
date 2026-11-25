// a class-validator dekorátorai a metaadatot olvassák, amit élesben a `main.ts` telepít
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { InventoryCountListQueryDto } from "./inventory-count-list-query.dto.js";

/**
 * A LELTÁRLISTA RENDEZÉSI KÉRÉSE (kártya 2f6369a4). MI PIROSÍT: ha egy fehér-listás mező vagy irány elakad (az állapot-szűrővel együtt
 * is); ha a fehér listán kívüli mező (az indító, az állapot, egy kitalált név) vagy irány átmegy.
 */
const hibas = (query: object) =>
  validateSync(plainToInstance(InventoryCountListQueryDto, query)).length > 0;

describe("InventoryCountListQueryDto: sort és direction", () => {
  it("a fehér-listás mezőt és a két irányt elfogadja (az állapot-szűrővel is), és nélkülük is érvényes", () => {
    assert.equal(hibas({}), false);
    for (const sort of [
      "countNumber",
      "warehouseName",
      "createdAt",
      "lineCount",
    ])
      for (const direction of ["asc", "desc"])
        assert.equal(
          hibas({ sort, direction, status: "DRAFT" }),
          false,
          `${sort} ${direction}`,
        );
  });

  it("a fehér listán kívüli mezőt és irányt elutasítja", () => {
    for (const sort of ["startedByName", "status", "id", "constructor", ""])
      assert.equal(hibas({ sort }), true, `sort ${sort}`);
    for (const direction of ["up", "ASC", "", "1"])
      assert.equal(hibas({ direction }), true, `direction ${direction}`);
  });
});
