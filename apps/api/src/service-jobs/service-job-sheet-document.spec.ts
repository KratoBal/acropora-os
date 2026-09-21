import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readPdfTextLines } from "../documents/pdf/pdf-text-readback.js";

import { serviceJobSheetDocument } from "./service-job-sheet-document.js";
import type { ServiceJobSheetInput } from "./service-job-sheet-content.js";

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function input(
  overrides: Partial<ServiceJobSheetInput> = {},
): ServiceJobSheetInput {
  return {
    jobNumber: "SRV-2026-00482",
    status: "COMPLETED",
    customerName: "AquaForma Kft.",
    departmentPath: ["Kossuth Lajos utca 18."],
    title: "Hűtőkör nyomásvesztése",
    description: null,
    openedAt: new Date("2026-09-14T08:42:00Z"),
    closedAt: new Date("2026-09-16T14:18:00Z"),
    assets: [],
    assignees: ["Kovács Márton"],
    log: [
      { at: new Date(), text: "Naplóbejegyzés", authorName: "Kovács Márton" },
    ],
    ...overrides,
  };
}

describe("az elkészült hibajegy PDF-je", () => {
  it("többoldalas hibajegyen egyetlen tartalmi szövegdoboz sem metszi a fejlécsávot", async () => {
    const bytes = await serviceJobSheetDocument(
      input({
        log: Array.from({ length: 110 }, (_, i) => ({
          at: new Date(),
          text: `FOLYTATÁS-${i}`,
          authorName: "Kovács Márton",
        })),
      }),
    );
    const rows = await readPdfTextLines(bytes);
    const continuation = rows.filter(
      (row) => row.pageNumber > 1 && row.text.includes("FOLYTATÁS-"),
    );
    assert.ok(continuation.length > 0, "a minta tényleg többoldalas");
    assert.ok(
      continuation.every((row) => (row.top ?? 0) >= 84),
      "a hibajegy folytató tartalma nem érhet a fejlécsávba",
    );
  });

  it("a hibajegyfotók két oszlopban állnak, fotó nélkül pedig nincs üres szakasz", async () => {
    const withoutPhotos = await readPdfTextLines(
      await serviceJobSheetDocument(input()),
    );
    assert.equal(
      withoutPhotos.some((row) => row.text.includes("FÉNYKÉPEK")),
      false,
      "fotó nélkül nincs üres FÉNYKÉPEK szakasz",
    );
    const rows = await readPdfTextLines(
      await serviceJobSheetDocument(
        input({
          photos: [
            { thumbnail: pixel, caption: "bal kép" },
            { thumbnail: pixel, caption: "jobb kép" },
          ],
        }),
      ),
    );
    const row = rows.find(
      (candidate) =>
        candidate.text.includes("bal kép") &&
        candidate.text.includes("jobb kép"),
    );
    assert.ok(
      row && row.width !== undefined && row.width > 200,
      "a két fénykép felirata egy sorban, két oszlopban áll",
    );
  });

  it("a lapon a delegált hivatalos neve áll", async () => {
    const rows = await readPdfTextLines(
      await serviceJobSheetDocument(input({ assignees: ["Kovács Márton"] })),
    );
    assert.ok(rows.some((row) => row.text.includes("Kovács Márton")));
  });
});
