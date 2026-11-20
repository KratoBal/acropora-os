import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PDFDocument } from "pdf-lib";
import PizZip from "pizzip";

import {
  mergeSheets,
  pickIssuedSheet,
  uniqueFileNames,
  zipSheets,
} from "./worksheet-bulk-sheets.js";

/**
 * A KIJELÖLT LAPOK PDF-JEI EGYBEN (kártya a785e580). MI PIROSÍT: ha az aláírt példány helyett a generált
 * kerülne a csomagba, vagy az archív (régi elrendezésű, `OTHER`) példány; ha több azonos típusból nem a
 * legfrissebb jönne; ha két azonos nevű PDF felülírná egymást a zipben; ha az összefűzött PDF oldalszáma
 * nem a lapok oldalszámainak összege, vagy a sorrend elcsúszna.
 */
const at = (iso: string) => new Date(iso);

describe("pickIssuedSheet", () => {
  it("az aláírt példány előbb áll, mint a generált", () => {
    const picked = pickIssuedSheet([
      { id: "g", type: "GENERATED_SHEET", createdAt: at("2026-11-02") },
      { id: "s", type: "SIGNED_SHEET", createdAt: at("2026-11-01") },
    ]);
    assert.equal(picked?.id, "s");
  });

  it("aláírt nélkül a generált, több azonos típusból a legfrissebb", () => {
    const picked = pickIssuedSheet([
      { id: "g1", type: "GENERATED_SHEET", createdAt: at("2026-11-01") },
      { id: "g2", type: "GENERATED_SHEET", createdAt: at("2026-11-05") },
    ]);
    assert.equal(picked?.id, "g2");
  });

  it("az archív és a feltöltött fájl (OTHER) nem kiadott PDF", () => {
    assert.equal(
      pickIssuedSheet([
        { id: "a", type: "OTHER", createdAt: at("2026-11-01") },
        { id: "p", type: "PHOTO", createdAt: at("2026-11-01") },
      ]),
      null,
    );
    assert.equal(pickIssuedSheet([]), null);
  });
});

describe("uniqueFileNames", () => {
  it("az ütköző név (kis- és nagybetűtől függetlenül) sorszámot kap a kiterjesztés előtt", () => {
    assert.deepEqual(uniqueFileNames(["a.pdf", "A.PDF", "b.pdf", "a.pdf"]), [
      "a.pdf",
      "A (2).PDF",
      "b.pdf",
      "a (3).pdf",
    ]);
  });
});

async function pdfWithPages(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage([200 + i, 300]);
  return doc.save();
}

describe("zipSheets", () => {
  it("minden lap külön fájl, az azonos nevűek nem írják felül egymást", async () => {
    const bytes = await pdfWithPages(1);
    const zip = new PizZip(
      zipSheets([
        { fileName: "ML-1.pdf", bytes },
        { fileName: "ML-1.pdf", bytes },
      ]),
    );
    assert.deepEqual(Object.keys(zip.files).sort(), [
      "ML-1 (2).pdf",
      "ML-1.pdf",
    ]);
    assert.equal(zip.file("ML-1.pdf")!.asUint8Array().length, bytes.length);
  });
});

describe("mergeSheets", () => {
  it("az oldalak összege és a sorrend: az első lap oldalai, aztán a másodiké", async () => {
    const merged = await PDFDocument.load(
      await mergeSheets([
        { bytes: await pdfWithPages(2) },
        { bytes: await pdfWithPages(1) },
      ]),
    );
    assert.equal(merged.getPageCount(), 3);
    // az oldalméretből látszik a forrás: az első lap 200 és 201 széles oldala, utána a második 200 széles
    assert.deepEqual(
      merged.getPages().map((page) => page.getWidth()),
      [200, 201, 200],
    );
  });
});
