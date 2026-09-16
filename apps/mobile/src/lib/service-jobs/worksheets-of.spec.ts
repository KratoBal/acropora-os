import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceJobTimelineEntry, ServiceJobWorksheetLink } from "./types";
import { worksheetLineLabel, worksheetsOf } from "./service-job-status";

/**
 * A MUNKALAPOK AZ IDŐVONALBÓL JÖNNEK -- ÉS EZ EGY ÖSSZEOMLÁS JAVÍTÁSA.
 *
 * A képernyő első alakja `detail.worksheets`-et olvasott. A szerver válaszában
 * olyan kulcs NINCS: `undefined.length`, vagyis az adatlap MEG SEM NYÍLT volna.
 * Amit a közös csomagban `worksheets: ServiceJobWorksheetLink[]` alakban láttam,
 * az a `serviceJobTimeline()` FÜGGVÉNY paramétere, nem a válasz típusa.
 */
const lap = (
  id: string,
  over: Partial<ServiceJobWorksheetLink> = {},
): ServiceJobWorksheetLink => ({
  id,
  number: `MUNKA-${id}`,
  subject: `Lap ${id}`,
  createdAt: "2026-09-16T10:00:00.000Z",
  handedOverAt: null,
  ...over,
});

const naplo: ServiceJobTimelineEntry[] = [
  { kind: "status", at: "2026-09-16T12:00:00.000Z", sortKey: "s1" },
  {
    kind: "worksheet",
    at: "2026-09-16T11:00:00.000Z",
    sortKey: "w1",
    worksheet: lap("1"),
  },
  {
    kind: "asset",
    at: "2026-09-16T10:30:00.000Z",
    sortKey: "a1",
    asset: {
      id: "link-1",
      assetId: "asset-1",
      assetNumber: "ESZ-0007",
      assetName: "Szivattyú",
      attachedAt: "2026-09-16T10:30:00.000Z",
    },
  },
  {
    kind: "worksheet",
    at: "2026-09-16T09:00:00.000Z",
    sortKey: "w2",
    worksheet: lap("2", { number: null, subject: "Kiszállás" }),
  },
  { kind: "document", at: "2026-09-16T08:00:00.000Z", sortKey: "d1" },
];

describe("a munkalapok az időrendi naplóból", () => {
  it("csak a munkalap-bejegyzéseket veszi ki", () => {
    assert.deepEqual(
      worksheetsOf(naplo).map((sheet) => sheet.id),
      ["1", "2"],
    );
  });

  /**
   * TESTVÉR-KONTROLL: a másik három fajta NEM kerül bele. Enélkül az első
   * állítás akkor is zöld lenne, ha a szűrő mindent átengedne és a sorrend
   * véletlenül stimmelne.
   */
  it("az állapot-, eszköz- és dokumentum-sorokat kihagyja", () => {
    assert.equal(worksheetsOf(naplo).length, 2);
    assert.equal(naplo.length, 5);
  });

  it("üres naplóra üres listát ad, nem hibát", () => {
    // EZ AZ AZ ALLITAS, AMIERT A FUGGVENY LETEZIK: a regi alak itt
    // `undefined.length`-en omlott ossze.
    assert.deepEqual(worksheetsOf([]), []);
  });

  /**
   * A NAPLÓ SORRENDJE MARAD -- nem rendezünk újra. A napló a jegy TÖRTÉNETE
   * (legújabb felül), és egy saját rendezés azt állítaná, hogy a munkalapoknak
   * ettől független sorrendjük van.
   */
  it("a napló sorrendjét tartja meg", () => {
    assert.deepEqual(
      worksheetsOf(naplo).map((sheet) => sheet.subject),
      ["Lap 1", "Kiszállás"],
    );
  });
});

describe("a munkalap sora a képernyőn", () => {
  it("a NEVE áll elöl, a szám mellette", () => {
    assert.equal(worksheetLineLabel(lap("1")), "Lap 1 (MUNKA-1)");
  });

  /**
   * A PISZKOZATNAK NINCS SZAMA, ES A HELYEN SZO ALL, NEM URESSEG.
   *
   * A `null` kiirva "null" lenne, egy ures zarojel pedig ugy nezne ki, mint egy
   * hiba. A "Piszkozat" ugyanaz a szo, amit a web hasznal -- a szerelo es az
   * irodas ugyanarrol a lapról beszel.
   */
  it("a szám nélküli lap „Piszkozat”-ot mutat", () => {
    assert.equal(
      worksheetLineLabel(lap("2", { number: null, subject: "Kiszállás" })),
      "Kiszállás (Piszkozat)",
    );
  });
});
