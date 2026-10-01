import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aquariumFindings,
  STALE_AFTER_DAYS,
  type AquariumReading,
} from "./aquarium-findings.js";

const now = new Date("2026-10-01T10:00:00Z");
const fresh = new Date("2026-09-30T08:00:00Z");

const aquarium = (over: Partial<AquariumReading>): AquariumReading => ({
  id: "aq-1",
  name: "Kitalált Reef 450",
  waterType: "TENGERI",
  targets: [],
  latest: { measuredAt: fresh, values: [] },
  ...over,
});

describe("Mérési figyelmeztetések: the rule", () => {
  it("flags a value outside the marine default range, and only that", () => {
    // marine defaults: KH 7-9, FOSZFAT 0-0.1, NITRAT 0-10
    const { alerts } = aquariumFindings(
      [
        aquarium({
          latest: {
            measuredAt: fresh,
            values: [
              { parameterCode: "FOSZFAT", value: 0.18 },
              { parameterCode: "KH", value: 8 },
              { parameterCode: "NITRAT", value: 31 },
            ],
          },
        }),
      ],
      now,
    );
    assert.equal(alerts.outOfRangeCount, 2);
    assert.deepEqual(
      alerts.items.map((i) => [i.parameterCode, i.value, i.min, i.max]).sort(),
      [
        ["FOSZFAT", 0.18, 0, 0.1],
        ["NITRAT", 31, 0, 10],
      ],
    );
  });

  it("the bounds are inclusive: a value equal to min or max is in range", () => {
    const { alerts } = aquariumFindings(
      [
        aquarium({
          latest: {
            measuredAt: fresh,
            values: [
              { parameterCode: "KH", value: 7 },
              { parameterCode: "NITRAT", value: 10 },
            ],
          },
        }),
      ],
      now,
    );
    assert.equal(alerts.outOfRangeCount, 0);
  });

  it("the aquarium's own range wins over the default, and a one-sided own range only checks that side", () => {
    const { alerts } = aquariumFindings(
      [
        aquarium({
          targets: [
            { parameterCode: "KH", min: 6, max: 7 },
            { parameterCode: "NITRAT", min: null, max: 40 },
          ],
          latest: {
            measuredAt: fresh,
            values: [
              { parameterCode: "KH", value: 8 }, // in the default, out of the own range
              { parameterCode: "NITRAT", value: 31 }, // out of the default, in the own range
            ],
          },
        }),
      ],
      now,
    );
    assert.deepEqual(
      alerts.items.map((i) => i.parameterCode),
      ["KH"],
    );
  });

  it("no range, no alert: a freshwater aquarium has no default and nothing is invented", () => {
    const { alerts, waterValues } = aquariumFindings(
      [
        aquarium({
          waterType: "EDESVIZI",
          latest: {
            measuredAt: fresh,
            values: [{ parameterCode: "NITRAT", value: 80 }],
          },
        }),
      ],
      now,
    );
    assert.equal(alerts.outOfRangeCount, 0);
    const nitrat = waterValues.parameters.find((p) => p.code === "NITRAT");
    assert.equal(nitrat?.noTarget, 1);
    assert.equal(nitrat?.inRange, 0);
  });

  it("a stale or missing reading is counted as stale, never judged on old values", () => {
    const old = new Date(now.getTime() - (STALE_AFTER_DAYS + 1) * 86_400_000);
    const { alerts, waterValues } = aquariumFindings(
      [
        aquarium({
          id: "old",
          latest: {
            measuredAt: old,
            values: [{ parameterCode: "NITRAT", value: 99 }],
          },
        }),
        aquarium({ id: "none", latest: null }),
      ],
      now,
    );
    assert.equal(alerts.staleCount, 2);
    assert.equal(alerts.outOfRangeCount, 0);
    assert.equal(waterValues.freshCount, 0);
    assert.equal(alerts.checked, 2);
  });

  it("ignores a parameter that is not valid for the aquarium's water type", () => {
    // SOTARTALOM (salinity) is marine-only
    const { alerts } = aquariumFindings(
      [
        aquarium({
          waterType: "EDESVIZI",
          targets: [{ parameterCode: "SOTARTALOM", min: 30, max: 36 }],
          latest: {
            measuredAt: fresh,
            values: [{ parameterCode: "SOTARTALOM", value: 5 }],
          },
        }),
      ],
      now,
    );
    assert.equal(alerts.outOfRangeCount, 0);
  });
});

describe("Legutóbbi vízértékek: the summary", () => {
  it("counts KH, PO4 and NO3 as in range / out of range / no target / not measured", () => {
    const { waterValues } = aquariumFindings(
      [
        aquarium({
          id: "a",
          latest: {
            measuredAt: fresh,
            values: [
              { parameterCode: "KH", value: 8 },
              { parameterCode: "FOSZFAT", value: 0.5 },
            ],
          },
        }),
        aquarium({
          id: "b",
          latest: {
            measuredAt: fresh,
            values: [{ parameterCode: "KH", value: 12 }],
          },
        }),
      ],
      now,
    );
    assert.deepEqual(waterValues.parameters, [
      { code: "KH", inRange: 1, outOfRange: 1, noTarget: 0, notMeasured: 0 },
      {
        code: "FOSZFAT",
        inRange: 0,
        outOfRange: 1,
        noTarget: 0,
        notMeasured: 1,
      },
      {
        code: "NITRAT",
        inRange: 0,
        outOfRange: 0,
        noTarget: 0,
        notMeasured: 2,
      },
    ]);
    assert.equal(waterValues.freshCount, 2);
  });
});
