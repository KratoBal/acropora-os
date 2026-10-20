import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DoseEffectView } from "./dose-effects.service.js";
import {
  DOSE_PROJECTION_MAX_AGE_HOURS,
  doseProjectionStatus,
  isDoseProjectionStale,
  toProjectedRow,
} from "./dose-projection.rules.js";

const NOW = new Date("2026-10-21T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

const VIEW: DoseEffectView = {
  id: "src-1",
  productId: "p-1",
  productName: "Minta KH+",
  parameterCode: "KH",
  direction: "EMEL",
  effectPer100L: 0.25,
  doseUnit: "ML",
  doseStep: 1,
  maxDailyDosePer100L: 20,
  effectHours: 12,
  source: "Gyártói címke (teszt)",
  version: 4,
  recordedBy: null,
  recordedByName: null,
  recordedAt: "2026-10-01T08:00:00.000Z",
  verifiedBy: null,
  verifiedAt: null,
  archivedAt: null,
  archivedBy: null,
  usable: false,
  refusals: ["NOT_VERIFIED", "JEV_DISAGREES"],
  jevStatus: "NONE",
};

describe("a vetített sor", () => {
  it("a FORRÁS verzióját és számait viszi, a kizáró okokkal; készlet és ár ismeretlen", () => {
    assert.deepEqual(toProjectedRow(VIEW), {
      sourceId: "src-1",
      sourceVersion: 4,
      productId: "p-1",
      productName: "Minta KH+",
      parameterCode: "KH",
      direction: "EMEL",
      effectPer100L: 0.25,
      doseUnit: "ML",
      doseStep: 1,
      maxDailyDosePer100L: 20,
      effectHours: 12,
      source: "Gyártói címke (teszt)",
      refusals: ["NOT_VERIFIED", "JEV_DISAGREES"],
      inStock: null,
      pricePerDoseUnit: null,
    });
  });

  it("az élő sor kizáró oka üres; a lista másolata nem osztozik a forrással", () => {
    const live = { ...VIEW, refusals: [] };
    assert.deepEqual(toProjectedRow(live).refusals, []);
    const row = toProjectedRow(VIEW);
    row.refusals.push("ARCHIVED");
    assert.equal(VIEW.refusals.length, 2);
  });
});

describe("a vetítés kora: az utolsó SIKERES teljes építés", () => {
  it("nincs építés: elavult; a határ (26 óra) még nem, fölötte már igen", () => {
    assert.equal(isDoseProjectionStale(null, NOW), true);
    assert.equal(DOSE_PROJECTION_MAX_AGE_HOURS, 26);
    assert.equal(isDoseProjectionStale(hoursAgo(1), NOW), false);
    assert.equal(isDoseProjectionStale(hoursAgo(26), NOW), false);
    assert.equal(isDoseProjectionStale(hoursAgo(26.01), NOW), true);
  });
});

describe("az állapot, amit a vezérlőpult olvas", () => {
  const record = (hours: number, over: object = {}) => ({
    trigger: "SCHEDULE",
    startedAt: hoursAgo(hours + 0.01),
    finishedAt: hoursAgo(hours),
    rowCount: 12,
    errorMessage: null,
    ...over,
  });

  it("friss siker, nincs hiba", () => {
    const status = doseProjectionStatus({
      success: record(0.5),
      failure: null,
      rowCount: 12,
      now: NOW,
    });
    assert.equal(status.stale, false);
    assert.equal(status.ageHours, 0.5);
    assert.equal(status.failingSinceLastSuccess, false);
    assert.equal(status.lastFailure, null);
    assert.equal(status.lastSuccess?.rowCount, 12);
  });

  it("a siker után jött hiba: az építő MOST bukik, a szöveggel, és a vetítés még friss", () => {
    const status = doseProjectionStatus({
      success: record(3),
      failure: record(1, {
        rowCount: null,
        errorMessage: "kapcsolat megszakadt",
      }),
      rowCount: 12,
      now: NOW,
    });
    assert.equal(status.failingSinceLastSuccess, true);
    assert.equal(status.lastFailure?.errorMessage, "kapcsolat megszakadt");
    assert.equal(status.stale, false);
  });

  it("egy régebbi hibát a későbbi siker lezár, de a hiba látszik", () => {
    const status = doseProjectionStatus({
      success: record(1),
      failure: record(5, { rowCount: null, errorMessage: "régi hiba" }),
      rowCount: 12,
      now: NOW,
    });
    assert.equal(status.failingSinceLastSuccess, false);
    assert.equal(status.lastFailure?.errorMessage, "régi hiba");
  });

  it("nincs siker: elavult, kor nélkül; hiba mellett is", () => {
    const status = doseProjectionStatus({
      success: null,
      failure: record(1, { rowCount: null, errorMessage: "x" }),
      rowCount: 0,
      now: NOW,
    });
    assert.equal(status.stale, true);
    assert.equal(status.ageHours, null);
    assert.equal(status.failingSinceLastSuccess, true);
    assert.equal(status.lastSuccess, null);
  });

  it("a régi siker elavult, hiba nélkül is: a kapu a biztonsági háló", () => {
    const status = doseProjectionStatus({
      success: record(30),
      failure: null,
      rowCount: 12,
      now: NOW,
    });
    assert.equal(status.stale, true);
    assert.equal(status.ageHours, 30);
  });
});
