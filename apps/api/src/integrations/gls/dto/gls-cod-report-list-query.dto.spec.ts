// a class-validator dekorátorai a metaadatot olvassák, amit élesben a `main.ts` telepít
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { GlsCodReportListQueryDto } from "./gls-cod-report-list-query.dto.js";

/**
 * A GLS-UTÁNVÉT LISTÁJÁNAK RENDEZÉSI KÉRÉSE (kártya 2f6369a4). MI PIROSÍT: ha egy fehér-listás mező vagy irány elakad; ha a fehér
 * listán kívüli mező (a `status`, egy kitalált név) vagy irány átmegy; ha a rendezés megadása nélkül a kérés érvénytelen.
 */
const hibas = (query: object) =>
  validateSync(plainToInstance(GlsCodReportListQueryDto, query)).length > 0;

describe("GlsCodReportListQueryDto: sort és direction", () => {
  it("a fehér-listás mezőt és a két irányt elfogadja, és nélkülük is érvényes", () => {
    assert.equal(hibas({}), false);
    for (const sort of ["transferDate", "fileName", "total"])
      for (const direction of ["asc", "desc"])
        assert.equal(hibas({ sort, direction }), false, `${sort} ${direction}`);
  });

  it("a fehér listán kívüli mezőt és irányt elutasítja", () => {
    for (const sort of ["status", "id", "createdAt", "constructor", ""])
      assert.equal(hibas({ sort }), true, `sort ${sort}`);
    for (const direction of ["up", "ASC", "", "1"])
      assert.equal(hibas({ direction }), true, `direction ${direction}`);
  });
});
