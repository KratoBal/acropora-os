// a class-validator dekorátorai a metaadatot olvassák, amit élesben a `main.ts` telepít
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { UserListQueryDto } from "./user.dto.js";

/**
 * A FELHASZNÁLÓK LISTÁJÁNAK RENDEZÉSI KÉRÉSE (kártya 2f6369a4). MI PIROSÍT: ha egy fehér-listás mező vagy irány elakad (a szűrőkkel
 * együtt is); ha a fehér listán kívüli mező (a becenév, a szerepkör, egy kitalált név) vagy irány átmegy.
 */
const hibas = (query: object) =>
  validateSync(plainToInstance(UserListQueryDto, query)).length > 0;

describe("UserListQueryDto: sort és direction", () => {
  it("a fehér-listás mezőt és a két irányt elfogadja (a szűrőkkel is), és nélkülük is érvényes", () => {
    assert.equal(hibas({}), false);
    for (const sort of ["displayName", "email"])
      for (const direction of ["asc", "desc"])
        assert.equal(
          hibas({ sort, direction, status: "ALL", search: "x" }),
          false,
          `${sort} ${direction}`,
        );
  });

  it("a fehér listán kívüli mezőt és irányt elutasítja", () => {
    for (const sort of [
      "nickname",
      "role",
      "isActive",
      "id",
      "constructor",
      "",
    ])
      assert.equal(hibas({ sort }), true, `sort ${sort}`);
    for (const direction of ["up", "ASC", "", "1"])
      assert.equal(hibas({ direction }), true, `direction ${direction}`);
  });
});
