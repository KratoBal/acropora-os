import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  backfillReportLine,
  CustomerTaxNumberBackfillReporter,
  type BackfillEvent,
  type CustomerTaxNumberBackfillRepository,
} from "./customer-tax-number-backfill.reporter.js";

/**
 * A VISSZATÖLTÉS SZÁMAI AZ API NAPLÓJÁBA (acrobot 42502). MI PIROSÍT: ha a sor alakja
 * eltér attól, amit a flotta keres; ha a hiányzó esemény is sort ír; ha tizennégy nap
 * után is ír; ha egy olvasási hiba megállítja az indulást.
 */
const event = (over: Partial<BackfillEvent> = {}): BackfillEvent => ({
  payload: { filled: 12, conflicting: 2, notHungarian: 1 },
  occurredAt: new Date("2026-11-04T16:00:00.000Z"),
  ...over,
});

describe("a visszatöltés naplósora", () => {
  it("a számokat a flotta által keresett alakban írja", () => {
    assert.equal(
      backfillReportLine(event(), new Date("2026-11-04T16:05:00.000Z")),
      "VEVO-ADOSZAM-VISSZATOLTES kitoltve=12 kimaradt_ellentmondas=2 kimaradt_nem_magyar=1",
    );
  });

  it("esemény nélkül és tizennégy nap után nem ír; a hiányzó számot kérdőjel jelzi", () => {
    assert.equal(backfillReportLine(null, new Date()), null);
    assert.equal(
      backfillReportLine(event(), new Date("2026-11-19T16:00:01.000Z")),
      null,
    );
    assert.equal(
      backfillReportLine(
        event({ payload: { filled: 3 } }),
        new Date("2026-11-04T16:05:00.000Z"),
      ),
      "VEVO-ADOSZAM-VISSZATOLTES kitoltve=3 kimaradt_ellentmondas=? kimaradt_nem_magyar=?",
    );
  });

  it("az olvasási hiba sort ír, és nem dob", async () => {
    const reporter = new CustomerTaxNumberBackfillReporter({
      event: async () => {
        throw new RangeError("adatbázis");
      },
    } as unknown as CustomerTaxNumberBackfillRepository);
    assert.equal(
      await reporter.report(new Date()),
      "VEVO-ADOSZAM-VISSZATOLTES HIBA ok=RangeError",
    );
  });
});
