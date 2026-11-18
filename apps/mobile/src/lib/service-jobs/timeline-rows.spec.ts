import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { timelineRows } from "./timeline-rows";
import type { ServiceJobTimelineEntry } from "./types";

const now = new Date(2026, 9, 4, 12, 0);
const at = (hour: number, minute: number) =>
  new Date(2026, 9, 4, hour, minute).toISOString();

describe("az Ami történt sorai", () => {
  it("a belső állapotlépés a két állapotot, a végzőt és a megjegyzést mutatja", () => {
    const rows = timelineRows(
      [
        {
          kind: "status",
          at: at(10, 22),
          sortKey: "e2",
          event: {
            fromStatus: "IN_PROGRESS",
            toStatus: "WAITING_FOR_PARTS",
            note: "Hollander csere szükséges",
            actorName: "Ádám",
          },
        },
        {
          kind: "status",
          at: at(8, 14),
          sortKey: "e1",
          event: {
            fromStatus: null,
            toStatus: "NEW",
            note: null,
            actorName: null,
          },
        },
      ],
      now,
    );
    assert.equal(rows[0]!.when, "ma 10:22");
    assert.match(rows[0]!.title, /→/);
    assert.equal(rows[0]!.detail, "Ádám · Hollander csere szükséges");
    assert.match(rows[1]!.title, /^A hibajegy létrejött/);
    assert.equal(rows[1]!.detail, null);
  });

  it("a partner alakból a partneri feliratot rajzolja, belső állapotot nem talál ki", () => {
    const rows = timelineRows(
      [
        {
          kind: "status",
          at: at(9, 0),
          sortKey: "p1",
          event: { partnerStatusLabel: "Folyamatban", actorName: "Kiss Márta" },
        },
      ],
      now,
    );
    assert.equal(rows[0]!.title, "Folyamatban");
    assert.equal(rows[0]!.detail, "Kiss Márta");
  });

  it("régi mentett sor esemény nélkül is kap címet", () => {
    const rows = timelineRows(
      [
        {
          kind: "status",
          at: at(9, 0),
          sortKey: "x",
        } as ServiceJobTimelineEntry,
      ],
      now,
    );
    assert.equal(rows[0]!.title, "Állapotváltás");
  });

  it("munkalap, eszköz és törölt csatolmány sor", () => {
    const rows = timelineRows(
      [
        {
          kind: "worksheet",
          at: at(9, 14),
          sortKey: "w",
          worksheet: {
            id: "w",
            number: "ML-2026-00814",
            subject: "Tömítéscsere",
            createdAt: at(9, 14),
            handedOverAt: null,
          },
        },
        {
          kind: "document",
          at: at(9, 20),
          sortKey: "d",
          removal: {
            fileName: "kep.jpg",
            documentType: "PHOTO",
            actorName: "Péter",
          },
        },
      ],
      now,
    );
    assert.deepEqual(
      rows.map((row) => [row.title, row.detail]),
      [
        ["Munkalap a jegy alatt", "ML-2026-00814"],
        ["Csatolmány törölve", "Péter · kep.jpg"],
      ],
    );
  });

  /*
    A KARBANTARTÁSI LAP NAPLÓJA A SAJÁT NEVÉN SZÓL (hibajegy-maradek lista, 4. fejezet, acrobot 56196): a "A hibajegy létrejött", "Munkalap a jegy alatt" és "Eszköz a jegyen" sorok a lap
    fajtáját követik; a fajta nélküli hívás (a régi, mentett sor) a hibajegy szavait tartja. MI PIROSÍT: ha a MAINTENANCE lap naplója újra hibajegyet mond; ha a hibajegyé megváltozik.
  */
  const entries: ServiceJobTimelineEntry[] = [
    {
      kind: "status",
      at: at(8, 14),
      sortKey: "e1",
      event: { fromStatus: null, toStatus: "NEW", note: null, actorName: null },
    },
    {
      kind: "status",
      at: at(8, 15),
      sortKey: "e0",
      event: { isCreation: true } as never,
    },
    {
      kind: "worksheet",
      at: at(9, 14),
      sortKey: "w",
      worksheet: {
        id: "w",
        number: "ML-2026-00814",
        subject: "Tömítéscsere",
        createdAt: at(9, 14),
        handedOverAt: null,
      },
    },
    {
      kind: "asset",
      at: at(9, 15),
      sortKey: "a",
      asset: {
        assetNumber: "ESZK-1",
        assetName: "Szűrő",
      } as never,
    },
  ];

  it("a karbantartási lap naplója a karbantartási lapot nevezi meg", () => {
    const rows = timelineRows(entries, now, "MAINTENANCE");
    assert.deepEqual(
      rows.map((row) => row.title),
      [
        "A karbantartási lap létrejött (Új)",
        "A karbantartási lap létrejött",
        "Munkalap a karbantartási lap alatt",
        "Eszköz a karbantartási lapon",
      ],
    );
    for (const row of rows) assert.doesNotMatch(row.title, /jegy/i);
  });

  it("a hibajegy és a fajta nélküli hívás naplója hibajegyet mond", () => {
    for (const kind of ["REPAIR", undefined] as const) {
      const rows = timelineRows(entries, now, kind);
      assert.deepEqual(
        rows.map((row) => row.title),
        [
          "A hibajegy létrejött (Új)",
          "A hibajegy létrejött",
          "Munkalap a jegy alatt",
          "Eszköz a jegyen",
        ],
      );
    }
  });
});
