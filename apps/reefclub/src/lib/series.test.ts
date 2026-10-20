import { describe, expect, it } from "vitest";

import {
  latestTarget,
  measuredParameters,
  parameterLabel,
  seriesFor,
} from "./series";
import type { ReefClubOccasion } from "./types";

const value = (
  parameterCode: string,
  v: number,
  target: { min: number | null; max: number | null } | null = null,
) => ({
  parameterCode,
  value: v,
  unit: "",
  target,
  status: null,
  direction: null,
  trend: null,
});
const occ = (
  measuredAt: string,
  values: ReturnType<typeof value>[],
): ReefClubOccasion => ({
  id: measuredAt,
  measuredAt,
  source: "MANUAL",
  values,
});

// the API lists the newest first
const OCCASIONS = [
  occ("2026-10-03T10:00:00.000Z", [
    value("PH", 8.3, { min: 8, max: 8.4 }),
    value("KH", 7.5),
  ]),
  occ("2026-10-01T10:00:00.000Z", [value("PH", 8.1, { min: 8, max: 8.4 })]),
  occ("2026-10-02T10:00:00.000Z", [value("NITRAT", 4)]),
];

describe("series", () => {
  it("gives one parameter's values oldest first, skipping occasions without it", () => {
    expect(seriesFor("PH", OCCASIONS).map((p) => p.value)).toEqual([8.1, 8.3]);
    expect(seriesFor("NITRAT", OCCASIONS).map((p) => p.measuredAt)).toEqual([
      "2026-10-02T10:00:00.000Z",
    ]);
    expect(seriesFor("GH", OCCASIONS)).toEqual([]);
  });

  it("lists only the measured parameters, in the catalog's order, and keeps an unknown code visible", () => {
    expect(measuredParameters(OCCASIONS)).toEqual(["PH", "KH", "NITRAT"]);
    expect(
      measuredParameters([
        occ("2026-10-01T10:00:00.000Z", [value("XYZ", 1), value("PH", 8)]),
      ]),
    ).toEqual(["PH", "XYZ"]);
    expect(parameterLabel("PH")).toBe("pH");
    expect(parameterLabel("XYZ")).toBe("XYZ");
  });

  it("takes the band from the NEWEST value of the parameter, whatever the order of the list", () => {
    const list = [
      occ("2026-10-01T10:00:00.000Z", [value("PH", 8.1, { min: 7, max: 9 })]),
      occ("2026-10-03T10:00:00.000Z", [value("PH", 8.3, { min: 8, max: 8.4 })]),
    ];
    expect(latestTarget("PH", list)).toEqual({ min: 8, max: 8.4 });
    expect(latestTarget("GH", list)).toBeNull();
  });
});
