import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { WorksheetListQueryDto } from "./dto/worksheet.dto.js";
import { worksheetJobKindWhere } from "./worksheet-job-kind-filter.js";

/*
  A MUNKALAP-LISTA SZŰRŐJE A KAPCSOLT MUNKA FAJTÁJA SZERINT: Mind / Hibajegyes / Karbantartási (Balázs 2026-11-18 19:18 UTC, kártya 8219e7d6; acrobot 56321). A szerveren szűrünk, mint a Karbantartás lista füleinél (#2711): a lista lapozott, egy kliensoldali
  szűrő csak a betöltött oldalt látná. MI PIROSÍT: ha a hiányzó szűrő bármit leszűkít; ha a Hibajegyes a karbantartási lapokat is hozza (vagy fordítva); ha a hibajegy nélküli (önálló) lap bekerül egy fajtára szűrt listába; ha a kérés ismeretlen
  fajtát elfogad; ha a Mind-nek megfelelő üres érték hibát ad.
*/
describe("a kapcsolt munka fajtája szerinti szűrő feltétele", () => {
  it("szűrő nélkül nem szűkít semmit, az önálló lapokat sem", () => {
    assert.deepEqual(worksheetJobKindWhere(undefined), {});
  });

  it("a Hibajegyes a hibajegyhez kötött lapokat adja, a Karbantartási a karbantartásokhoz kötötteket", () => {
    assert.deepEqual(worksheetJobKindWhere("REPAIR"), {
      serviceJob: { is: { kind: "REPAIR" } },
    });
    assert.deepEqual(worksheetJobKindWhere("MAINTENANCE"), {
      serviceJob: { is: { kind: "MAINTENANCE" } },
    });
  });

  it("a két feltétel egymásnak ellentmond, tehát nem lehet ugyanaz", () => {
    assert.notDeepEqual(
      worksheetJobKindWhere("REPAIR"),
      worksheetJobKindWhere("MAINTENANCE"),
    );
  });
});

describe("a lista kérésének jobKind mezője", () => {
  const errors = (input: Record<string, unknown>) =>
    validateSync(plainToInstance(WorksheetListQueryDto, input)).map(
      (error) => error.property,
    );

  it("elfogadja a két fajtát és a hiányt", () => {
    assert.deepEqual(errors({ jobKind: "REPAIR" }), []);
    assert.deepEqual(errors({ jobKind: "MAINTENANCE" }), []);
    assert.deepEqual(errors({}), []);
  });

  it("ismeretlen fajtát nem fogad el", () => {
    assert.deepEqual(errors({ jobKind: "ALL" }), ["jobKind"]);
    assert.deepEqual(errors({ jobKind: "valami" }), ["jobKind"]);
  });
});
