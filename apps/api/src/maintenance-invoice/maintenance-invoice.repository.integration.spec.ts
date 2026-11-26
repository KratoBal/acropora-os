import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  InvoiceSupersededMeanwhile,
  MaintenanceInvoiceRepository,
} from "./maintenance-invoice.repository.js";

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
      for (const key of [
        "signed",
        "unsigned",
        "failing",
        "plain",
        "cancelled",
        "storno",
        "reinvoice",
        "race",
      ]) {
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

    /*
      A SZTORNÓZOTT KIÁLLÍTOTT SZÁMLA JELE (kártya 2cd1ed80): `isCancelled` ugyanazt a jelet adja, mint a számlázás lista, egy KIÁLLÍTOTT STORNO sorból. MI PIROSÍT: ha a
      sztornó sor nélküli kiállított számla sztornózottnak látszik; ha a kiállított sztornó sor mellett nem látszik; ha egy NEM kiállított (piszkozat) sztornó is számít.
    */
    it("isCancelled: an issued invoice with an issued STORNO row is cancelled, a plain issued one and a draft STORNO are not", async () => {
      const plain = draft(ids.plain!);
      const cancelled = draft(ids.cancelled!);
      const storno = draft(ids.storno!);
      for (const input of [plain, cancelled, storno])
        await repository.createDraft(input);
      await prisma.invoice.update({
        where: { id: plain.id },
        data: { status: "ISSUED", invoiceNumber: `${PREFIX}P-${n}` },
      });
      await prisma.invoice.update({
        where: { id: cancelled.id },
        data: { status: "ISSUED", invoiceNumber: `${PREFIX}C-${n}` },
      });
      // the correction row starts as a DRAFT storno: not a cancellation yet
      await prisma.invoice.update({
        where: { id: storno.id },
        data: {
          documentType: "STORNO",
          status: "DRAFT",
          referencedInvoiceId: cancelled.id,
        },
      });
      assert.equal(
        await repository.isCancelled({
          id: cancelled.id,
          invoiceNumber: `${PREFIX}C-${n}`,
        }),
        false,
      );
      await prisma.invoice.update({
        where: { id: storno.id },
        data: { status: "ISSUED", invoiceNumber: `${PREFIX}S-${n}` },
      });
      assert.equal(
        await repository.isCancelled({
          id: cancelled.id,
          invoiceNumber: `${PREFIX}C-${n}`,
        }),
        true,
      );
      assert.equal(
        await repository.isCancelled({
          id: plain.id,
          invoiceNumber: `${PREFIX}P-${n}`,
        }),
        false,
      );
    });

    /*
      SZTORNÓ UTÁN ÚJ SZÁMLA UGYANARRA AZ IGAZOLÁSRA (acrobot 62227), valódi Postgresen, a migráció részleges egyedi indexével
      (20261126030000). MI PIROSÍT: ha a felváltás után nem jöhet létre az új piszkozat; ha felváltás NÉLKÜL két élő számla
      állhat egy igazoláson; ha a régi sor elveszti a kapcsolatát; ha az élő számla nem az új; ha egy már felváltott számlát
      még egyszer fel lehet váltani.
    */
    it("a cancelled invoice is superseded by a new draft on the same certificate; a second live one is refused", async () => {
      const first = draft(ids.reinvoice!);
      await repository.createDraft(first);
      await prisma.invoice.update({
        where: { id: first.id },
        data: { status: "ISSUED", invoiceNumber: `${PREFIX}R1-${n}` },
      });

      // without superseding, the partial unique index keeps one live invoice per certificate
      await assert.rejects(
        () => repository.createDraft(draft(ids.reinvoice!)),
        (error: unknown) =>
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002",
      );

      const second = { ...draft(ids.reinvoice!), supersedes: first.id };
      const created = await repository.createDraft(second);
      assert.equal(created.id, second.id);
      const old = await prisma.invoice.findUniqueOrThrow({
        where: { id: first.id },
        select: { supersededAt: true, completionCertificateId: true },
      });
      assert.ok(old.supersededAt, "the old invoice is superseded");
      // it keeps its certificate: billing and the partner order still know it as the certificate's invoice
      assert.equal(old.completionCertificateId, ids.reinvoice);
      assert.equal(
        (await repository.existingInvoice(ids.reinvoice!))?.id,
        second.id,
      );

      // a superseded invoice cannot be superseded again
      await assert.rejects(
        () =>
          repository.createDraft({
            ...draft(ids.reinvoice!),
            supersedes: first.id,
          }),
        (error: unknown) => error instanceof InvoiceSupersededMeanwhile,
      );
      assert.equal(
        await prisma.invoice.count({
          where: {
            completionCertificateId: ids.reinvoice!,
            supersededAt: null,
          },
        }),
        1,
      );
    });

    it("two concurrent new invoices after a cancellation leave exactly one live invoice", async () => {
      const first = draft(ids.race!);
      await repository.createDraft(first);
      await prisma.invoice.update({
        where: { id: first.id },
        data: { status: "ISSUED", invoiceNumber: `${PREFIX}RACE-${n}` },
      });
      const results = await Promise.allSettled([
        repository.createDraft({ ...draft(ids.race!), supersedes: first.id }),
        repository.createDraft({ ...draft(ids.race!), supersedes: first.id }),
      ]);
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1,
      );
      const refused = results.find((result) => result.status === "rejected");
      assert.ok(
        refused?.status === "rejected" &&
          (refused.reason instanceof InvoiceSupersededMeanwhile ||
            (refused.reason instanceof Prisma.PrismaClientKnownRequestError &&
              refused.reason.code === "P2002")),
        String(refused?.status === "rejected" ? refused.reason : "none"),
      );
      assert.equal(
        await prisma.invoice.count({
          where: { completionCertificateId: ids.race!, supersededAt: null },
        }),
        1,
      );
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
