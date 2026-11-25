// a class-validator dekorátorai a metaadatot olvassák, amit élesben a `main.ts` telepít
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { AquariumListQueryDto } from "./aquarium.dto.js";

/**
 * AZ AKVÁRIUMOK LISTÁJÁNAK RENDEZÉSI KÉRÉSE (kártya 2f6369a4). MI PIROSÍT: ha egy fehér-listás mező vagy irány elakad (a szűrőkkel
 * együtt is); ha a fehér listán kívüli mező (a típus, a tulajdon, egy kitalált név) vagy irány átmegy.
 */
const hibas = (query: object) =>
  validateSync(plainToInstance(AquariumListQueryDto, query)).length > 0;

describe("AquariumListQueryDto: sort és direction", () => {
  it("a fehér-listás mezőt és a két irányt elfogadja (a szűrőkkel is), és nélkülük is érvényes", () => {
    assert.equal(hibas({}), false);
    for (const sort of ["name", "customerName", "systemVolumeLiters"])
      for (const direction of ["asc", "desc"])
        assert.equal(
          hibas({ sort, direction, ownershipType: "OWN", search: "x" }),
          false,
          `${sort} ${direction}`,
        );
  });

  it("a fehér listán kívüli mezőt és irányt elutasítja", () => {
    for (const sort of [
      "waterBodyType",
      "ownershipType",
      "id",
      "constructor",
      "",
    ])
      assert.equal(hibas({ sort }), true, `sort ${sort}`);
    for (const direction of ["up", "ASC", "", "1"])
      assert.equal(hibas({ direction }), true, `direction ${direction}`);
  });
});
