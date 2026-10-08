import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";
import { PDFDocument } from "pdf-lib";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { PurchaseInvoicePdfLookup } from "./purchase-invoice-pdf.js";
import { PurchaseInvoiceScanService } from "./purchase-invoice-scan.service.js";

const gate = integrationDatabaseGate(process.env);

/** A 2×1 pixel PNG (no binary fixture in the repo). */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQYGBgAKfwF+yHbvgAAAABJRU5ErkJggg==",
  "base64",
);

describe(
  "a scanned invoice attached to a recorded purchase invoice (5ec62e35)",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = randomUUID();
    const scans = new PurchaseInvoiceScanService();
    const lookup = new PurchaseInvoicePdfLookup();
    let userId: string, supplierId: string, warehouseId: string;
    let invoiceId: string;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      userId = (
        await prisma.user.create({
          data: {
            email: `scan-${suffix}@example.test`,
            displayName: "Scan test",
            role: "ADMIN",
          },
        })
      ).id;
      supplierId = (
        await prisma.supplier.create({
          data: { code: `SCAN-${suffix}`, name: "Szlovák beszállító" },
        })
      ).id;
      warehouseId = (
        await prisma.warehouse.create({
          data: { code: `SCAN-${suffix}`, name: "Scan warehouse" },
        })
      ).id;
      invoiceId = (
        await prisma.purchaseInvoice.create({
          data: {
            documentNumber: `SCAN-${suffix}`,
            supplierInvoiceNumber: `SK-${suffix}`,
            source: "EU",
            supplierId,
            warehouseId,
            invoiceDate: new Date("2026-10-08T00:00:00Z"),
          },
        })
      ).id;
    });

    it("a PNG is stored as a one-page PDF on the invoice, once, and the list says it has a PDF", async () => {
      const before = await lookup.hasPdf([
        { id: invoiceId, supplierInvoiceNumber: `SK-${suffix}`, supplierId },
      ]);
      assert.equal(before.get(invoiceId), false);

      const file = {
        buffer: PNG,
        mimetype: "image/png",
        originalname: "lap.png",
      };
      const list = await scans.attach(invoiceId, file, userId);
      assert.equal(list.length, 1);
      assert.equal(list[0]!.fileName, "lap.pdf");
      // the same file again is the same attachment
      assert.equal(
        (await scans.attach(invoiceId, file, userId)).length,
        1,
        "ONE-ATTACHMENT",
      );

      const pdf = await scans.bytes(invoiceId, list[0]!.id);
      assert.equal(pdf.bytes.subarray(0, 5).toString(), "%PDF-");
      assert.equal((await PDFDocument.load(pdf.bytes)).getPageCount(), 1);

      const row = await prisma.incomingSupplierDocument.findUniqueOrThrow({
        where: { id: list[0]!.id },
      });
      assert.equal(row.origin, "UPLOAD");
      assert.equal(row.purchaseInvoiceId, invoiceId);

      const afterAttach = await lookup.hasPdf([
        { id: invoiceId, supplierInvoiceNumber: `SK-${suffix}`, supplierId },
      ]);
      assert.equal(afterAttach.get(invoiceId), true, "HAS-PDF-DIRECT");
    });

    it("a text file is refused, and a scan of another invoice is not served", async () => {
      await assert.rejects(
        scans.attach(
          invoiceId,
          {
            buffer: Buffer.from("hello"),
            mimetype: "text/plain",
            originalname: "a.txt",
          },
          userId,
        ),
        /Csak PDF, JPEG vagy PNG/,
      );
      const [first] = await scans.list(invoiceId);
      await assert.rejects(
        scans.bytes("other-invoice", first!.id),
        /nem található/,
      );
    });

    it("a giant image is a 400 with its own sentence, and nothing is stored", async () => {
      const giant = Buffer.from(PNG);
      giant.writeUInt32BE(100_000, 16);
      giant.writeUInt32BE(100_000, 20);
      const before = (await scans.list(invoiceId)).length;
      await assert.rejects(
        scans.attach(
          invoiceId,
          { buffer: giant, mimetype: "image/png", originalname: "orias.png" },
          userId,
        ),
        /Túl nagy kép/,
        "GIANT-400",
      );
      assert.equal((await scans.list(invoiceId)).length, before);
    });

    it("a broken image is a 400 with its own sentence, and nothing is stored", async () => {
      const before = (await scans.list(invoiceId)).length;
      await assert.rejects(
        scans.attach(
          invoiceId,
          {
            buffer: Buffer.concat([
              PNG.subarray(0, 33),
              Buffer.from([1, 2, 3]),
            ]),
            mimetype: "image/png",
            originalname: "serult.png",
          },
          userId,
        ),
        /A kép nem olvasható/,
        "BROKEN-400",
      );
      assert.equal((await scans.list(invoiceId)).length, before);
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await prisma.incomingSupplierDocument.deleteMany({
        where: { purchaseInvoiceId: invoiceId },
      });
      await prisma.purchaseInvoice.deleteMany({ where: { supplierId } });
      await prisma.auditLog.deleteMany({ where: { userId } });
      await prisma.warehouse.deleteMany({ where: { id: warehouseId } });
      await prisma.supplier.deleteMany({ where: { id: supplierId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });
  },
);
