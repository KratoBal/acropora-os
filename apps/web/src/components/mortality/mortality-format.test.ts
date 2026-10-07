import { describe, expect, it } from "vitest";

import {
  aquariumLabel,
  budapestDay,
  longDateTime,
  longDay,
  monthCardTitle,
  periodRange,
  shortDateTime,
  shortDay,
  sourceTitle,
  weekComparison,
} from "./mortality-format";

// 2026-10-06 20:30 Budapest (CEST)
const NOW = new Date("2026-10-06T18:30:00Z");

describe("periodRange", () => {
  it("nincs időszak: nincs szűrés", () => {
    expect(periodRange("", NOW)).toBeNull();
  });

  it("ma, az utolsó 7 nap, ez a hónap", () => {
    expect(periodRange("ma", NOW)).toEqual({
      from: "2026-10-06",
      to: "2026-10-06",
    });
    expect(periodRange("7nap", NOW)).toEqual({
      from: "2026-09-30",
      to: "2026-10-06",
    });
    expect(periodRange("honap", NOW)).toEqual({
      from: "2026-10-01",
      to: "2026-10-06",
    });
  });

  it("az előző hónap teljes egészében, évváltáskor is", () => {
    expect(periodRange("elozo-honap", NOW)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(
      periodRange("elozo-honap", new Date("2027-01-10T10:00:00Z")),
    ).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });

  it("Budapest napja szerint: UTC-ben még tegnap van", () => {
    // 2026-11-01 00:30 Budapest (CET) = 2026-10-31 23:30 UTC
    const justAfterMidnight = new Date("2026-10-31T23:30:00Z");
    expect(budapestDay(justAfterMidnight)).toBe("2026-11-01");
    expect(periodRange("honap", justAfterMidnight)).toEqual({
      from: "2026-11-01",
      to: "2026-11-01",
    });
  });
});

describe("feliratok", () => {
  it("a hónap kártyájának címe ragozva", () => {
    expect(monthCardTitle(NOW)).toBe("Elhullás októberben");
    expect(monthCardTitle(new Date("2026-03-15T10:00:00Z"))).toBe(
      "Elhullás márciusban",
    );
  });

  it("a heti összevetés mindhárom iránya", () => {
    expect(weekComparison({ last7Days: 5, previous7Days: 7 })).toBe(
      "2 példánnyal kevesebb, mint az előző héten",
    );
    expect(weekComparison({ last7Days: 4, previous7Days: 1 })).toBe(
      "3 példánnyal több, mint az előző héten",
    );
    expect(weekComparison({ last7Days: 2, previous7Days: 2 })).toBe(
      "Ugyanannyi, mint az előző héten",
    );
  });

  it("akvárium és forrás", () => {
    expect(
      aquariumLabel({ aquariumNumber: "A-12", name: "Tengeri halak" }),
    ).toBe("A-12 · Tengeri halak");
    expect(
      sourceTitle({
        type: "SUPPLIER",
        supplier: { id: "s", name: "De Jong Marinelife" },
        note: null,
      }),
    ).toBe("De Jong Marinelife");
    expect(
      sourceTitle({ type: "LOCAL_BREEDER", supplier: null, note: "Béla" }),
    ).toBe("Helyi tenyésztő");
  });

  it("az időpontok Budapest szerint, a Figma alakjában", () => {
    expect(shortDateTime("2026-10-06T07:42:00Z")).toBe("2026.10.06. 09:42");
    expect(longDateTime("2026-10-06T07:42:00Z")).toBe(
      "2026. október 6. · 09:42",
    );
  });

  it("az elhullás napja zóna nélkül: a nap az, ami tárolva van", () => {
    expect(shortDay("2026-10-05")).toBe("2026.10.05.");
    expect(longDay("2026-10-05")).toBe("2026. október 5.");
    expect(longDay("2026-01-31")).toBe("2026. január 31.");
  });
});
