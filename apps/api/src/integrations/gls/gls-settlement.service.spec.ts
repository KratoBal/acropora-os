import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";

import { glsXlsx } from "../../testing/gls-xlsx.fixture.js";
import type { GlsLineResolution } from "./gls-cod-resolution.js";
import type {
  GlsSettlementRepository,
  UnresolvedLine,
} from "./gls-settlement.repository.js";
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
    const result = await new GlsSettlementService(fake.repository).upload(
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
    const result = await new GlsSettlementService(fake.repository).upload(
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
      new GlsSettlementService(fake.repository).upload(
        glsXlsx({ Arlista: [["Cikkszám", "Ár"]] }),
        "arlista.xlsx",
        "user-1",
      ),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message ===
          "Ez nem GLS utánvét-részletező és nem GLS számlamelléklet.",
    );
  });
});

describe("GlsSettlementService.approveLine", () => {
  it("refuses an empty invoice number", async () => {
    const fake = fakeRepository([]);
    await assert.rejects(
      new GlsSettlementService(fake.repository).approveLine(
        "report-1",
        "line-1",
        { invoiceNumber: "  ", expectedUpdatedAt: "2026-09-29T08:00:00.000Z" },
        "user-1",
      ),
      BadRequestException,
    );
  });
});
