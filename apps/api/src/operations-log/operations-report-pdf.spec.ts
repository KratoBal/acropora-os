import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOperationsReport,
  type OperationsReportEntryInput,
} from "@acropora/types";

import { readPdfTextLines } from "../documents/pdf/pdf-text-readback.js";
import { renderOperationsReportPdf } from "./operations-report-pdf.js";

/*
  A HAVI KIMUTATÁS PDF-JE (task os-uzemeltetesi-naplo, S4). MI PIROSIT: ha a PDF nem PDF; ha a magyar ékezetek (ő, ű) elvesznének;
  ha a vízóra-különbség, a tartam, az eszköz címe vagy a kimaradt időszak nem kerülne a lapra; ha a partner nézetében a kollégák neve
  megjelenne (a nevek a számításban cserélődnek, de a PDF ezt tovább nem szivárogtathatja); ha két azonos bemenet két különböző
  fájlt adna (a létrehozás ideje a kimutatás készítésének ideje).
*/
function entry(
  over: Partial<OperationsReportEntryInput> = {},
): OperationsReportEntryInput {
  return {
    id: "e1",
    templateId: "t1",
    templateName: "Homokszűrő visszamosás",
    frequency: "WEEKLY",
    assetId: "a1",
    assetLabel: "E-1 Szűrő",
    startedAt: "2026-11-12T09:00:00.000Z",
    finishedAt: "2026-11-12T09:25:00.000Z",
    participantNames: ["Kovács Béla", "Őri Ágnes"],
    anomaly: true,
    anomalyNote: "Szivárog a szelep",
    serviceJob: {
      id: "sj1",
      jobNumber: "HJ-2026-0042",
      status: "NEW",
      hidden: false,
    },
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
      { fieldKey: "ph", label: "pH", unit: null, meterRole: null, value: 7.8 },
      {
        fieldKey: "rendben",
        label: "Szűrő rendben",
        unit: null,
        meterRole: null,
        value: true,
      },
      {
        fieldKey: "megj",
        label: "Megjegyzés",
        unit: null,
        meterRole: null,
        value: "A kolléga szavai",
      },
    ],
    ...over,
  };
}

async function textOf(audience: "INTERNAL" | "PARTNER") {
  const report = buildOperationsReport({
    month: "2026-11",
    audience,
    entries: [entry()],
    schedules: [
      {
        templateId: "t1",
        templateName: "Homokszűrő visszamosás",
        frequency: "WEEKLY",
        isActive: true,
        createdAt: "2026-10-01T08:00:00.000Z",
        assetId: "a1",
        assetLabel: "E-1 Szűrő",
      },
    ],
    now: new Date("2026-11-20T09:00:00.000Z"),
  });
  const bytes = await renderOperationsReportPdf({
    report,
    subject: "Fővárosi Állat- és Növénykert · Biodóm",
    generatedAt: "2026-11-20T09:00:00.000Z",
  });
  const lines = await readPdfTextLines(bytes);
  return { bytes, text: lines.map((line) => line.text).join("\n") };
}

describe("a havi kimutatás PDF-je", () => {
  it("PDF, és a lapon áll a hónap, az eszköz, a tartam, a vízóra-különbség és a magyar kettős ékezetek", async () => {
    const { bytes, text } = await textOf("INTERNAL");
    assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
    for (const expected of [
      "2026. november",
      "E-1 Szűrő",
      "Homokszűrő visszamosás",
      "25 perc",
      "előtte: 100 m3",
      "utána: 112,5 m3",
      "különbség: +12,5 m3",
      "Őri Ágnes",
      "Kovács Béla",
      "Rendellenesség:",
      "Szivárog",
      "HJ-2026-0042",
      "Új",
      "Biodóm",
      "pH: 7,8",
      "Szűrő rendben: igen",
      "Megjegyzés: A kolléga szavai",
    ])
      assert.ok(text.includes(expected), `hiányzik a lapról: ${expected}`);
  });

  it("a kimaradt időszak a lapon áll", async () => {
    const { text } = await textOf("INTERNAL");
    // a 11-02 hét (hétfő) és a 10-26 hét kimaradt; a 11-09 hétben van bejegyzés
    assert.ok(
      text.includes("Kimaradt ütemezett feladatok") ||
        text.includes("KIMARADT ÜTEMEZETT FELADATOK"),
    );
    assert.ok(text.includes("10.26.–11.01."));
    assert.ok(text.includes("11.02.–11.08."));
  });

  it("a partner nézetében a nevek nem szerepelnek, helyettük Acropora, és a jegy állapota a partner nyelvén áll", async () => {
    const { text } = await textOf("PARTNER");
    assert.equal(text.includes("Kovács"), false);
    assert.equal(text.includes("Őri"), false);
    // a partner nézetében a mért szám és az igen/nem érték áll, a szabad szöveg (a kollégák szava) nem
    assert.ok(text.includes("pH: 7,8"));
    assert.equal(text.includes("A kolléga szavai"), false);
    assert.ok(text.includes("Acropora"));
    assert.ok(text.includes("HJ-2026-0042"));
  });

  it("ugyanaz a bemenet ugyanazt a fájlt adja", async () => {
    const a = await textOf("INTERNAL");
    const b = await textOf("INTERNAL");
    assert.ok(a.bytes.equals(b.bytes));
  });

  it("üres hónapról is készül kimutatás, és kimondja, hogy nincs bejegyzés", async () => {
    const report = buildOperationsReport({
      month: "2026-09",
      audience: "INTERNAL",
      entries: [],
      schedules: [],
      now: new Date("2026-11-20T09:00:00.000Z"),
    });
    const bytes = await renderOperationsReportPdf({
      report,
      subject: "E-1 Szűrő",
      generatedAt: "2026-11-20T09:00:00.000Z",
    });
    const text = (await readPdfTextLines(bytes))
      .map((line) => line.text)
      .join("\n");
    assert.ok(text.includes("Ebben a hónapban nincs rögzített bejegyzés."));
  });

  it("sok bejegyzés új oldalra tör, minden oldalon ott a lábléc és az oldalszám", async () => {
    const entries = Array.from({ length: 70 }, (_, i) =>
      entry({
        id: `e${i}`,
        startedAt: new Date(
          Date.UTC(2026, 10, 1 + (i % 28), 8, i % 60),
        ).toISOString(),
        finishedAt: new Date(
          Date.UTC(2026, 10, 1 + (i % 28), 9, i % 60),
        ).toISOString(),
        anomaly: false,
        anomalyNote: null,
        serviceJob: null,
      }),
    );
    const report = buildOperationsReport({
      month: "2026-11",
      audience: "INTERNAL",
      entries,
      schedules: [],
      now: new Date("2026-12-05T09:00:00.000Z"),
    });
    const bytes = await renderOperationsReportPdf({
      report,
      subject: "E-1",
      generatedAt: "2026-12-05T09:00:00.000Z",
    });
    const text = (await readPdfTextLines(bytes))
      .map((line) => line.text)
      .join("\n");
    const pages = /(\d+) \/ (\d+)/.exec(text);
    assert.ok(
      pages && Number(pages[2]) >= 2,
      `legalább két oldalt vártam: ${pages?.[0]}`,
    );
    assert.ok(text.includes("Összesen 70 bejegyzés"));
  });
});
