import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";

import { MaintenancePackageService } from "./maintenance-package.service.js";
import type { MaintenancePackageRepository } from "./maintenance-package.repository.js";
import type { MaintenanceInvoiceDraftService } from "../maintenance-invoice/maintenance-invoice-draft.service.js";

const LEZARVA = new Date("2026-09-24T12:00:00Z");

function worksheet(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    number: "ML-2026-001",
    hiddenAt: null,
    versions: [{ id: "v1", closedAt: LEZARVA }],
    documents: [
      {
        id: "doc-1",
        worksheetVersionId: "v1",
        type: "GENERATED_SHEET",
        fileName: "munkalap.pdf",
        contentType: "application/pdf",
        content: Buffer.from("%PDF-1.4\nworksheet"),
        storageKey: null,
      },
    ],
    ...overrides,
  };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-a",
    jobNumber: "KL-2026-00001",
    customerId: "customer-a",
    worksheets: [worksheet()],
    maintenanceOrder: {
      id: "order-1",
      number: "MR-2026-001",
      documents: [
        {
          fileName: "megrendelolap-alairt.pdf",
          contentType: "application/pdf",
          content: Buffer.from("%PDF-1.4\norder"),
        },
      ],
    },
    completionCertificate: {
      id: "cert-1",
      number: "ALT-2026-001",
      documents: [
        {
          fileName: "igazolas-alairt.pdf",
          contentType: "application/pdf",
          content: Buffer.from("%PDF-1.4\ncertificate"),
        },
      ],
      invoices: [],
    },
    ...overrides,
  } as never;
}

function serviceWith(
  data: unknown,
  invoiceOverrides: Partial<Record<string, unknown>> = {},
) {
  const repository = {
    packageData: async (_id: string) => data,
  } as unknown as MaintenancePackageRepository;
  const invoices = {
    pdfFor: async (_invoiceId: string) => Buffer.from("%PDF-1.4\ninvoice"),
    ...invoiceOverrides,
  } as unknown as MaintenanceInvoiceDraftService;
  return new MaintenancePackageService(repository, invoices);
}

describe("a karbantartási lap dokumentumcsomagja", () => {
  it("nem létező vagy nem MAINTENANCE lapra 404-et ad", async () => {
    const service = serviceWith(null);
    await assert.rejects(
      () => service.assemble("job-a", "download"),
      (error: unknown) => error instanceof NotFoundException,
    );
  });

  it("rendben lévő állapotban mindhárom dokumentum a csomagba kerül", async () => {
    const csomag = await serviceWith(job()).assemble("job-a", "download");
    assert.ok(csomag.bytes.includes(Buffer.from("megrendelolap-alairt.pdf")));
    assert.ok(csomag.bytes.includes(Buffer.from("munkalap.pdf")));
    assert.ok(csomag.bytes.includes(Buffer.from("igazolas-alairt.pdf")));
  });

  it("teljesítési igazolás nélkül a LETÖLTÉS is elutasít, névvel", async () => {
    const service = serviceWith(job({ completionCertificate: null }));
    await assert.rejects(
      () => service.assemble("job-a", "download"),
      (hiba: unknown) => {
        assert.match(
          (hiba as { message: string }).message,
          /Nincs kiállítva teljesítési igazolás/,
        );
        return hiba instanceof BadRequestException;
      },
    );
  });

  /**
   * KALIBRÁCIÓ: ez az állítás pont azt méri, hogy a `purpose` ténylegesen
   * eljut a kapuig -- ha a szolgáltatás figyelmen kívül hagyná, a "download"
   * cél is elutasítana ugyanígy, és ez az állítás a másikéval azonos lenne.
   */
  it("mindent rendben találva a LETÖLTÉS átmegy, a KIKÜLDÉS számla nélkül elutasít", async () => {
    const adat = job();
    await serviceWith(adat).assemble("job-a", "download");
    await assert.rejects(
      () => serviceWith(adat).assemble("job-a", "send"),
      (hiba: unknown) => {
        assert.match(
          (hiba as { message: string }).message,
          /Nincs kiállítva számla/,
        );
        return hiba instanceof BadRequestException;
      },
    );
  });

  it("egy ISSUED számlával a KIKÜLDÉS 'nincs kiállítva számla' hiba nélkül átmegy, ÉS a számla PDF-je bekerül a csomagba", async () => {
    const adat = job({
      completionCertificate: {
        id: "cert-1",
        number: "ALT-2026-001",
        documents: [
          {
            fileName: "igazolas-alairt.pdf",
            contentType: "application/pdf",
            content: Buffer.from("%PDF-1.4\ncertificate"),
          },
        ],
        invoices: [{ id: "invoice-1", invoiceNumber: "SZ2026-00042" }],
      },
    });
    let requestedInvoiceId: string | undefined;
    const packageFile = await serviceWith(adat, {
      pdfFor: async (invoiceId: string) => {
        requestedInvoiceId = invoiceId;
        return Buffer.from("%PDF-1.4\ninvoice-bytes");
      },
    }).assemble("job-a", "send");
    assert.equal(requestedInvoiceId, "invoice-1");
    assert.ok(
      packageFile.bytes.includes(Buffer.from("szamla-SZ2026-00042.pdf")),
    );
    assert.ok(packageFile.bytes.includes(Buffer.from("invoice-bytes")));
  });

  it("lezáratlan munkalap megállítja a letöltést is, névvel", async () => {
    const service = serviceWith(
      job({
        worksheets: [
          worksheet({
            versions: [{ id: "v1", closedAt: null }],
            documents: [],
          }),
        ],
      }),
    );
    await assert.rejects(
      () => service.assemble("job-a", "download"),
      /Nincs lezárva: ML-2026-001/,
    );
  });

  it("rejtett munkalap kimarad a csomagból, de nem tartja vissza", async () => {
    const csomag = await serviceWith(
      job({ worksheets: [worksheet({ hiddenAt: new Date() })] }),
    ).assemble("job-a", "download");
    assert.ok(!csomag.bytes.includes(Buffer.from("munkalap.pdf")));
    assert.ok(csomag.bytes.includes(Buffer.from("megrendelolap-alairt.pdf")));
  });
});
