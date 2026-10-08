import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AquariumMeasurementOccasion } from "@acropora/types";

import {
  deviationCount,
  formatReportMoment,
  formatReportRange,
  pickIcpReport,
  icpRows,
  icpWindow,
  measuredRows,
  previousValues,
  reportStatus,
  reportTrend,
} from "./measurement-report.js";

const occasion = (
  measuredAt: string,
  values: Array<[string, number]>,
  notes?: string,
): AquariumMeasurementOccasion =>
  ({
    id: measuredAt,
    measuredAt,
    notes,
    values: values.map(([parameterCode, value]) => ({ parameterCode, value })),
  }) as AquariumMeasurementOccasion;

/**
 * THE FIGMA SAMPLE (06, 2:470), its own numbers: the rules D1 and D2 must
 * give exactly the marks the design shows.
 */
describe("the measurement report rules (D1, D2)", () => {
  it("D1: inside OK; outside by less than the width WARN; by the width or more ALERT", () => {
    assert.equal(reportStatus(25.2, { min: 24, max: 26 }), "OK");
    assert.equal(reportStatus(7.94, { min: 8.1, max: 8.4 }), "WARN");
    assert.equal(reportStatus(9.3, { min: 7, max: 9 }), "WARN");
    assert.equal(reportStatus(0.21, { min: 0.02, max: 0.1 }), "ALERT");
    // exactly the width is no longer a warning
    assert.equal(reportStatus(11, { min: 7, max: 9 }), "ALERT");
  });

  /**
   * BARRACUDA'S EXAMPLE (#1640): on 7,8–8,4 a value of 7,2 is exactly the
   * width away, but the float difference made it a warning.
   */
  it("D1: the width compares within a tolerance, so exactly the width is an alert", () => {
    assert.equal(reportStatus(7.2, { min: 7.8, max: 8.4 }), "ALERT");
    assert.equal(reportStatus(7.21, { min: 7.8, max: 8.4 }), "WARN");
    assert.equal(reportStatus(8.4, { min: 7.8, max: 8.4 }), "OK");
    assert.equal(
      reportTrend(0.3, 0.1 + 0.2, { min: 0, max: 0.2 }),
      "STABLE",
      "0.1 + 0.2 and 0.3 are the same distance",
    );
  });

  it("D1: a one-sided range uses 10% of its bound", () => {
    assert.equal(reportStatus(395, { min: 400 }), "WARN");
    assert.equal(reportStatus(355, { min: 400 }), "ALERT");
    assert.equal(reportStatus(1.05, { max: 1 }), "WARN");
    assert.equal(formatReportRange({ min: 400 }, "mg/l"), "min. 400 mg/l");
    assert.equal(formatReportRange({ max: 0.1 }, "mg/l"), "max. 0,1 mg/l");
  });

  it("D2: closer is improving, farther worsening, both inside stable", () => {
    assert.equal(reportTrend(25.2, 25.5, { min: 24, max: 26 }), "STABLE");
    assert.equal(reportTrend(7.94, 7.8, { min: 8.1, max: 8.4 }), "IMPROVING");
    assert.equal(reportTrend(9.3, 9.6, { min: 7, max: 9 }), "IMPROVING");
    assert.equal(reportTrend(0.21, 0.16, { min: 0.02, max: 0.1 }), "WORSENING");
    assert.equal(reportTrend(0.21, undefined, { min: 0.02, max: 0.1 }), null);
  });
});

describe("the measurement report rows", () => {
  const current = occasion("2026-10-08T08:45:00.000Z", [
    ["HOMERSEKLET", 25.2],
    ["PH", 7.94],
    ["FOSZFAT", 0.21],
  ]);
  const older = occasion("2026-10-01T08:00:00.000Z", [
    ["PH", 7.8],
    ["FOSZFAT", 0.16],
  ]);
  const oldest = occasion("2026-09-20T08:00:00.000Z", [["HOMERSEKLET", 25.5]]);
  const later = occasion("2026-10-09T08:00:00.000Z", [["PH", 8.2]]);

  it("the previous value is the latest earlier measurement of that parameter", () => {
    const previous = previousValues([later, oldest, current, older], current);
    assert.equal(previous.get("PH"), 7.8);
    assert.equal(previous.get("HOMERSEKLET"), 25.5);
    assert.equal(previous.has("FOSZFAT"), true);
  });

  it("a marine aquarium gets marks from the default range, and the count", () => {
    const rows = measuredRows(
      current,
      previousValues([older, oldest, current], current),
      "TENGERI",
      [],
    );
    const ph = rows.find((r) => r.label === "pH")!;
    assert.equal(ph.measured, "7,94");
    assert.equal(ph.previous, "7,8");
    assert.equal(ph.status, "WARN");
    assert.equal(ph.direction, "LOW");
    assert.equal(ph.trend, "IMPROVING");
    const po4 = rows.find((r) => r.label === "Foszfát")!;
    assert.equal(po4.status, "ALERT");
    assert.equal(po4.trend, "WORSENING");
    assert.equal(deviationCount(rows), 2);
  });

  it("D5: freshwater without its own target has no mark; with one, it has", () => {
    const fresh = occasion("2026-10-08T08:45:00.000Z", [["PH", 7.94]]);
    const none = measuredRows(fresh, new Map(), "EDESVIZI", []);
    assert.equal(none[0]!.status, null);
    assert.equal(none[0]!.target, null);
    assert.equal(deviationCount(none), 0);
    const own = measuredRows(fresh, new Map(), "EDESVIZI", [
      { parameterCode: "PH", min: 6.5, max: 7.5 },
    ]);
    assert.equal(own[0]!.status, "WARN");
    assert.equal(own[0]!.target, "6,5–7,5");
  });

  it("ICP rows take the laboratory's range", () => {
    const rows = icpRows([
      {
        elementCode: "Sr",
        value: 9.1,
        unit: "mg/l",
        minimum: 7,
        maximum: 9,
        trend: null,
      },
      {
        elementCode: "Ba",
        value: 0.02,
        unit: "mg/l",
        minimum: null,
        maximum: null,
        trend: null,
      },
    ]);
    assert.equal(rows[0]!.status, "WARN");
    assert.equal(rows[0]!.target, "7–9 mg/l");
    assert.equal(rows[1]!.status, null);
  });

  it("D3: the latest report in the window, by its sampling day or else its upload day", () => {
    const window = icpWindow("2026-10-15T10:00:00.000Z");
    const sampled = {
      id: "a",
      sampledAt: new Date("2026-10-05T00:00:00Z"),
      createdAt: new Date("2026-10-14T00:00:00Z"),
    };
    const unsampled = {
      id: "b",
      sampledAt: null,
      createdAt: new Date("2026-10-10T00:00:00Z"),
    };
    const old = {
      id: "c",
      sampledAt: null,
      createdAt: new Date("2026-09-01T00:00:00Z"),
    };
    // the sampled one counts from 10-05 (not its upload on 10-14), so the
    // report without a sampling day, uploaded on 10-10, is the latest
    assert.equal(pickIcpReport([sampled, unsampled, old], window)?.id, "b");
    assert.equal(pickIcpReport([sampled], window)?.id, "a");
    assert.equal(pickIcpReport([old], window), null);
  });

  it("D3: the ICP window is the 14 days before the occasion", () => {
    const w = icpWindow("2026-10-15T10:00:00.000Z");
    assert.equal(w.to.toISOString(), "2026-10-15T10:00:00.000Z");
    assert.equal(w.from.toISOString(), "2026-10-01T10:00:00.000Z");
  });

  it("the moment is in Budapest time, written out", () => {
    assert.equal(
      formatReportMoment("2026-10-08T08:45:00.000Z"),
      "2026. október 8. 10:45",
    );
  });
});
