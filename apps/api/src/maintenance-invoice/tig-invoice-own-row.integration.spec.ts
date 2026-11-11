import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { BillingDocumentsRepository } from "../billing/billing-documents.repository.js";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { MaintenanceInvoiceRepository } from "./maintenance-invoice.repository.js";

/**
 * AN ISSUED TIG INVOICE IS AN OWN ROW (Balázs 2026-11-11 13:22 UTC: "az általunk teljesítési igazolás útján kiállított
 * számlát külső számlának jelöli a rendszer és nem tudom sztornózni"), on a real Postgres. WHAT TURNS THIS RED: the
 * issue leaves the row without its source, its certificate or the e-invoice mark (the storno asks by that mark); the
 * billing module's own read (`find`, the one the details page and the storno use) does not see the issued row, or sees
 * the draft; the back-fill migration misses an issued row from before, or touches a draft.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "TIGOWNROW-";
const n = String(Date.now() % 1_000_000);
const tig = new MaintenanceInvoiceRepository();
const billing = new BillingDocumentsRepository();
const ids: Record<string, string> = {};

const BACKFILL = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../packages/database/prisma/migrations/20261111170100_tig_invoice_own_rows/migration.sql",
  ),
  "utf8",
);

const zero = new Prisma.Decimal(0);
const draft = (certificateId: string) => ({
  id: randomUUID(),
  completionCertificateId: certificateId,
  customerId: ids.customer!,
  partnerName: `${PREFIX}vevo`,
  partnerTaxNumber: null,
  currency: "HUF",
  totals: { netAmount: zero, vatAmount: zero, grossAmount: zero },
  pdfStorageKey: null,
  lines: [],
});

async function removeLeftovers() {
  await prisma.invoice.deleteMany({ where: { partnerName: `${PREFIX}vevo` } });
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
  "an issued TIG invoice is an own row",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      ids.customer = (
        await prisma.customer.create({
          data: {
            customerNumber: `${PREFIX}${n}`,
            type: "COMPANY",
            displayName: `${PREFIX}vevo`,
          },
          select: { id: true },
        })
      ).id;
      const department = await prisma.worksheetDepartment.create({
        data: {
          customerId: ids.customer!,
          code: "TOR",
          name: `${PREFIX}helyszin`,
        },
        select: { id: true },
      });
      for (const key of ["issued", "old", "olddraft"]) {
        const job = await prisma.serviceJob.create({
          data: {
            jobNumber: `${PREFIX}${key}-${n}`,
            title: `${PREFIX}hibajegy`,
            customerId: ids.customer!,
            departmentId: department.id,
          },
          select: { id: true },
        });
        ids[key] = (
          await prisma.completionCertificate.create({
            data: { number: `${PREFIX}${key}-${n}`, serviceJobId: job.id },
            select: { id: true },
          })
        ).id;
      }
    });
    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("the draft is not an own row; the issued invoice is, with its certificate as source and the e-invoice mark", async () => {
      const created = await tig.createDraft(draft(ids.issued!));
      assert.equal(
        await billing.find(created.id),
        null,
        "a TIG draft is not the billing module's row",
      );
      await tig.markIssued(created.id, {
        invoiceNumber: `${PREFIX}E-${n}`,
        issueDate: new Date(),
        pdfStorageKey: null,
        completionCertificateId: ids.issued!,
      });
      const row = await prisma.invoice.findUniqueOrThrow({
        where: { id: created.id },
        select: {
          sourceType: true,
          sourceId: true,
          invoiceFormat: true,
          status: true,
        },
      });
      assert.deepEqual(row, {
        sourceType: "COMPLETION_CERTIFICATE",
        sourceId: ids.issued,
        invoiceFormat: "ELECTRONIC",
        status: "ISSUED",
      });
      const own = await billing.find(created.id);
      assert.equal(own?.invoiceNumber, `${PREFIX}E-${n}`);
    });

    it("the back-fill migration makes an issued TIG invoice from before an own row, and leaves a draft alone", async () => {
      const old = await tig.createDraft(draft(ids.old!));
      // an invoice issued before this change: ISSUED with a number, no source, no format
      await prisma.invoice.update({
        where: { id: old.id },
        data: { status: "ISSUED", invoiceNumber: `${PREFIX}OLD-${n}` },
      });
      const stillDraft = await tig.createDraft(draft(ids.olddraft!));
      assert.equal(await billing.find(old.id), null);

      await prisma.$executeRawUnsafe(BACKFILL);

      const rows = await prisma.invoice.findMany({
        where: { id: { in: [old.id, stillDraft.id] } },
        select: {
          id: true,
          sourceType: true,
          sourceId: true,
          invoiceFormat: true,
        },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      assert.deepEqual(byId.get(old.id), {
        id: old.id,
        sourceType: "COMPLETION_CERTIFICATE",
        sourceId: ids.old,
        invoiceFormat: "ELECTRONIC",
      });
      assert.deepEqual(byId.get(stillDraft.id), {
        id: stillDraft.id,
        sourceType: null,
        sourceId: null,
        invoiceFormat: null,
      });
      assert.equal(
        (await billing.find(old.id))?.invoiceNumber,
        `${PREFIX}OLD-${n}`,
      );
    });
  },
);
