import assert from "node:assert/strict";
import { test } from "node:test";

import {
  budapestDayKey,
  buildOperationsReport,
  isMonthKey,
  mondayOf,
  monthBounds,
  type OperationsReportEntryInput,
  type OperationsReportScheduleInput,
} from "./operations-report.js";
import {
  operationsDurationText,
  operationsMonthTitle,
  operationsNumberText,
  operationsPeriodText,
  operationsSignedNumberText,
} from "./operations-report-format.js";

/*
  MI PIROSIT: ha a nap határa az UTC-éjfél (a késő esti bejegyzés a másik napra esne); ha a hónap határa nyáron vagy télen eltolódna
  (a március-április váltás); ha a vízóra-különbség nem „utána mínusz előtte" (vagy hiányzó érték mellett is szám lenne); ha a partner
  nézete a kollégák nevét kiadná; ha a mai nap vagy a jövő kimaradásnak számítana; ha a sablon létrehozásának napja még kimaradás
  lehetne; ha a hét-határon átnyúló hét a hónap előtti bejegyzést nem látná; ha a kivezetett vagy az alkalmi sablon kimaradást
  adna; ha a kimutatás a hónapon kívüli bejegyzést is sorolná.
*/
test("a nap budapesti: a késő esti bejegyzés az adott napé, télen és nyáron is", () => {
  assert.equal(budapestDayKey("2026-11-12T23:30:00.000Z"), "2026-11-13");
  assert.equal(budapestDayKey("2026-11-12T22:30:00.000Z"), "2026-11-12");
  assert.equal(budapestDayKey("2026-07-12T22:30:00.000Z"), "2026-07-13");
  assert.equal(budapestDayKey("2026-07-12T21:30:00.000Z"), "2026-07-12");
});

test("a hónap határa a budapesti éjfél, az időszámítás váltása is jó", () => {
  const nov = monthBounds("2026-11");
  assert.equal(nov.start.toISOString(), "2026-10-31T23:00:00.000Z");
  assert.equal(nov.end.toISOString(), "2026-11-30T23:00:00.000Z");
  // március: a hónap CET-ben indul (+1), és CEST-ben ér véget (+2)
  const march = monthBounds("2026-03");
  assert.equal(march.start.toISOString(), "2026-02-28T23:00:00.000Z");
  assert.equal(march.end.toISOString(), "2026-03-31T22:00:00.000Z");
  const december = monthBounds("2026-12");
  assert.equal(december.end.toISOString(), "2026-12-31T23:00:00.000Z");
  assert.throws(() => monthBounds("2026-13"));
  assert.equal(isMonthKey("2026-11"), true);
  assert.equal(isMonthKey("2026-1"), false);
  assert.equal(isMonthKey("2026-00"), false);
});

test("a hét hétfője: a vasárnap az előző hétfőhöz tartozik", () => {
  assert.equal(mondayOf("2026-11-13"), "2026-11-09"); // péntek
  assert.equal(mondayOf("2026-11-15"), "2026-11-09"); // vasárnap
  assert.equal(mondayOf("2026-11-09"), "2026-11-09"); // hétfő
  assert.equal(mondayOf("2026-11-01"), "2026-10-26"); // vasárnap, hónap-határ
});

function entry(
  id: string,
  startedAt: string,
  over: Partial<OperationsReportEntryInput> = {},
): OperationsReportEntryInput {
  return {
    id,
    templateId: "t1",
    templateName: "Visszamosás",
    frequency: "WEEKLY",
    assetId: "a1",
    assetLabel: "E-1 Szűrő",
    startedAt,
    finishedAt: new Date(Date.parse(startedAt) + 25 * 60_000).toISOString(),
    participantNames: ["Kovács Béla", "Nagy Anna"],
    anomaly: false,
    anomalyNote: null,
    serviceJob: null,
    values: [
      {
        fieldKey: "elotte",
        label: "Előtte",
        unit: "m3",
        meterRole: "BEFORE",
        value: 100,
      },
      {
        fieldKey: "utana",
        label: "Utána",
        unit: "m3",
        meterRole: "AFTER",
        value: 112.5,
      },
    ],
    ...over,
  };
}

function schedule(
  over: Partial<OperationsReportScheduleInput> = {},
): OperationsReportScheduleInput {
  return {
    templateId: "t1",
    templateName: "Visszamosás",
    frequency: "DAILY",
    isActive: true,
    createdAt: "2026-10-01T08:00:00.000Z",
    assetId: "a1",
    assetLabel: "E-1 Szűrő",
    ...over,
  };
}

const NOW = new Date("2026-11-20T09:00:00.000Z");

test("a sor: tartam, vízóra-különbség, a belső nézetben a nevek", () => {
  const report = buildOperationsReport({
    month: "2026-11",
    audience: "INTERNAL",
    entries: [entry("e1", "2026-11-12T09:00:00.000Z")],
    schedules: [],
    now: NOW,
  });
  const row = report.assets[0]!.entries[0]!;
  assert.equal(row.minutes, 25);
  assert.equal(row.meterBefore, 100);
  assert.equal(row.meterAfter, 112.5);
  assert.equal(row.meterDifference, 12.5);
  assert.equal(row.meterUnit, "m3");
  assert.equal(row.meterSuspicious, false);
  assert.deepEqual(row.performers, ["Kovács Béla", "Nagy Anna"]);
  assert.equal(report.assets[0]!.meterTotal, 12.5);
  assert.deepEqual(report.totals, {
    entries: 1,
    totalMinutes: 25,
    anomalies: 0,
    missed: 0,
  });
});

test("a partner nézete a neveket Acropora-ra cseréli, a számok ugyanazok", () => {
  const input = {
    month: "2026-11",
    entries: [
      entry("e1", "2026-11-12T09:00:00.000Z", {
        anomaly: true,
        anomalyNote: "Szivárog",
        serviceJob: { jobNumber: "HJ-1", status: "NEW" },
      }),
    ],
    schedules: [],
    now: NOW,
  };
  const internal = buildOperationsReport({ ...input, audience: "INTERNAL" });
  const partner = buildOperationsReport({ ...input, audience: "PARTNER" });
  assert.deepEqual(partner.assets[0]!.entries[0]!.performers, ["Acropora"]);
  assert.equal(JSON.stringify(partner).includes("Kovács"), false);
  assert.equal(JSON.stringify(partner).includes("Nagy Anna"), false);
  assert.deepEqual(partner.totals, internal.totals);
  assert.equal(partner.assets[0]!.entries[0]!.ticket?.jobNumber, "HJ-1");
  assert.equal(partner.assets[0]!.anomalies, 1);
});

test("a hiányzó vízóra érték nem ad különbséget, a negatív gyanús, az egységek keveredése nem ad összeget", () => {
  const missing = buildOperationsReport({
    month: "2026-11",
    audience: "INTERNAL",
    entries: [
      entry("e1", "2026-11-05T09:00:00.000Z", {
        values: [
          {
            fieldKey: "elotte",
            label: "Előtte",
            unit: "m3",
            meterRole: "BEFORE",
            value: 100,
          },
        ],
      }),
      entry("e2", "2026-11-06T09:00:00.000Z", {
        values: [
          {
            fieldKey: "elotte",
            label: "Előtte",
            unit: "m3",
            meterRole: "BEFORE",
            value: 500,
          },
          {
            fieldKey: "utana",
            label: "Utána",
            unit: "m3",
            meterRole: "AFTER",
            value: 20,
          },
        ],
      }),
    ],
    schedules: [],
    now: NOW,
  });
  const [first, second] = missing.assets[0]!.entries;
  assert.equal(first!.meterDifference, null);
  assert.equal(first!.meterAfter, null);
  assert.equal(second!.meterDifference, -480);
  assert.equal(second!.meterSuspicious, true);
  const mixed = buildOperationsReport({
    month: "2026-11",
    audience: "INTERNAL",
    entries: [
      entry("e1", "2026-11-05T09:00:00.000Z"),
      entry("e2", "2026-11-06T09:00:00.000Z", {
        values: [
          {
            fieldKey: "elotte",
            label: "Előtte",
            unit: "liter",
            meterRole: "BEFORE",
            value: 1,
          },
          {
            fieldKey: "utana",
            label: "Utána",
            unit: "liter",
            meterRole: "AFTER",
            value: 2,
          },
        ],
      }),
    ],
    schedules: [],
    now: NOW,
  });
  assert.equal(mixed.assets[0]!.meterTotal, null);
});

test("a hónapon kívüli bejegyzés nem kerül a sorok közé, a határ budapesti", () => {
  const report = buildOperationsReport({
    month: "2026-11",
    audience: "INTERNAL",
    entries: [
      entry("before", "2026-10-31T22:59:00.000Z"), // október 31., 23:59 budapesti
      entry("first", "2026-10-31T23:00:00.000Z"), // november 1., 00:00 budapesti
      entry("last", "2026-11-30T22:59:00.000Z"), // november 30., 23:59 budapesti
      entry("after", "2026-11-30T23:00:00.000Z"), // december 1.
    ],
    schedules: [],
    now: NOW,
  });
  assert.deepEqual(
    report.assets[0]!.entries.map((row) => row.id),
    ["first", "last"],
  );
});

test("napi kimaradás: a mai nap, a létrehozás napja és a jövő nem számít, a rögzített nap nem hiányzik", () => {
  const report = buildOperationsReport({
    month: "2026-11",
    audience: "INTERNAL",
    entries: [entry("e1", "2026-11-03T09:00:00.000Z", { frequency: "DAILY" })],
    schedules: [schedule({ createdAt: "2026-11-02T08:00:00.000Z" })],
    now: new Date("2026-11-06T09:00:00.000Z"),
  });
  assert.deepEqual(report.missed[0]!.periods, ["2026-11-04", "2026-11-05"]);
  assert.equal(report.totals.missed, 2);
});

test("egy múltbeli hónapnál minden nap esedékes, egy jövőbelinél semmi", () => {
  const past = buildOperationsReport({
    month: "2026-09",
    audience: "INTERNAL",
    entries: [],
    schedules: [schedule({ createdAt: "2026-01-01T00:00:00.000Z" })],
    now: NOW,
  });
  assert.equal(past.missed[0]!.periods.length, 30);
  const future = buildOperationsReport({
    month: "2026-12",
    audience: "INTERNAL",
    entries: [],
    schedules: [schedule({ createdAt: "2026-01-01T00:00:00.000Z" })],
    now: NOW,
  });
  assert.deepEqual(future.missed, []);
});

test("heti kimaradás: a lezárult hét, a hét-határ előtti bejegyzés is számít, a folyó hét nem", () => {
  const weekly = schedule({
    frequency: "WEEKLY",
    createdAt: "2026-10-01T08:00:00.000Z",
  });
  const base = {
    month: "2026-11",
    audience: "INTERNAL" as const,
    schedules: [weekly],
    now: new Date("2026-11-20T09:00:00.000Z"), // péntek, a 11-16 hétfői hét még fut
  };
  const without = buildOperationsReport({
    ...base,
    entries: [entry("e1", "2026-11-12T09:00:00.000Z")], // a 11-09 hétfői hétben
  });
  // heti hetek, amelyek vasárnapja novemberbe esik és lezárult: 10-26 (vasárnap 11-01), 11-02, 11-09 (van), a 11-16 hét még fut
  assert.deepEqual(without.missed[0]!.periods, ["2026-10-26", "2026-11-02"]);
  // egy október 30-i bejegyzés a 10-26 hétre számít, bár a hónap előtti
  const withPrevious = buildOperationsReport({
    ...base,
    entries: [
      entry("e0", "2026-10-30T09:00:00.000Z"),
      entry("e1", "2026-11-12T09:00:00.000Z"),
    ],
  });
  assert.deepEqual(withPrevious.missed[0]!.periods, ["2026-11-02"]);
  // a sor viszont csak a novemberi bejegyzést sorolja
  assert.equal(withPrevious.totals.entries, 1);
});

test("a létrehozás hetében a heti sablon még nem maradhatott ki", () => {
  const report = buildOperationsReport({
    month: "2026-11",
    audience: "INTERNAL",
    entries: [],
    schedules: [
      schedule({ frequency: "WEEKLY", createdAt: "2026-11-04T08:00:00.000Z" }),
    ],
    now: new Date("2026-11-30T09:00:00.000Z"),
  });
  // a 11-02 hét (hétfő 11-02) a létrehozás hete: nem számít; utána 11-09, 11-16, 11-23 hét kimaradt
  assert.deepEqual(report.missed[0]!.periods, [
    "2026-11-09",
    "2026-11-16",
    "2026-11-23",
  ]);
});

test("a kivezetett és az alkalmi sablon nem ad kimaradást; két eszköz két sor", () => {
  const report = buildOperationsReport({
    month: "2026-09",
    audience: "INTERNAL",
    entries: [],
    schedules: [
      schedule({ isActive: false, createdAt: "2026-01-01T00:00:00.000Z" }),
      schedule({
        frequency: "OCCASIONAL",
        createdAt: "2026-01-01T00:00:00.000Z",
        templateId: "t2",
      }),
      schedule({
        assetId: "a2",
        assetLabel: "E-2 Másik",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      schedule({
        assetId: "a3",
        assetLabel: "E-0 Első",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ],
    now: NOW,
  });
  assert.deepEqual(
    report.missed.map((item) => item.assetLabel),
    ["E-0 Első", "E-2 Másik"],
  );
});

test("az eszközök címke szerint, a sorok időrendben állnak", () => {
  const report = buildOperationsReport({
    month: "2026-11",
    audience: "INTERNAL",
    entries: [
      entry("b2", "2026-11-09T09:00:00.000Z", {
        assetId: "a2",
        assetLabel: "E-2 Másik",
      }),
      entry("a2", "2026-11-12T09:00:00.000Z"),
      entry("a1", "2026-11-05T09:00:00.000Z"),
    ],
    schedules: [],
    now: NOW,
  });
  assert.deepEqual(
    report.assets.map((block) => block.assetLabel),
    ["E-1 Szűrő", "E-2 Másik"],
  );
  assert.deepEqual(
    report.assets[0]!.entries.map((row) => row.id),
    ["a1", "a2"],
  );
  assert.equal(report.assets[0]!.totalMinutes, 50);
});

test("a kimutatás szövegei magyarul: tartam, szám, hónap, időszak, előjel", () => {
  assert.equal(operationsDurationText(0), "—");
  assert.equal(operationsDurationText(45), "45 perc");
  assert.equal(operationsDurationText(120), "2 óra");
  assert.equal(operationsDurationText(125), "2 óra 5 perc");
  assert.equal(operationsNumberText(12.5), "12,5");
  // a magyar formátum a négyjegyű számokat tagolás nélkül írja
  assert.equal(operationsNumberText(1234.5), "1234,5");
  assert.equal(operationsMonthTitle("2026-03"), "2026. március");
  assert.equal(operationsPeriodText("2026-11-03", "DAILY"), "11.03.");
  assert.equal(operationsPeriodText("2026-11-02", "WEEKLY"), "11.02.–11.08.");
  assert.equal(operationsPeriodText("2026-10-26", "WEEKLY"), "10.26.–11.01.");
  assert.equal(operationsSignedNumberText(12.5, "m3"), "+12,5 m3");
  assert.equal(operationsSignedNumberText(-3, null), "-3");
  assert.equal(operationsSignedNumberText(0, "m3"), "0 m3");
});

test("a kimaradt heti feladat a rögzítéskori helyszíntől független bejegyzéssel teljesül, a sorok közé viszont nem kerül", () => {
  const base = {
    month: "2026-11",
    audience: "INTERNAL" as const,
    schedules: [
      schedule({ frequency: "WEEKLY", createdAt: "2026-10-01T08:00:00.000Z" }),
    ],
    now: new Date("2026-11-20T09:00:00.000Z"),
  };
  // a 11-09 hétben a feladat egy MÁSIK helyszínen rögzítve teljesült (az eszközt azóta áthelyezték)
  const elsewhere = entry("x1", "2026-11-12T09:00:00.000Z");
  const without = buildOperationsReport({ ...base, entries: [] });
  assert.ok(without.missed[0]!.periods.includes("2026-11-09"));
  const withDone = buildOperationsReport({
    ...base,
    entries: [],
    doneEntries: [elsewhere],
  });
  assert.equal(withDone.missed[0]!.periods.includes("2026-11-09"), false);
  assert.equal(withDone.totals.entries, 0);
  assert.deepEqual(withDone.assets, []);
});
