import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { MaintenanceInvoiceRepository } from "./maintenance-invoice.repository.js";

/**
 * THE UNSIGNED CONFIRMATION'S AUDIT GOES WITH THE DRAFT, on a real Postgres (barracuda, #2176 review). WHAT TURNS THIS
 * RED: a draft without its audit row, an audit row without the right certificate, user or draft id, or a draft left
 * behind when the audit write fails (a retry would then return that draft, never logged).
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "UNSIGNEDAUDIT-";
const n = String(Date.now() % 1_000_000);
const repository = new MaintenanceInvoiceRepository();
const ids: Record<string, string> = {};

const zero = new Prisma.Decimal(0);
const draft = (
  certificateId: string,
  unsignedAudit?: { userId: string | null; certificateNumber: string },
) => ({
  id: randomUUID(),
  completionCertificateId: certificateId,
  customerId: ids.customer!,
  partnerName: `${PREFIX}vevo`,
  partnerTaxNumber: null,
  currency: "HUF",
  totals: { netAmount: zero, vatAmount: zero, grossAmount: zero },
  pdfStorageKey: `${PREFIX}${n}.pdf`,
  lines: [],
  ...(unsignedAudit ? { unsignedAudit } : {}),
});

async function removeLeftovers() {
  await prisma.auditLog.deleteMany({
    where: {
      action: "maintenance-invoice.draft-without-signed-certificate",
      entityId: {
        in: [ids.signed ?? "", ids.unsigned ?? "", ids.failing ?? ""],
      },
    },
  });
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
  await prisma.user.deleteMany({
    where: { email: { startsWith: PREFIX.toLowerCase() } },
  });
}

describe(
  "the unsigned confirmation's audit row",
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
      ids.user = (
        await prisma.user.create({
          data: {
            email: `${PREFIX.toLowerCase()}${n}@example.invalid`,
            displayName: `${PREFIX}aktor`,
            role: "OWNER",
          },
          select: { id: true },
        })
      ).id;
      // a certificate has exactly one source (a check constraint): a service job here
      const department = await prisma.worksheetDepartment.create({
        data: {
          customerId: ids.customer!,
          code: "UAT",
          name: `${PREFIX}helyszin`,
        },
        select: { id: true },
      });
      // one job per certificate: a job has at most one certificate
      for (const key of ["signed", "unsigned", "failing"]) {
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

    it("writes the audit row in the draft's transaction, and none for a signed one", async () => {
      await repository.createDraft(draft(ids.signed!));
      const unsigned = draft(ids.unsigned!, {
        userId: ids.user!,
        certificateNumber: `${PREFIX}unsigned-${n}`,
      });
      const created = await repository.createDraft(unsigned);
      assert.equal(created.id, unsigned.id);
      const audits = await prisma.auditLog.findMany({
        where: {
          action: "maintenance-invoice.draft-without-signed-certificate",
          entityId: { in: [ids.signed!, ids.unsigned!] },
        },
        select: { userId: true, entityId: true, metadata: true },
      });
      assert.deepEqual(audits, [
        {
          userId: ids.user,
          entityId: ids.unsigned,
          metadata: {
            certificateNumber: `${PREFIX}unsigned-${n}`,
            invoiceId: unsigned.id,
            acknowledged: true,
          },
        },
      ]);
    });

    it("a failed audit write leaves no draft behind", async () => {
      // a user id that does not exist: the audit's foreign key fails inside the transaction
      await assert.rejects(() =>
        repository.createDraft(
          draft(ids.failing!, {
            userId: randomUUID(),
            certificateNumber: `${PREFIX}failing-${n}`,
          }),
        ),
      );
      assert.equal(
        await prisma.invoice.count({
          where: { completionCertificateId: ids.failing! },
        }),
        0,
      );
    });
  },
);
