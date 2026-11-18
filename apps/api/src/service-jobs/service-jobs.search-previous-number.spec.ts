import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { serviceJobSearchWhere } from "./service-jobs.repository.js";

/*
  A KERESÉS A RÉGI SZÁMRA IS TALÁL (Balázs, 2026-11-18; acrobot 55787): a HJ-számon felvett karbantartások KT-számot kaptak, a régi szám a
  `previousNumber` mezőben marad, és a keresés arra is megtalálja a lapot (egy régi levél vagy emlék hivatkozása ne vesszen el). MI PIROSÍT:
  ha a régi szám kiesik a keresésből; ha a keresés a többi mezőt (szám, cím, partner) elveszíti; ha üres keresés szűr.
*/
describe("a jegy-lista keresési feltétele", () => {
  const where = (search: string | undefined) =>
    serviceJobSearchWhere(search) as { OR?: Record<string, unknown>[] };

  it("a szám, a régi szám, a cím és a partner neve mind keres, kis-nagybetű nélkül", () => {
    const fields = (where("HJ-2026-043").OR ?? []).map(
      (clause) => Object.keys(clause)[0],
    );
    assert.deepEqual(fields, [
      "jobNumber",
      "previousNumber",
      "title",
      "customer",
    ]);
    const previous = (where("HJ-2026-043").OR ?? []).find(
      (clause) => "previousNumber" in clause,
    ) as { previousNumber: { contains: string; mode: string } };
    assert.deepEqual(previous.previousNumber, {
      contains: "HJ-2026-043",
      mode: "insensitive",
    });
  });

  it("üres vagy szóköz keresés nem szűr", () => {
    assert.deepEqual(serviceJobSearchWhere(undefined), {});
    assert.deepEqual(serviceJobSearchWhere("   "), {});
  });
});
