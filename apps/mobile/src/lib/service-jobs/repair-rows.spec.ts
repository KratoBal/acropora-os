import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { repairRowsOf } from "./repair-rows";
import type { ServiceJobListItem } from "./types";

/*
  A HIBAJEGYEK LISTÁJA A MENTETT MÁSOLATBÓL CSAK HIBAJEGYET MUTAT (acrobot 56224, c pont): a másolat egy tábla, a karbantartási lapok soraival együtt. MI PIROSÍT: ha egy karbantartási sor a hibajegy-listára kerül; ha egy hibajegy
  kiesik; ha egy régi mentett sor, amelyiken a fajta mező hiányzik, kiesik (a hiányzó fajta hibajegy, mint a `jobWords`-nél); ha a sorrend megváltozik.
*/
function row(id: string, kind?: ServiceJobListItem["kind"]) {
  const base = {
    id,
    jobNumber: id.toUpperCase(),
    title: `Lap ${id}`,
    status: "NEW",
    partnerStatusLabel: "Új",
    customerName: null,
    departmentPath: null,
    worksheetCount: 0,
    createdAt: "2026-11-18T08:00:00.000Z",
  } as const;
  return (kind === undefined ? base : { ...base, kind }) as ServiceJobListItem;
}

describe("repairRowsOf", () => {
  it("a karbantartási sorokat kiveszi, a hibajegyeket sorrendben hagyja", () => {
    const rows = [
      row("a", "REPAIR"),
      row("m1", "MAINTENANCE"),
      row("b", "REPAIR"),
      row("m2", "MAINTENANCE"),
    ];
    assert.deepEqual(
      repairRowsOf(rows).map((item) => item.id),
      ["a", "b"],
    );
  });

  it("a fajta nélküli régi mentett sor hibajegy", () => {
    assert.deepEqual(
      repairRowsOf([row("old"), row("m", "MAINTENANCE")]).map(
        (item) => item.id,
      ),
      ["old"],
    );
  });

  it("üres listából üres lista jön, és másolatot ad", () => {
    assert.deepEqual(repairRowsOf([]), []);
    const rows = [row("a", "REPAIR")];
    assert.notEqual(repairRowsOf(rows), rows);
  });
});
