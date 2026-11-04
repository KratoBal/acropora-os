import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  systemDocumentsOf,
  withSystemDocuments,
} from "./partner-order-system-documents.js";
import { CERTIFICATE_SYSTEM_DOCUMENTS } from "./partner-orders.repository.js";
import { emptyChain } from "./partner-orders.service.js";

/**
 * A STORNO'D INVOICE IN THE CHAIN, on a real Postgres (acrobot 42859; barracuda, #2175 review). WHAT TURNS THIS RED:
 * the repository's certificate select not running on the database (a made-up field compiles), the issued storno not
 * reaching the invoice, a draft storno counted as one, or the chain counting the storno'd invoice.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "CHAINSTORNO-";
const n = String(Date.now() % 1_000_000);
const ids: Record<string, string> = {};

async function removeLeftovers() {
  // the stornos first (the draft ones have no number): they point at the originals
  await prisma.invoice.deleteMany({
    where: { referencedInvoice: { invoiceNumber: { startsWith: PREFIX } } },
  });
  await prisma.invoice.deleteMany({
    where: { invoiceNumber: { startsWith: PREFIX } },
  });
  await prisma.completionCertificate.deleteMany({
    where: { number: { startsWith: PREFIX } },
  });
  await prisma.serviceJob.deleteMany({
    where: { jobNumber: { startsWith: PREFIX } },
  });
  await prisma.worksheetDepartment.deleteMany({
    where: { name: `${PREFIX}helyszin` },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

describe(
  "a storno'd invoice in the order's chain",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}${n}`,
          type: "COMPANY",
          displayName: `${PREFIX}vevo`,
        },
        select: { id: true },
      });
      const department = await prisma.worksheetDepartment.create({
        data: {
          customerId: customer.id,
          code: "CST",
          name: `${PREFIX}helyszin`,
        },
        select: { id: true },
      });
      // a certificate has exactly one source: a service job here, one job each
      for (const key of ["stornoed", "kept"]) {
        const job = await prisma.serviceJob.create({
          data: {
            jobNumber: `${PREFIX}${key}-${n}`,
            title: `${PREFIX}hibajegy`,
            customerId: customer.id,
            departmentId: department.id,
          },
          select: { id: true },
        });
        const certificate = await prisma.completionCertificate.create({
          data: { number: `${PREFIX}${key}-${n}`, serviceJobId: job.id },
          select: { id: true },
        });
        ids[key] = certificate.id;
        const invoice = await prisma.invoice.create({
          data: {
            direction: "OUTBOUND",
            source: "SZAMLAZZ",
            status: "ISSUED",
            invoiceNumber: `${PREFIX}${key}-${n}`,
            partnerName: "x",
            completionCertificateId: certificate.id,
            issueDate: new Date("2026-11-04T10:00:00.000Z"),
          },
          select: { id: true },
        });
        // a draft storno is not a storno yet (one correction per invoice: `referencedInvoiceId` is unique)
        if (key === "kept")
          await prisma.invoice.create({
            data: {
              direction: "OUTBOUND",
              source: "SZAMLAZZ",
              status: "DRAFT",
              documentType: "STORNO",
              partnerName: "x",
              referencedInvoiceId: invoice.id,
            },
          });
        if (key === "stornoed")
          await prisma.invoice.create({
            data: {
              direction: "OUTBOUND",
              source: "SZAMLAZZ",
              status: "ISSUED",
              documentType: "STORNO",
              invoiceNumber: `${PREFIX}storno-${n}`,
              partnerName: "x",
              referencedInvoiceId: invoice.id,
              issueDate: new Date("2026-11-04T11:00:00.000Z"),
            },
          });
      }
    });

    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("marks the storno'd invoice with the issued storno's number, and does not count it", async () => {
      const certificates = await prisma.completionCertificate.findMany({
        ...CERTIFICATE_SYSTEM_DOCUMENTS,
        where: { id: { in: [ids.stornoed!, ids.kept!] } },
      });
      const docs = systemDocumentsOf({
        quoteId: "q",
        quoteNumber: "AJ",
        version: {
          id: "v",
          versionNumber: 1,
          pdfStorageKey: null,
          publishedAt: null,
        },
        certificates,
      });
      const invoices = docs.flatMap((d) =>
        d.kind === "INVOICE_PDF"
          ? [[d.invoiceNumber, d.stornoInvoiceNumber] as const]
          : [],
      );
      assert.deepEqual(
        invoices.sort(),
        [
          [`${PREFIX}kept-${n}`, null],
          [`${PREFIX}stornoed-${n}`, `${PREFIX}storno-${n}`],
        ].sort(),
      );
      assert.equal(withSystemDocuments(emptyChain(), docs).INVOICE, 1);
    });
  },
);
