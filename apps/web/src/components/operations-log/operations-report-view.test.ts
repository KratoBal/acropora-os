import type { WorksheetDepartmentSummary } from "@acropora/types";
import { describe, expect, it } from "vitest";

import {
  defaultMonth,
  departmentOptions,
  monthOrDefault,
} from "./operations-report-view";

const dep = (
  id: string,
  name: string,
  parentId: string | null,
): WorksheetDepartmentSummary =>
  ({
    id,
    name,
    parentId,
    code: id.toUpperCase(),
  }) as WorksheetDepartmentSummary;

describe("a havi kimutatás oldalának logikája", () => {
  it("a helyszín címkéje a teljes ág, a sorrend magyar ábécé szerint, a szülő a gyerek előtt", () => {
    const options = departmentOptions([
      dep("d2", "Nagy főmedence", "d1"),
      dep("d1", "Biodóm", null),
      dep("d3", "Állatház", null),
    ]);
    expect(options.map((option) => option.label)).toEqual([
      "Állatház",
      "Biodóm",
      "Biodóm / Nagy főmedence",
    ]);
  });

  it("a körré záródott szülő-lánc nem fagyasztja le a bejárást", () => {
    const options = departmentOptions([dep("a", "A", "b"), dep("b", "B", "a")]);
    expect(options).toHaveLength(2);
    expect(options.every((option) => option.label.length < 20)).toBe(true);
  });

  it("az alapértelmezett hónap az aktuális, a hibás URL-érték az alapértékre esik", () => {
    const now = new Date(2026, 10, 20);
    expect(defaultMonth(now)).toBe("2026-11");
    expect(monthOrDefault("2026-09", now)).toBe("2026-09");
    for (const bad of [null, "", "2026-13", "2026-9", "abc"])
      expect(monthOrDefault(bad, now)).toBe("2026-11");
  });
});
