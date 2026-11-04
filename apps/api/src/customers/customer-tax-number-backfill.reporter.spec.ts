import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  backfillMeasureLines,
  backfillReportLine,
  CustomerTaxNumberBackfillReporter,
  type BackfillEvent,
  type BackfillMeasure,
  type CustomerTaxNumberBackfillRepository,
} from "./customer-tax-number-backfill.reporter.js";

/**
 * A VISSZATÖLTÉS SZÁMAI AZ API NAPLÓJÁBA (acrobot 42502). MI PIROSÍT: ha a sor alakja
 * eltér attól, amit a flotta keres; ha a hiányzó esemény is sort ír; ha tizennégy nap
 * után is ír; ha egy olvasási hiba megállítja az indulást.
 */
const event = (over: Partial<BackfillEvent> = {}): BackfillEvent => ({
  payload: {
    filled: 12,
    conflicting: 2,
    notHungarian: 1,
    persons: 4,
    filledIds: ["c1"],
  },
  occurredAt: new Date("2026-11-04T16:00:00.000Z"),
  ...over,
});

describe("a visszatöltés naplósora", () => {
  it("a számokat a flotta által keresett alakban írja", () => {
    assert.equal(
      backfillReportLine(event(), new Date("2026-11-04T16:05:00.000Z")),
      "VEVO-ADOSZAM-VISSZATOLTES kitoltve=12 kimaradt_ellentmondas=2 kimaradt_nem_magyar=1 kimaradt_maganszemely=4",
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
      "VEVO-ADOSZAM-VISSZATOLTES kitoltve=3 kimaradt_ellentmondas=? kimaradt_nem_magyar=? kimaradt_maganszemely=?",
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

/*
  A MÉRÉS SORAI (acrobot 42586): soronként egy szám, hogy a karantén-összegző ne hagyja el.
  MI PIROSÍT: ha két szám egy sorba kerül; ha egy kulcs hiányzik; ha a visszatöltés számai
  nem jönnek újra; ha a mérés a visszatöltés sora nélkül (vagy tizennégy nap után) is fut.
*/
describe("a mérés sorai", () => {
  const measure: BackfillMeasure = {
    unasOrders: 900,
    unasOrdersWithTax: 60,
    unasOrdersWithTaxLinked: 40,
    unasOrdersWithTaxUnasCustomer: 38,
    unasCustomers: 430,
    unasCustomersPerson: 400,
    unasCustomersCompany: 30,
    unasCustomersWithCompanyTaxedOrder: 12,
  };

  it("minden szám saját sorban, és a visszatöltés számai újra", () => {
    assert.deepEqual(backfillMeasureLines(measure, event()), [
      "VEVO-ADOSZAM-MERES unas_rendeles=900",
      "VEVO-ADOSZAM-MERES unas_rendeles_adoszammal=60",
      "VEVO-ADOSZAM-MERES unas_rendeles_adoszammal_vevohoz_kotve=40",
      "VEVO-ADOSZAM-MERES unas_rendeles_adoszammal_unas_vevohoz=38",
      "VEVO-ADOSZAM-MERES unas_vevo=430",
      "VEVO-ADOSZAM-MERES unas_vevo_maganszemely=400",
      "VEVO-ADOSZAM-MERES unas_vevo_ceg=30",
      "VEVO-ADOSZAM-MERES unas_vevo_ceges_adoszamos_rendelessel=12",
      "VEVO-ADOSZAM-VISSZATOLTES kitoltve=12",
      "VEVO-ADOSZAM-VISSZATOLTES kimaradt_ellentmondas=2",
      "VEVO-ADOSZAM-VISSZATOLTES kimaradt_nem_magyar=1",
      "VEVO-ADOSZAM-VISSZATOLTES kimaradt_maganszemely=4",
    ]);
  });

  it("a mérés a visszatöltés sorával fut, tizennégy nap után nem", async () => {
    const logged: string[] = [];
    let measured = 0;
    const reporter = new CustomerTaxNumberBackfillReporter({
      event: async () => event(),
      measure: async () => {
        measured += 1;
        return measure;
      },
    } as unknown as CustomerTaxNumberBackfillRepository);
    (reporter as unknown as { logger: { log: (l: string) => void } }).logger = {
      log: (line: string) => logged.push(line),
    };
    await reporter.report(new Date("2026-11-04T18:00:00.000Z"));
    assert.equal(measured, 1);
    assert.equal(logged.length, 13);
    await reporter.report(new Date("2026-11-20T18:00:00.000Z"));
    assert.equal(measured, 1, "no measurement after fourteen days");
  });
});
