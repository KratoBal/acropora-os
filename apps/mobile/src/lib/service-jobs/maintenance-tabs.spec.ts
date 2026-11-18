import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cachedMaintenanceForTab,
  DEFAULT_MAINTENANCE_TAB,
  MAINTENANCE_TABS,
  maintenanceItemsForTab,
  maintenanceRowsOf,
  maintenanceStateOf,
  maintenanceTabLabel,
  maintenanceTabTotal,
} from "./maintenance-tabs";
import type { ServiceJobListItem } from "./types";

/*
  A KARBANTARTÁS LISTA FÜLEI A WEBES LISTA LOGIKÁJÁVAL (#2710; acrobot 56224). MI PIROSÍT: ha a fülek sorrendje vagy felirata eltér a weben állótól; ha az alapértelmezett fül nem a Folyamatban; ha egy kész lap a
  Folyamatban fülre kerül (vagy fordítva); ha az Összes nem mindent mutat; ha a mentett másolat hibajegyet is mutat a karbantartási lapok között; ha egy mentett sor, aminek a készsége ismeretlen, bármelyik
  szűrt fülön megjelenik (az ismeretlen NEM "folyamatban", és ezt a szám is kimondja).
*/
function row(
  id: string,
  kind: ServiceJobListItem["kind"],
  maintenanceDone?: boolean,
): ServiceJobListItem {
  return {
    id,
    jobNumber: id.toUpperCase(),
    title: `Lap ${id}`,
    kind,
    status: "NEW",
    partnerStatusLabel: "Új",
    customerName: null,
    departmentPath: null,
    worksheetCount: 0,
    createdAt: "2026-11-18T08:00:00.000Z",
    ...(maintenanceDone === undefined ? {} : { maintenanceDone }),
  };
}

const ROWS: ServiceJobListItem[] = [
  row("a", "MAINTENANCE", false),
  row("b", "MAINTENANCE", true),
  row("c", "MAINTENANCE", false),
  row("d", "MAINTENANCE", true),
  row("e", "MAINTENANCE", true),
];

describe("a karbantartás fülei", () => {
  it("Folyamatban, Kész, Összes ebben a sorrendben, és a Folyamatban az alapértelmezett", () => {
    assert.deepEqual(MAINTENANCE_TABS, [
      { id: "progress", label: "Folyamatban" },
      { id: "done", label: "Kész" },
      { id: "all", label: "Összes" },
    ]);
    assert.equal(DEFAULT_MAINTENANCE_TAB, "progress");
  });

  it("a szerver sorai a készség szerint oszlanak meg, az Összes mindet adja", () => {
    assert.deepEqual(
      maintenanceItemsForTab(ROWS, "progress").map((item) => item.id),
      ["a", "c"],
    );
    assert.deepEqual(
      maintenanceItemsForTab(ROWS, "done").map((item) => item.id),
      ["b", "d", "e"],
    );
    assert.deepEqual(
      maintenanceItemsForTab(ROWS, "all").map((item) => item.id),
      ["a", "b", "c", "d", "e"],
    );
  });

  it("a három fül sorai együtt kiadják az Összest, átfedés nélkül", () => {
    const progress = maintenanceItemsForTab(ROWS, "progress");
    const done = maintenanceItemsForTab(ROWS, "done");
    assert.equal(progress.length + done.length, ROWS.length);
    assert.equal(maintenanceItemsForTab(ROWS, "all").length, ROWS.length);
  });

  it("az Összes másolatot ad, nem ugyanazt a tömböt", () => {
    const all = maintenanceItemsForTab(ROWS, "all");
    assert.notEqual(all, ROWS);
    assert.deepEqual(all, ROWS);
  });

  it("csak a karbantartási lapokat veszi ki egy vegyes listából", () => {
    const mixed = [
      row("h1", "REPAIR"),
      row("m1", "MAINTENANCE", false),
      row("h2", "REPAIR", true),
    ];
    assert.deepEqual(
      maintenanceRowsOf(mixed).map((item) => item.id),
      ["m1"],
    );
  });
});

describe("a mentett másolat fülei", () => {
  const COPY: ServiceJobListItem[] = [
    row("h1", "REPAIR"),
    row("a", "MAINTENANCE", false),
    row("b", "MAINTENANCE", true),
    row("u", "MAINTENANCE"),
    row("h2", "REPAIR", true),
  ];

  it("hibajegyet soha nem mutat, és a kész és a folyamatban sort a megjelölt állapotból veszi", () => {
    assert.deepEqual(
      cachedMaintenanceForTab(COPY, "progress").items.map((item) => item.id),
      ["a"],
    );
    assert.deepEqual(
      cachedMaintenanceForTab(COPY, "done").items.map((item) => item.id),
      ["b"],
    );
  });

  it("az ismeretlen készségű sor csak az Összes fülön látszik, és a szám megmondja, hányról van szó", () => {
    const all = cachedMaintenanceForTab(COPY, "all");
    assert.deepEqual(
      all.items.map((item) => item.id),
      ["a", "b", "u"],
    );
    assert.equal(all.unknown, 1);
    for (const tab of ["progress", "done"] as const) {
      const result = cachedMaintenanceForTab(COPY, tab);
      assert.ok(!result.items.some((item) => item.id === "u"), tab);
      assert.equal(result.unknown, 1, tab);
    }
  });

  it("ismeretlen nélkül a szám nulla", () => {
    assert.equal(cachedMaintenanceForTab(ROWS, "progress").unknown, 0);
  });

  it("üres másolatból üres lista és nulla jön", () => {
    assert.deepEqual(cachedMaintenanceForTab([], "all"), {
      items: [],
      unknown: 0,
    });
  });
});

/*
  A FÜLEK A SZERVEREN SZŰRNEK ÉS SZÁMOLNAK (#2711, acrobot 56256): a lista a legújabb kétszázat adja, tehát a kliensoldali szűrés a vágás felett kevesebbet mutatna, mint amit a fül ígér. MI PIROSÍT: ha a Folyamatban vagy a Kész
  fül nem a megfelelő szerver-állapotot kéri; ha az Összes állapotot küld (az a teljes lista, és a másolat is ebből íródik); ha a fül száma nem a szerver számlálójából jön; ha az Összes nem a két szám összege; ha a számláló nélküli
  (régi szerver, offline) fül kitalált számot ír a felirat mellé.
*/
describe("a fül a szerver szűrőjével és számlálójával", () => {
  it("a Folyamatban és a Kész a saját szerver-állapotát kéri, az Összes egyiket sem", () => {
    assert.equal(maintenanceStateOf("progress"), "progress");
    assert.equal(maintenanceStateOf("done"), "done");
    assert.equal(maintenanceStateOf("all"), undefined);
  });

  it("a fül száma a szerver számlálójából jön, az Összes az összeg", () => {
    const counts = { progress: 3, done: 5 };
    assert.equal(maintenanceTabTotal(counts, "progress"), 3);
    assert.equal(maintenanceTabTotal(counts, "done"), 5);
    assert.equal(maintenanceTabTotal(counts, "all"), 8);
  });

  it("számláló nélkül nincs szám, és nulla is szám", () => {
    assert.equal(maintenanceTabTotal(undefined, "progress"), null);
    assert.equal(maintenanceTabTotal({ progress: 0, done: 0 }, "done"), 0);
  });

  it("a felirat a számmal együtt, számláló nélkül a puszta felirat", () => {
    const counts = { progress: 3, done: 0 };
    assert.equal(
      maintenanceTabLabel("Folyamatban", "progress", counts),
      "Folyamatban (3)",
    );
    assert.equal(maintenanceTabLabel("Kész", "done", counts), "Kész (0)");
    assert.equal(maintenanceTabLabel("Összes", "all", counts), "Összes (3)");
    assert.equal(
      maintenanceTabLabel("Folyamatban", "progress", undefined),
      "Folyamatban",
    );
  });
});
