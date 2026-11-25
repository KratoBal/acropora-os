import type { ServiceJobStatusCounts } from "@acropora/types";
import { describe, expect, it } from "vitest";

import {
  assigneeNames,
  pilotStatTiles,
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

const common = (
  overrides: Partial<Parameters<typeof pilotTabCounts>[0]> = {},
) => ({ NEW: 0, IN_PROGRESS: 0, WAITING: 0, DONE: 0, CLOSED: 0, ...overrides });

describe("a fülek a közös öt állapoton (kártya 7f23785c)", () => {
  it("a sorrend és a felirat picasso 4. pontja szerint", () => {
    expect(PILOT_TABS.map((tab) => tab.label)).toEqual([
      "Nyitott",
      "Vár valamire",
      "Lezárt",
      "Összes",
    ]);
  });

  /*
    AZ ELKÉSZÜLT A NYITOTTBA ESIK (picasso 4. pont: még teendő van vele), és a
    szerver a KÖZÖS állapotot kapja szűrőnek, nem a tárolt nyolcat: a
    levezetett Elkészült a tárolt IN_PROGRESS egy része, és csak a szerver
    tudja kettéválasztani.
  */
  it("minden fül a közös állapotokat kéri a szervertől", () => {
    expect(
      PILOT_TABS.map((tab) => [tab.id, tab.scope, tab.commonStatuses]),
    ).toEqual([
      ["open", "open", ["NEW", "IN_PROGRESS", "DONE"]],
      ["waiting", "open", ["WAITING"]],
      ["closed", "all", ["CLOSED"]],
      ["all", "all", null],
    ]);
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
  it("a négy szám a közös számlálóból, az Elkészült a nyitottban", () => {
    expect(
      pilotTabCounts(
        common({ NEW: 2, IN_PROGRESS: 3, WAITING: 4, DONE: 5, CLOSED: 6 }),
      ),
    ).toEqual({ open: 10, waiting: 4, closed: 6, all: 20 });
  });

  /*
    NEGATÍV KONTROLL: ha a "nyitott" a várakozókat is számolná, vagy az
    Elkészültet kihagyná, ez elbukna; a két tétel szándékosan nagy, hogy a
    hiba ne essen egybe a helyes számmal.
  */
  it("a várakozó nem nyitott, az elkészült igen", () => {
    const summary = pilotTabCounts(common({ NEW: 1, WAITING: 9, DONE: 7 }));
    expect(summary.open).toBe(8);
    expect(summary.waiting).toBe(9);
  });
});

describe("a redesign listájának segédjei", () => {
  it("a felelősök nevei vesszővel, üres listán null", () => {
    expect(assigneeNames([{ name: "Ádám" }, { name: "Péter" }])).toBe(
      "Ádám, Péter",
    );
    expect(assigneeNames([])).toBeNull();
  });

  it("a csempék a számlálókból jönnek, kitalált szám nélkül", () => {
    const tiles = pilotStatTiles(
      counts({ SCHEDULED: 3, WAITING_FOR_PARTS: 2, COMPLETED: 4 }),
      common({ IN_PROGRESS: 3, WAITING: 2, CLOSED: 4 }),
    );
    expect(tiles.map((tile) => [tile.label, tile.value, tile.detail])).toEqual([
      ["Nyitott hibajegy", 3, null],
      ["Vár valamire", 2, "2 alkatrészre"],
      ["Lezárt ügy", 4, null],
    ]);
  });

  it("a csempe alcíme kimondja az újat, az elkészültet és a meghiúsultat", () => {
    const tiles = pilotStatTiles(
      counts({ NEW: 1, IN_PROGRESS: 2, COMPLETED: 3, CANCELLED: 2 }),
      common({ NEW: 1, IN_PROGRESS: 1, DONE: 1, CLOSED: 5 }),
    );
    expect(tiles.map((tile) => tile.detail)).toEqual([
      "1 új · 1 elkészült",
      null,
      "2 meghiúsult",
    ]);
  });
});
