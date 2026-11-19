import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import { PDFDocument } from "pdf-lib";
import PizZip from "pizzip";

import type { WorksheetsRepository } from "./worksheets.repository.js";
import { WorksheetsService } from "./worksheets.service.js";

/*
  A KIJELÖLT LAPOK PDF-JEI EGYBEN, A SZOLGÁLTATÁS DÖNTÉSEI (kártya a785e580). A dupla a repositoryt helyettesíti.
  MI PIROSÍT: ha a hatókör nem megy át MINDEN laphoz (a hatókörön kívüli lap bekerülne a csomagba); ha a
  hatókörön kívüli és a nem létező azonosító különbözően viselkedne; ha a lezáratlan lap kimaradna a kihagyottak
  közül vagy a csomagba kerülne; ha az ismétlődő azonosító kétszer menne; ha 51 lap átmenne; ha az üres csomag
  fájlt adna 400 helyett; ha a fájlnév az UTC napot viselné a budapesti helyett.
*/
const SCOPE = { kind: "internal" } as never;

async function pdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 300]);
  return Buffer.from(await doc.save());
}

type Sheet = { id: string; number: string | null; pages: number | null };

async function harness(
  sheets: Sheet[],
  seen: { detail: unknown[][] } = { detail: [] },
) {
  const byId = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const bytes = new Map<string, Buffer>();
  for (const sheet of sheets)
    if (sheet.pages) bytes.set(sheet.id, await pdf(sheet.pages));
  const repository = {
    detail: async (id: string, scope: unknown) => {
      seen.detail.push([id, scope]);
      const sheet = byId.get(id);
      return sheet ? { id, number: sheet.number } : null;
    },
    documents: async (id: string) =>
      bytes.has(id)
        ? [
            {
              id: `doc-${id}`,
              type: "GENERATED_SHEET",
              caption: null,
              createdAt: new Date("2026-11-01"),
            },
          ]
        : [],
    document: async (id: string) => ({
      id: `doc-${id}`,
      type: "GENERATED_SHEET",
      caption: null,
      fileName: `${byId.get(id)!.number ?? id}.pdf`,
      contentType: "application/pdf",
      content: bytes.get(id),
    }),
  };
  return new WorksheetsService(repository as unknown as WorksheetsRepository);
}

describe("a kijelölt lapok kiadott PDF-jei egyben", () => {
  const sheets: Sheet[] = [
    { id: "a", number: "ML-1", pages: 2 },
    { id: "b", number: "ML-2", pages: null }, // lezáratlan
    { id: "c", number: "ML-3", pages: 1 },
  ];

  it("zip: a kiadott PDF-ek bekerülnek, a lezáratlan és a nem létező a kihagyottak között, a sorszámával", async () => {
    const service = await harness(sheets);
    const result = await service.bulkIssuedSheets(
      ["a", "b", "c", "nincs"],
      "zip",
      SCOPE,
    );
    assert.equal(result.included, 2);
    assert.deepEqual(result.skipped, [
      { id: "b", number: "ML-2" },
      { id: "nincs", number: null },
    ]);
    assert.equal(result.contentType, "application/zip");
    assert.deepEqual(Object.keys(new PizZip(result.bytes).files).sort(), [
      "ML-1.pdf",
      "ML-3.pdf",
    ]);
  });

  it("összefűzve: egy PDF, az oldalak összege a kijelölés sorrendjében", async () => {
    const service = await harness(sheets);
    const result = await service.bulkIssuedSheets(["a", "c"], "merged", SCOPE);
    assert.equal(result.contentType, "application/pdf");
    assert.equal(result.fileName.endsWith(".pdf"), true);
    assert.equal((await PDFDocument.load(result.bytes)).getPageCount(), 3);
  });

  it("a hatókör MINDEN laphoz átmegy, az ismétlődő azonosító egyszer fut", async () => {
    const seen = { detail: [] as unknown[][] };
    const service = await harness(sheets, seen);
    const scope = { kind: "customer", customerId: "customer-1" } as never;
    await service.bulkIssuedSheets(["a", "c", "a"], "zip", scope);
    // minden olvasás ugyanazt a hatókört kapta, a lapok egyenként
    assert.ok(seen.detail.length > 0);
    assert.ok(seen.detail.every((call) => call[1] === scope));
    // a kétszer megadott "a" ugyanannyiszor fut, mint az egyszer megadott "c"
    const count = (id: string) =>
      seen.detail.filter((call) => call[0] === id).length;
    assert.equal(count("a"), count("c"));
  });

  it("ha egyetlen lapnak sincs kiadott PDF-je, 400, nem üres fájl", async () => {
    const service = await harness(sheets);
    await assert.rejects(
      () => service.bulkIssuedSheets(["b", "nincs"], "zip", SCOPE),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /kiadott PDF/.test((error as BadRequestException).message),
    );
  });

  it("legfeljebb 50 lap, és legalább egy", async () => {
    const service = await harness(sheets);
    const many = Array.from({ length: 51 }, (_, i) => `x${i}`);
    for (const ids of [many, []])
      await assert.rejects(
        () => service.bulkIssuedSheets(ids, "zip", SCOPE),
        (error: unknown) => error instanceof BadRequestException,
      );
    // 50 még átmegy (a lezáratlan/nem létező miatt 400, de nem a számkorlát miatt)
    await assert.rejects(
      () => service.bulkIssuedSheets(many.slice(0, 50), "zip", SCOPE),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /kiadott PDF/.test((error as BadRequestException).message),
    );
  });

  it("a fájlnév a budapesti napot viseli: UTC szerint még 19-e, Budapesten már 20-a", async () => {
    const service = await harness(sheets);
    const result = await service.bulkIssuedSheets(
      ["a"],
      "zip",
      SCOPE,
      new Date("2026-11-19T23:30:00.000Z"),
    );
    assert.equal(result.fileName, "munkalapok-2026-11-20.zip");
  });
});
