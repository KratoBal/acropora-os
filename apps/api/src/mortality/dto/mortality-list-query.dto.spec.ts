// a class-validator dekorátorai a metaadatot olvassák, amit élesben a `main.ts` telepít
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { MortalityListQueryDto } from "./mortality.dto.js";

/**
 * AZ ELHULLÁSI NAPLÓ RENDEZÉSI KÉRÉSE (kártya 2f6369a4). MI PIROSÍT: ha egy fehér-listás mező vagy irány elakad (a szűrőkkel együtt
 * is); ha a fehér listán kívüli mező (az élőlény, a forrás, egy kitalált név) vagy irány átmegy.
 */
const hibas = (query: object) =>
  validateSync(plainToInstance(MortalityListQueryDto, query)).length > 0;

describe("MortalityListQueryDto: sort és direction", () => {
  it("a fehér-listás mezőt és a két irányt elfogadja (a szűrőkkel is), és nélkülük is érvényes", () => {
    assert.equal(hibas({}), false);
    for (const sort of ["quantity", "occurredOn", "recordedByName"])
      for (const direction of ["asc", "desc"])
        assert.equal(
          hibas({ sort, direction, sourceType: "TRADE", from: "2026-11-01" }),
          false,
          `${sort} ${direction}`,
        );
  });

  it("a fehér listán kívüli mezőt és irányt elutasítja", () => {
    for (const sort of ["productName", "sourceType", "id", "constructor", ""])
      assert.equal(hibas({ sort }), true, `sort ${sort}`);
    for (const direction of ["up", "ASC", "", "1"])
      assert.equal(hibas({ direction }), true, `direction ${direction}`);
  });
});
