import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AquariumMeasurementOccasion } from "@acropora/types";

import { readPdfTextLines } from "../documents/pdf/pdf-text-readback.js";
import {
  deviationCount,
  icpRows,
  measuredRows,
  previousValues,
} from "./measurement-report.js";
import {
  renderMeasurementReportPdf,
  type MeasurementReportPdfInput,
} from "./measurement-report-pdf.js";

const occasion = (
  measuredAt: string,
  values: Array<[string, number]>,
): AquariumMeasurementOccasion =>
  ({
    id: measuredAt,
    measuredAt,
    values: values.map(([parameterCode, value]) => ({ parameterCode, value })),
  }) as AquariumMeasurementOccasion;

const current = occasion("2026-10-08T08:45:00.000Z", [
  ["HOMERSEKLET", 25.2],
  ["PH", 7.94],
  ["FOSZFAT", 0.21],
]);
const earlier = occasion("2026-10-01T08:00:00.000Z", [
  ["HOMERSEKLET", 25.5],
  ["PH", 7.8],
  ["FOSZFAT", 0.16],
]);

function marine(over: Partial<MeasurementReportPdfInput> = {}) {
  const rows = measuredRows(
    current,
    previousValues([current, earlier], current),
    "TENGERI",
    [],
  );
  return {
    partner: "Minta Kft. · Korall medence",
    volumeAndMoment: "190 liter · 2026. október 8. 10:45",
    examination: "Helyszíni mérés",
    rows,
    icp: null,
    deviations: deviationCount(rows),
    notes: "A foszfát magas, 7 nap múlva kontrollmérés.",
    ...over,
  } satisfies MeasurementReportPdfInput;
}

async function textOf(input: MeasurementReportPdfInput): Promise<string> {
  const bytes = await renderMeasurementReportPdf(input);
  return (await readPdfTextLines(bytes)).map((l) => l.text).join(" | ");
}

describe("the measurement report PDF (Figma 06, 2:470)", () => {
  it("a marine occasion: the rows, the previous values, the marks and the count", async () => {
    const text = await textOf(marine());
    assert.match(text, /MÉRÉSI EREDMÉNYEK/);
    assert.doesNotMatch(text, /ICP ELEMZÉS/);
    assert.match(text, /2 ELTÉRÉS/);
    assert.match(text, /Hőmérséklet/);
    assert.match(text, /7,94/);
    assert.match(text, /7,8/);
    assert.match(text, /rendben · stabil/);
    assert.match(text, /alacsony · javul/);
    assert.match(text, /magas · romlik/);
    assert.match(text, /JAVASOLT INTÉZKEDÉSEK/);
    assert.match(text, /7 nap múlva kontrollmérés/);
  });

  /**
   * THE MARKS ARE REAL CHARACTERS (DejaVu): Noto Sans has no ✓ ↓ ↑, and a
   * missing glyph is an empty box that reads back as nothing. Each mark
   * stands on its word's row (the two fonts sit a little apart in height).
   */
  it("each mark is drawn, on the row of its words", async () => {
    const lines = await readPdfTextLines(
      await renderMeasurementReportPdf(marine()),
    );
    for (const [mark, words] of [
      ["✓", "rendben · stabil"],
      ["↓", "alacsony · javul"],
      ["↑", "magas · romlik"],
    ] as const) {
      const word = lines.find((l) => l.text.includes(words));
      assert.ok(word, words);
      assert.ok(
        lines.some(
          (l) =>
            l.text.includes(mark) &&
            l.pageNumber === word.pageNumber &&
            Math.abs((l.top ?? 0) - (word.top ?? 0)) < 3,
        ),
        `${mark} nincs a(z) ${words} soraban`,
      );
    }
  });

  it("with an ICP report, the title says so and the elements are listed", async () => {
    const icp = {
      title: "ICP eredmények · Fauna Marin",
      rows: icpRows([
        {
          elementCode: "Stroncium (Sr)",
          value: 9.1,
          unit: "mg/l",
          minimum: 7,
          maximum: 9,
          trend: null,
        },
      ]),
    };
    const text = await textOf(marine({ icp }));
    assert.match(text, /MÉRÉSI EREDMÉNYEK ÉS ICP ELEMZÉS/);
    assert.match(text, /ICP EREDMÉNYEK · FAUNA MARIN/);
    assert.match(text, /Stroncium \(Sr\)/);
  });

  it("D5: without any target range there is no badge, and without notes no actions", async () => {
    const fresh = occasion("2026-10-08T15:20:00.000Z", [["PH", 7.1]]);
    const rows = measuredRows(fresh, new Map(), "EDESVIZI", []);
    const text = await textOf(
      marine({ rows, deviations: deviationCount(rows), notes: null }),
    );
    assert.doesNotMatch(text, /ELTÉRÉS/);
    assert.doesNotMatch(text, /JAVASOLT INTÉZKEDÉSEK/);
    assert.match(text, /7,1/);
  });

  it("a marked occasion with nothing out of range says no deviation", async () => {
    const fine = occasion("2026-10-08T08:45:00.000Z", [["HOMERSEKLET", 25]]);
    const rows = measuredRows(fine, new Map(), "TENGERI", []);
    const text = await textOf(marine({ rows, deviations: 0 }));
    assert.match(text, /NINCS ELTÉRÉS/);
  });

  it("embeds Noto Sans for the text and DejaVu for the marks", async () => {
    const raw = (await renderMeasurementReportPdf(marine())).toString("latin1");
    assert.match(raw, /NotoSans-Regular/);
    assert.match(raw, /NotoSans-Bold/);
    assert.match(raw, /DejaVuSans/);
  });
});
