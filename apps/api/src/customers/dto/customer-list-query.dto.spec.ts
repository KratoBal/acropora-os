// a class-validator dekorátorai a metaadatot olvassák, amit élesben a `main.ts` telepít
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { CustomerListQueryDto } from "./customer.dto.js";

/**
 * A VEVŐK LISTÁJÁNAK RENDEZÉSI KÉRÉSE (kártya 2f6369a4). MI PIROSÍT: ha a név vagy a két irány elakad (a szűrőkkel együtt is); ha a
 * fehér listán kívüli mező (a partnerkód, a cím, a forrás, egy kitalált név) vagy irány átmegy.
 */
const hibas = (query: object) =>
  validateSync(plainToInstance(CustomerListQueryDto, query)).length > 0;

describe("CustomerListQueryDto: sort és direction", () => {
  it("a nevet és a két irányt elfogadja (a szűrőkkel is), és nélkülük is érvényes", () => {
    assert.equal(hibas({}), false);
    for (const direction of ["asc", "desc"])
      assert.equal(
        hibas({ sort: "displayName", direction, role: "ALL", status: "ALL" }),
        false,
        direction,
      );
  });

  it("a fehér listán kívüli mezőt és irányt elutasítja", () => {
    for (const sort of [
      "partnerCode",
      "address",
      "source",
      "id",
      "constructor",
      "",
    ])
      assert.equal(hibas({ sort }), true, `sort ${sort}`);
    for (const direction of ["up", "ASC", "", "1"])
      assert.equal(hibas({ direction }), true, `direction ${direction}`);
  });
});
