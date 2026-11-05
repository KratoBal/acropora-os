import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { backfillSummary, feedGaps, feedSeries } from "./feed-backfill.js";

/*
  A FEED HÉZAGAI (6fd8c574; acrobot 43766). MI PIROSÍT: ha egy hiányzó szám kimarad, vagy egy tárolt szám mégis a
  hiányzók közé kerül; ha a szám rossz szélességgel megy a Számlázz.hu-ra (`69` a `00069` helyett: az Agent pontos
  számot kér); ha a díjbekérő sorozata vagy egy másik év is bekerül; ha az előtag nélküli sorozat elveszik; ha a
  lap nem tudja sorozatonként megmondani, hányat ismer a Számlázz.hu.
*/
const sz = (documentNumber: string, kindCode = "SZ") => ({
  documentNumber,
  kindCode,
});

describe("the feed's gaps", () => {
  it("every number below the highest stored one, padded like the stored ones, per series", () => {
    const gaps = feedGaps(
      [
        sz("ACRW-2026/00003"),
        sz("ACRW-2026/00005"),
        sz("2026/00002"),
        sz("2026/00004"),
      ],
      2026,
    );
    assert.deepEqual(gaps, [
      {
        series: "2026",
        highest: "2026/00004",
        missing: ["2026/00001", "2026/00003"],
      },
      {
        series: "ACRW-2026",
        highest: "ACRW-2026/00005",
        missing: ["ACRW-2026/00001", "ACRW-2026/00002", "ACRW-2026/00004"],
      },
    ]);
  });

  it("a proforma-only series, another year and an unreadable number stay out", () => {
    const gaps = feedGaps(
      [
        sz("D-ACRW-2026/00004", "D"),
        sz("ACRW-2025/00009"),
        sz("COD-2026.11.03"),
        sz("ACRW-2026/00002", "SZ"),
      ],
      2026,
    );
    assert.deepEqual(
      gaps.map((g) => [g.series, g.missing]),
      [["ACRW-2026", ["ACRW-2026/00001"]]],
    );
  });

  it("names a number's series", () => {
    assert.equal(feedSeries("ACRW-2026/00419"), "ACRW-2026");
    assert.equal(feedSeries("2026/00069"), "2026");
    assert.equal(feedSeries("jóváírás 2026-11-04"), null);
  });

  it("counts the answers per series and outcome", () => {
    assert.deepEqual(
      backfillSummary([
        { series: "ACRW-2026", outcome: "WOULD_STORE" },
        { series: "ACRW-2026", outcome: "NOT_FOUND" },
        { series: "ACRW-2026", outcome: "WOULD_STORE" },
        { series: "2026", outcome: "STORED" },
      ]),
      {
        "ACRW-2026": { WOULD_STORE: 2, NOT_FOUND: 1 },
        "2026": { STORED: 1 },
      },
    );
  });
});
