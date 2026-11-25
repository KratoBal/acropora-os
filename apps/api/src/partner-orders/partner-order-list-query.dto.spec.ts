// a class-validator dekorátorai a metaadatot olvassák, amit élesben a `main.ts` telepít
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { PartnerOrderListQueryDto } from "./dto.js";

/**
 * A MEGRENDELÉSEK LISTÁJÁNAK RENDEZÉSI KÉRÉSE (kártya 2f6369a4). MI PIROSÍT: ha egy fehér-listás mező vagy irány elakad (a szűrőkkel
 * együtt is); ha a fehér listán kívüli mező (a nettó összeg, az állapot, egy kitalált név) vagy irány átmegy.
 */
const hibas = (query: object) =>
  validateSync(plainToInstance(PartnerOrderListQueryDto, query)).length > 0;

describe("PartnerOrderListQueryDto: sort és direction", () => {
  it("a fehér-listás mezőt és a két irányt elfogadja (a szűrőkkel is), és nélkülük is érvényes", () => {
    assert.equal(hibas({ page: 1, pageSize: 25 }), false);
    for (const sort of ["orderNumber", "customerName"])
      for (const direction of ["asc", "desc"])
        assert.equal(
          hibas({
            page: 1,
            pageSize: 25,
            sort,
            direction,
            stage: "INVOICED",
            open: "1",
          }),
          false,
          `${sort} ${direction}`,
        );
  });

  it("a fehér listán kívüli mezőt és irányt elutasítja", () => {
    for (const sort of ["netTotal", "status", "chain", "id", "constructor", ""])
      assert.equal(
        hibas({ page: 1, pageSize: 25, sort }),
        true,
        `sort ${sort}`,
      );
    for (const direction of ["up", "ASC", "", "1"])
      assert.equal(
        hibas({ page: 1, pageSize: 25, direction }),
        true,
        `direction ${direction}`,
      );
  });
});
