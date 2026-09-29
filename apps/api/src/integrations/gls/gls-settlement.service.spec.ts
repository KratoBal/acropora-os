import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import PDFDocument from "pdfkit";

import { registerEmbeddedPdfFont } from "../../documents/pdf/branded-document.js";
import { PAGE_END_MARKER } from "../../purchasing/supplier-invoice-import/pdf-text-lines.js";
import { GLS_COMPENSATION_0827_LINES } from "../../testing/gls-compensation-pdf-lines.fixture.js";
import { glsXlsx } from "../../testing/gls-xlsx.fixture.js";
import type { GlsCompensation } from "./gls-compensation.parser.js";
import type { GlsLineResolution } from "./gls-cod-resolution.js";
import type {
  GlsSettlementRepository,
  UnresolvedLine,
} from "./gls-settlement.repository.js";
import { GlsMonthlyReportXlsx } from "./gls-monthly-report.xlsx.js";
import { GlsSettlementService } from "./gls-settlement.service.js";

function invoiceAttachment() {
  return glsXlsx({
    "Delivery Details": [
      [
        "Számlaszám / Invoice number",
        "Számla kiállítás dátuma / Invoice date",
        "Csomagszám / Parcel number",
        "Ügyfél hivatkozás / Client reference",
        "Utánvét hivatkozás / COD Reference",
        "VÉGÖSSZEG / Total amount",
        "Pénznem / Currency",
      ],
      ["HU00000001", 46283, "1000000001", "11111-000001", null, 3000, "HUF"],
    ],
  });
}

function fakeRepository(open: UnresolvedLine[]) {
  const saved: Array<{ lineId: string; resolution: GlsLineResolution }> = [];
  const asked: { parcels?: readonly string[] } = {};
  const refreshed: string[] = [];
  const repository = {
    createInvoice: async () => ({ id: "gls-invoice-1", duplicate: false }),
    createCodReport: async () => ({ id: "report-1", duplicate: true }),
    unresolvedLines: async (where: { parcelNumbers?: readonly string[] }) => {
      asked.parcels = where.parcelNumbers;
      return open;
    },
    clientReferences: async () => new Map([["1000000001", "11111-000001"]]),
    existingInvoiceNumbers: async () => new Set<string>(),
    orderInvoiceNumbers: async (keys: readonly string[]) =>
      new Map(
        keys.includes("11111-000001")
          ? [["11111-000001", ["ACRW-2026/00010"]]]
          : [],
      ),
    saveResolutions: async (
      rows: Array<{ lineId: string; resolution: GlsLineResolution }>,
    ) => {
      saved.push(...rows);
    },
    refreshReportStatus: async (ids: readonly string[]) => {
      refreshed.push(...ids);
    },
  } as unknown as GlsSettlementRepository;
  return { repository, saved, asked, refreshed };
}

describe("GlsSettlementService.upload", () => {
  it("resolves the open lines of an invoice attachment's parcels through their client reference", async () => {
    const fake = fakeRepository([
      {
        id: "line-1",
        reportId: "report-1",
        parcelNumber: "1000000001",
        codReference: null,
      },
    ]);
    const result = await new GlsSettlementService(
      fake.repository,
      new GlsMonthlyReportXlsx(),
    ).upload(
      invoiceAttachment(),
      "SettlementDocument_HU00000001_20260918011215.xlsx",
      "user-1",
    );
    assert.deepEqual(result, {
      kind: "INVOICE_ATTACHMENT",
      id: "gls-invoice-1",
      duplicate: false,
      newlyResolvedLineCount: 1,
    });
    assert.deepEqual(fake.asked.parcels, ["1000000001"]);
    assert.deepEqual(fake.saved, [
      {
        lineId: "line-1",
        resolution: {
          status: "RESOLVED",
          source: "ORDER_KEY",
          invoiceNumbers: ["ACRW-2026/00010"],
        },
      },
    ]);
    assert.deepEqual(fake.refreshed, ["report-1"]);
  });

  it("does not touch anything for a report that is already in", async () => {
    // an open line is there to be found: a resolution run would save it
    const fake = fakeRepository([
      {
        id: "line-1",
        reportId: "report-1",
        parcelNumber: "1000000001",
        codReference: "ACRW-2026/00001",
      },
    ]);
    const result = await new GlsSettlementService(
      fake.repository,
      new GlsMonthlyReportXlsx(),
    ).upload(
      glsXlsx({
        WeeklyThu: [
          ["Utalás dátuma: 2026. 09. 03."],
          [
            "Jelentés szám",
            "Csomagszám",
            "Utánvét hivatkozás",
            "Kiszállítási dátum",
            "Utánvét összeg",
            "",
          ],
          ["1", "1000000001", "ACRW-2026/00001", "2026-08-28", 1000, "HUF"],
          [null, null, null, null, 1000, "HUF"],
        ],
      }),
      "report.xlsx",
      "user-1",
    );
    assert.equal(result.duplicate, true);
    assert.equal(result.newlyResolvedLineCount, 0);
    assert.equal(fake.saved.length, 0);
  });

  it("says in Hungarian why a file is refused", async () => {
    const fake = fakeRepository([]);
    await assert.rejects(
      new GlsSettlementService(
        fake.repository,
        new GlsMonthlyReportXlsx(),
      ).upload(
        glsXlsx({ Arlista: [["Cikkszám", "Ár"]] }),
        "arlista.xlsx",
        "user-1",
      ),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message ===
          "Ez nem GLS utánvét-részletező, számlamelléklet vagy kompenzációs értesítő.",
    );
  });
});

/** A one-page PDF whose text lines read back as `lines`, cell by cell. */
function letterPdf(lines: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "A4", margin: 20 });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    registerEmbeddedPdfFont(doc).fontSize(6);
    let y = 30;
    for (const line of lines.filter((line) => line !== PAGE_END_MARKER)) {
      line.split(" | ").forEach((cell, index) => {
        doc.text(cell, 20 + index * 70, y, { lineBreak: false });
      });
      y += 12;
    }
    doc.end();
  });
}

describe("GlsSettlementService.upload, the compensation letter", () => {
  it("reads the letter's PDF and stores what it says", async () => {
    const stored: GlsCompensation[] = [];
    const repository = {
      createCompensationLetter: async (
        _source: unknown,
        letter: GlsCompensation,
      ) => {
        stored.push(letter);
        return { id: "letter-1", duplicate: false };
      },
    } as unknown as GlsSettlementRepository;
    const result = await new GlsSettlementService(
      repository,
      new GlsMonthlyReportXlsx(),
    ).upload(
      await letterPdf(GLS_COMPENSATION_0827_LINES),
      "100031291_20260827.pdf",
      "user-1",
    );
    assert.deepEqual(result, {
      kind: "COMPENSATION_LETTER",
      id: "letter-1",
      duplicate: false,
      newlyResolvedLineCount: 0,
    });
    assert.deepEqual(
      stored.map((letter) => [
        letter.date,
        letter.cod,
        letter.compensated,
        letter.transferred,
        letter.references.length,
      ]),
      [["2026-08-27", 6950, 6950, 0, 3]],
    );
  });

  it("refuses another PDF, in Hungarian, and stores nothing", async () => {
    let created = 0;
    const repository = {
      createCompensationLetter: async () => {
        created++;
        return { id: "x", duplicate: false };
      },
    } as unknown as GlsSettlementRepository;
    const service = new GlsSettlementService(
      repository,
      new GlsMonthlyReportXlsx(),
    );
    await assert.rejects(
      service.upload(
        await letterPdf(["Számla", "Végösszeg | 18 111"]),
        "szamla.pdf",
        "user-1",
      ),
      (error: unknown) =>
        error instanceof BadRequestException && /nem GLS/.test(error.message),
    );
    await assert.rejects(
      service.upload(Buffer.from("%PDF-1.4 broken"), "rossz.pdf", "user-1"),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message === "A fájl nem olvasható PDF.",
    );
    assert.equal(created, 0);
  });
});

describe("GlsSettlementService.monthlyReport, pairing the letters", () => {
  it("gives a letter to the transfer of its day, the one whose total it names, and keeps the rest apart", async () => {
    const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
    const transfer = (date: string, total: number, fileName: string) => ({
      transferDate: day(date),
      fileName,
      total,
      lines: [],
    });
    const letter = (date: string, cod: number, compensated: number) => ({
      compensationDate: day(date),
      fileName: `${date}-${cod}.pdf`,
      cod,
      compensated,
      transferred: cod - compensated,
      references: ["HU00000001"],
    });
    const repository = {
      monthData: async () => ({
        transfers: [
          transfer("2026-09-10", 1000, "a.xlsx"),
          // two transfers on one day: the letter names the second one
          transfer("2026-09-10", 28900, "b.xlsx"),
          transfer("2026-09-03", 117450, "c.xlsx"),
        ],
        invoices: [],
        compensations: [
          letter("2026-09-10", 28900, 18111),
          letter("2026-09-03", 117450, 8013),
          // no transfer on its day
          letter("2026-09-17", 6950, 6950),
        ],
      }),
    } as unknown as GlsSettlementRepository;
    const built: unknown[][] = [];
    const reports = {
      build: async (...args: unknown[]) => {
        built.push(args);
        return { filename: "x", buffer: Buffer.alloc(0) };
      },
    } as unknown as GlsMonthlyReportXlsx;
    await new GlsSettlementService(repository, reports).monthlyReport(2026, 9);
    const [, , transfers, , unpaired] = built[0]! as [
      unknown,
      unknown,
      Array<{ fileName: string; compensation: { cod: number } | null }>,
      unknown,
      Array<{ cod: number }>,
    ];
    assert.deepEqual(
      transfers.map((row) => [row.fileName, row.compensation?.cod ?? null]),
      [
        ["a.xlsx", null],
        ["b.xlsx", 28900],
        ["c.xlsx", 117450],
      ],
    );
    assert.deepEqual(
      unpaired.map((row) => row.cod),
      [6950],
    );
  });
});

describe("GlsSettlementService.approveLine", () => {
  it("refuses an empty invoice number", async () => {
    const fake = fakeRepository([]);
    await assert.rejects(
      new GlsSettlementService(
        fake.repository,
        new GlsMonthlyReportXlsx(),
      ).approveLine(
        "report-1",
        "line-1",
        { invoiceNumber: "  ", expectedUpdatedAt: "2026-09-29T08:00:00.000Z" },
        "user-1",
      ),
      BadRequestException,
    );
  });
});
