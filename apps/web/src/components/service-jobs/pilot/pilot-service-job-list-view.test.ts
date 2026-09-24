import type {
  ServiceJobListItem,
  ServiceJobStatusCounts,
} from "@acropora/types";
import { describe, expect, it } from "vitest";

import {
  pilotItemsForTab,
  pilotTabCounts,
  pilotTabDef,
  PILOT_TABS,
} from "./pilot-service-job-list-view";

function counts(
  overrides: Partial<ServiceJobStatusCounts> = {},
): ServiceJobStatusCounts {
  return {
    NEW: 0,
    TRIAGED: 0,
    SCHEDULED: 0,
    IN_PROGRESS: 0,
    WAITING_FOR_PARTS: 0,
    WAITING_FOR_CUSTOMER: 0,
    COMPLETED: 0,
    CANCELLED: 0,
    ...overrides,
  };
}

function item(
  id: string,
  status: ServiceJobListItem["status"],
): ServiceJobListItem {
  return {
    id,
    jobNumber: `HJ-2026-${id}`,
    title: `Jegy ${id}`,
    kind: "REPAIR",
    status,
    partnerStatus: "IN_PROGRESS",
    partnerStatusLabel: "Feldolgozás alatt",
    customerName: null,
    departmentPath: null,
    departmentCode: null,
    assignees: [],
    worksheetCount: 0,
    createdAt: "2026-09-01T08:00:00.000Z",
    hidden: false,
  };
}

describe("pilotItemsForTab", () => {
  /**
   * A "Nyitott hibajegy" fül KIZÁRJA a várakozó jegyeket -- ez a különbség
   * a mai (`service-job-list-view.ts`) "open" füléhez képest, ahol BENNE
   * vannak. A Figma-terv külön fület ad a várakozásnak, tehát a "nyitott"
   * itt szűkebb halmazt jelent.
   */
  it("a nyitott fül nem tartalmazza a várakozó állapotokat", () => {
    const items = [
      item("1", "NEW"),
      item("2", "WAITING_FOR_PARTS"),
      item("3", "IN_PROGRESS"),
    ];
    expect(pilotItemsForTab(items, "open").map((i) => i.id)).toEqual([
      "1",
      "3",
    ]);
  });

  it("a várakozó fül a két várakozó állapotot adja, mást nem", () => {
    const items = [
      item("1", "NEW"),
      item("2", "WAITING_FOR_PARTS"),
      item("3", "WAITING_FOR_CUSTOMER"),
      item("4", "COMPLETED"),
    ];
    expect(pilotItemsForTab(items, "waiting").map((i) => i.id)).toEqual([
      "2",
      "3",
    ]);
  });

  it("a lezárt fül a két végállapotot adja", () => {
    const items = [
      item("1", "COMPLETED"),
      item("2", "CANCELLED"),
      item("3", "NEW"),
    ];
    expect(pilotItemsForTab(items, "closed").map((i) => i.id)).toEqual([
      "1",
      "2",
    ]);
  });

  it("az összes fül szűrés nélkül adja vissza a teljes listát", () => {
    const items = [item("1", "NEW"), item("2", "COMPLETED")];
    expect(pilotItemsForTab(items, "all")).toHaveLength(2);
  });

  it("ismeretlen fülre dob, nem csendben üreset ad", () => {
    expect(() =>
      pilotTabDef(
        "nincs-ilyen" as unknown as (typeof PILOT_TABS)[number]["id"],
      ),
    ).toThrow();
  });
});

describe("pilotTabCounts", () => {
  it("a négy csempe a teljes halmazból számol, a nyitott a várakozókat nem tartalmazza", () => {
    const summary = pilotTabCounts(
      counts({
        NEW: 2,
        TRIAGED: 1,
        WAITING_FOR_PARTS: 3,
        WAITING_FOR_CUSTOMER: 1,
        COMPLETED: 4,
        CANCELLED: 1,
      }),
    );
    expect(summary).toEqual({
      all: 12,
      open: 3,
      waiting: 4,
      closed: 5,
    });
  });

  /*
    NEGATÍV KONTROLL: ha a "nyitott" számláló véletlenül a mai
    (szélesebb, várakozókat is tartalmazó) definíciót használná, ez az
    állítás elbukna -- a várakozó tételek itt SZÁNDÉKOSAN nagyok, hogy a
    hiba ne tudjon véletlenül nullával egybeesni.
  */
  it("a várakozó jegyek NEM kerülnek a nyitott csempébe", () => {
    const summary = pilotTabCounts(
      counts({ NEW: 1, WAITING_FOR_PARTS: 9, WAITING_FOR_CUSTOMER: 9 }),
    );
    expect(summary.open).toBe(1);
    expect(summary.waiting).toBe(18);
  });
});
