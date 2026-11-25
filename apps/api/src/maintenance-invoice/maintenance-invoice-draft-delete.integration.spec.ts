import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { BillingDocumentListRepository } from "../billing/billing-document-list.repository.js";
import { MaintenanceInvoiceRepository } from "./maintenance-invoice.repository.js";

/**
 * A TIG PISZKOZAT TÖRLÉSE VALÓDI POSTGRESEN (Luca kérése, acrobot 61225). Mi pirosít: ha a törlés egy kiállított vagy kiállítás
 * alatti sorra átmegy; ha egy NEM igazoláshoz kötött sort (a számlázás saját vázlatát) is megtalál; ha a törölt sor tételei vagy
 * az audit sor hiányoznak, vagy a tételek árván maradnak; ha a törlés után ugyanarra az igazolásra nem készíthető új piszkozat
 * (az idempotencia-kulcs nem szabadul); ha a kiállítás indítása és a törlés közül mindkettő nyerhet ugyanarra a sorra.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "TIGDEL-";
const n = String(Date.now() % 1_000_000);
const repository = new MaintenanceInvoiceRepository();
const ids: Record<string, string> = {};
const KEYS = ["plain", "issued", "issuing", "race", "again", "listed"] as const;

const money = new Prisma.Decimal(1000);
const line = {
  description: `${PREFIX}sor`,
  quantity: new Prisma.Decimal(2),
  unit: "alkalom",
  unitNet: new Prisma.Decimal(500),
  vatRatePercent: new Prisma.Decimal(27),
  netAmount: money,
  vatAmount: new Prisma.Decimal(270),
  grossAmount: new Prisma.Decimal(1270),
};
const draft = (certificateId: string) => ({
  id: randomUUID(),
  completionCertificateId: certificateId,
  customerId: ids.customer!,
  partnerName: `${PREFIX}vevo`,
  partnerTaxNumber: null,
  currency: "HUF",
  totals: {
    netAmount: money,
    vatAmount: new Prisma.Decimal(270),
    grossAmount: new Prisma.Decimal(1270),
  },
  pdfStorageKey: `invoice/${PREFIX}${n}/preview.pdf`,
  lines: [line],
});

async function removeLeftovers() {
  const invoices = await prisma.invoice.findMany({
    where: { partnerName: `${PREFIX}vevo` },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: {
      action: "maintenance-invoice.draft-deleted",
      entityId: { in: invoices.map((invoice) => invoice.id) },
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

describe("deleting a TIG invoice draft", { skip: gate.mode === "skip" }, () => {
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
    const department = await prisma.worksheetDepartment.create({
      data: {
        customerId: ids.customer!,
        code: "TDL",
        name: `${PREFIX}helyszin`,
      },
      select: { id: true },
    });
    // one job per certificate: a job has at most one certificate
    for (const key of KEYS) {
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

  it("removes the draft with its lines, writes the audit row, and frees the certificate for a new draft", async () => {
    const created = draft(ids.plain!);
    await repository.createDraft(created);
    const outcome = await repository.deleteDraft({
      invoiceId: created.id,
      actorUserId: ids.user!,
    });
    assert.deepEqual(outcome, {
      removed: { pdfStorageKey: created.pdfStorageKey },
    });
    assert.equal(await prisma.invoice.count({ where: { id: created.id } }), 0);
    assert.equal(
      await prisma.invoiceLine.count({ where: { invoiceId: created.id } }),
      0,
    );
    const audits = await prisma.auditLog.findMany({
      where: {
        action: "maintenance-invoice.draft-deleted",
        entityId: created.id,
      },
      select: { userId: true, entityType: true, metadata: true },
    });
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.userId, ids.user);
    assert.equal(audits[0]!.entityType, "Invoice");
    const metadata = audits[0]!.metadata as Record<string, unknown>;
    assert.equal(metadata.completionCertificateId, ids.plain);
    assert.equal(metadata.partnerName, `${PREFIX}vevo`);
    assert.equal(metadata.currency, "HUF");
    assert.equal(Number(metadata.grossAmount), 1270);
    // the certificate stays, and its idempotency key is free again
    assert.equal(
      await prisma.completionCertificate.count({
        where: { id: ids.plain! },
      }),
      1,
    );
    const again = draft(ids.plain!);
    assert.equal((await repository.createDraft(again)).id, again.id);
  });

  it("refuses an issued invoice, and keeps the row", async () => {
    const created = draft(ids.issued!);
    await repository.createDraft(created);
    await prisma.invoice.update({
      where: { id: created.id },
      data: { status: "ISSUED", invoiceNumber: `${PREFIX}${n}-1` },
    });
    const outcome = await repository.deleteDraft({
      invoiceId: created.id,
      actorUserId: ids.user!,
    });
    assert.ok("refusal" in outcome);
    assert.equal(outcome.refusal.code, "NOT_DRAFT");
    assert.equal(await prisma.invoice.count({ where: { id: created.id } }), 1);
    assert.equal(
      await prisma.auditLog.count({
        where: {
          action: "maintenance-invoice.draft-deleted",
          entityId: created.id,
        },
      }),
      0,
    );
  });

  it("refuses an invoice whose issue has started (ISSUING)", async () => {
    const created = draft(ids.issuing!);
    await repository.createDraft(created);
    assert.equal(await repository.claimForIssue(created.id), true);
    const outcome = await repository.deleteDraft({
      invoiceId: created.id,
      actorUserId: ids.user!,
    });
    assert.ok("refusal" in outcome);
    assert.equal(outcome.refusal.code, "NOT_DRAFT");
    assert.equal(
      await prisma.invoiceLine.count({ where: { invoiceId: created.id } }),
      1,
    );
  });

  it("does not find an invoice that is not tied to a certificate, nor a missing id", async () => {
    const own = await prisma.invoice.create({
      data: {
        direction: "OUTBOUND",
        documentType: "INVOICE",
        source: "SZAMLAZZ",
        status: "DRAFT",
        partnerName: `${PREFIX}vevo`,
        currency: "HUF",
      },
      select: { id: true },
    });
    for (const invoiceId of [own.id, randomUUID()]) {
      const outcome = await repository.deleteDraft({
        invoiceId,
        actorUserId: ids.user!,
      });
      assert.ok("refusal" in outcome);
      assert.equal(outcome.refusal.code, "NOT_FOUND");
    }
    assert.equal(await prisma.invoice.count({ where: { id: own.id } }), 1);
  });

  it("the Kimenő számlák list shows the TIG draft with its job link, and not a certificate-less unsourced draft", async () => {
    const created = draft(ids.listed!);
    await repository.createDraft(created);
    const stray = await prisma.invoice.create({
      data: {
        direction: "OUTBOUND",
        documentType: "INVOICE",
        source: "SZAMLAZZ",
        status: "DRAFT",
        partnerName: `${PREFIX}vevo`,
        currency: "HUF",
      },
      select: { id: true },
    });
    const page = await new BillingDocumentListRepository().list({
      page: 1,
      pageSize: 100,
      status: "DRAFT",
      q: PREFIX,
    });
    const mine = page.items.find((item) => item.id === created.id);
    assert.ok(mine, "the TIG draft is on the list");
    assert.equal(mine.status, "DRAFT");
    assert.equal(
      mine.maintenanceDraft?.certificateNumber,
      `${PREFIX}listed-${n}`,
    );
    assert.equal(mine.maintenanceDraft?.jobKind, "REPAIR");
    assert.ok(mine.maintenanceDraft?.serviceJobId);
    assert.equal(
      page.items.some((item) => item.id === stray.id),
      false,
      "an unsourced draft with no certificate stays off the list",
    );
  });

  it("of an issue start and a delete on the same draft exactly one wins", async () => {
    const created = draft(ids.race!);
    await repository.createDraft(created);
    const [claimed, outcome] = await Promise.all([
      repository.claimForIssue(created.id),
      repository.deleteDraft({
        invoiceId: created.id,
        actorUserId: ids.user!,
      }),
    ]);
    const deleted = "removed" in outcome;
    assert.notEqual(claimed, deleted, "both won or both lost");
    assert.equal(
      await prisma.invoice.count({ where: { id: created.id } }),
      deleted ? 0 : 1,
    );
  });

  it("a draft deleted first cannot then be claimed for an issue", async () => {
    const created = draft(ids.again!);
    await repository.createDraft(created);
    const outcome = await repository.deleteDraft({
      invoiceId: created.id,
      actorUserId: ids.user!,
    });
    assert.ok("removed" in outcome);
    assert.equal(await repository.claimForIssue(created.id), false);
  });
});
