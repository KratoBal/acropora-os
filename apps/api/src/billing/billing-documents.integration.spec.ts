import "reflect-metadata";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { BillingDocumentsRepository } from "./billing-documents.repository.js";
import { BillingDocumentsService } from "./billing-documents.service.js";
import type { BillingDocumentDraftDto } from "./dto/billing-document-draft.dto.js";

/**
 * A SZÁMLÁZÁSI VÁZLAT VALÓDI ADATBÁZISON (Számlázás v0.1): a feltételes
 * írások (azonosító-ütközés, `updatedAt`, állapot) és a kedvezmény-sor
 * idegen kulcsa csak itt mérhetők.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "SZAMLVAZ";

async function removeLeftovers() {
  // az ajánlat-fixtúra (a törlés kártya 6a75f15c mérföldkő-tesztje) előbb: a mérföldkő a díjbekérőre mutat, `Restrict`-tel
  await prisma.quotePaymentMilestone.deleteMany({
    where: { version: { quote: { quoteNumber: { startsWith: PREFIX } } } },
  });
  await prisma.quoteVersion.deleteMany({
    where: { quote: { quoteNumber: { startsWith: PREFIX } } },
  });
  await prisma.quote.deleteMany({
    where: { quoteNumber: { startsWith: PREFIX } },
  });
  const actors = await prisma.user.findMany({
    where: { email: { startsWith: PREFIX.toLowerCase() } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: { userId: { in: actors.map((actor) => actor.id) } },
  });
  await prisma.invoice.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: PREFIX.toLowerCase() } },
  });
}

describe("a számlázási vázlat tárolása", { skip: gate.mode === "skip" }, () => {
  const service = new BillingDocumentsService(new BillingDocumentsRepository());
  let user: AuthenticatedUser;
  let customerId = "";

  function dto(overrides: Partial<BillingDocumentDraftDto> = {}) {
    return {
      documentType: "INVOICE",
      invoiceFormat: "ELECTRONIC",
      customerId,
      fulfillmentDate: "2026-09-30",
      dueDate: "2026-10-08",
      paymentMethod: "Átutalás",
      currency: "HUF",
      language: "hu",
      reference: null,
      note: null,
      sourceType: null,
      sourceId: null,
      lines: [
        {
          productId: null,
          description: "Munkadíj",
          quantity: "2",
          unit: "óra",
          unitNet: "10000",
          vatRatePercent: "27",
          discountPercent: "10",
          comment: "Helyszíni munka",
        },
      ],
      ...overrides,
    } as BillingDocumentDraftDto;
  }

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
    const created = await prisma.user.create({
      data: {
        email: `${PREFIX.toLowerCase()}-actor@example.invalid`,
        displayName: `${PREFIX} aktor`,
        role: "OWNER",
      },
      select: { id: true },
    });
    user = { id: created.id } as AuthenticatedUser;
    const customer = await prisma.customer.create({
      data: {
        customerNumber: `${PREFIX}-C1`,
        type: "COMPANY",
        displayName: `${PREFIX} partner`,
        taxNumber: "12345678-2-42",
        addresses: {
          create: {
            type: "BILLING",
            isDefault: true,
            postalCode: "1146",
            city: "Budapest",
            line1: "Állatkerti krt. 6-12.",
          },
        },
      },
      select: { id: true },
    });
    customerId = customer.id;
  });

  after(async () => {
    await removeLeftovers();
    nincsMaradek([
      {
        nev: "a suite bizonylatai bent maradtak",
        darab: await prisma.invoice.count({
          where: { partnerName: { startsWith: PREFIX } },
        }),
      },
      {
        nev: "a suite ajánlatai bent maradtak",
        darab: await prisma.quote.count({
          where: { quoteNumber: { startsWith: PREFIX } },
        }),
      },
    ]);
  });

  it("a létrehozás a tétel alá teszi a negatív kedvezmény-sort, és a címet is visszaadja", async () => {
    const detail = await service.create(dto({ id: randomUUID() }), user);
    assert.equal(detail.status, "DRAFT");
    assert.equal(detail.documentNumber, null);
    assert.deepEqual(
      detail.lines.map((line) => [line.kind, line.netAmount, line.comment]),
      [
        ["ITEM", "20000.0000", "Helyszíni munka"],
        ["DISCOUNT", "-2000.0000", null],
      ],
    );
    assert.equal(detail.lines[1]!.parentLineId, detail.lines[0]!.id);
    // A végösszeg a nyomtatott (#1283: HUF-nál egész forint, a #1275
    // szabályával), nem a vázlat 4 tizedese.
    assert.equal(detail.totals.grossAmount, "22860");
    assert.equal(
      detail.customer?.address,
      "1146 Budapest, Állatkerti krt. 6-12.",
    );
  });

  it("ugyanazzal az azonosítóval másodszor nem hoz létre új vázlatot", async () => {
    const id = randomUUID();
    await service.create(dto({ id }), user);
    await service.create(dto({ id, reference: "MÁSIK" }), user);
    assert.equal(await prisma.invoice.count({ where: { id } }), 1);
    const stored = await prisma.invoice.findUniqueOrThrow({
      where: { id },
      select: { reference: true },
    });
    assert.equal(stored.reference, null);
  });

  it("a mentés lecseréli a tételeket, a régi időbélyeggel viszont ütközik", async () => {
    const created = await service.create(dto({ id: randomUUID() }), user);
    const saved = await service.update(
      created.id,
      dto({
        expectedUpdatedAt: created.updatedAt,
        documentType: "PROFORMA",
        invoiceFormat: null,
        lines: [{ ...dto().lines[0]!, discountPercent: null }],
      }),
    );
    assert.equal(saved.documentType, "PROFORMA");
    assert.equal(saved.invoiceFormat, null);
    assert.equal(saved.lines.length, 1);

    await assert.rejects(
      service.update(created.id, dto({ expectedUpdatedAt: created.updatedAt })),
      (error: Error) => error.constructor.name === "ConflictException",
    );
  });

  it("kiállított bizonylat nem menthető", async () => {
    const created = await service.create(dto({ id: randomUUID() }), user);
    const issued = await prisma.invoice.update({
      where: { id: created.id },
      data: { status: "ISSUED", invoiceNumber: `${PREFIX}-1` },
      select: { updatedAt: true },
    });
    await assert.rejects(
      service.update(
        created.id,
        dto({ expectedUpdatedAt: issued.updatedAt.toISOString() }),
      ),
      (error: Error) => error.constructor.name === "ConflictException",
    );
  });
  /*
    A VÁZLAT TÖRLÉSE (kártya 6a75f15c, Balázs kérdése): a feltételes írás, a kapcsolatok rendezése és a mérföldkő idegen kulcsa
    csak valódi adatbázison mérhető. MI PIROSÍT: ha a törölt vázlat vagy a tételei megmaradnak; ha a kiállított, sorszámos, hivatkozott
    vagy közben mentett vázlat törölhető; ha a mérföldkő lóg (a `Restrict` miatt a törlés el sem indul, vagy a mérföldkő a törölt sorra mutat);
    ha az előleg-vázlat azonosítója a törlés után nem szabadul fel (a második "előleg készítése" nem hozna újat).
  */
  it("a vázlat és a tételei törlődnek, a törlésről auditsor marad", async () => {
    const created = await service.create(dto({ id: randomUUID() }), user);
    assert.deepEqual(
      await service.deleteDraft(created.id, created.updatedAt, user),
      { deleted: true },
    );
    assert.equal(await prisma.invoice.count({ where: { id: created.id } }), 0);
    assert.equal(
      await prisma.invoiceLine.count({ where: { invoiceId: created.id } }),
      0,
    );
    const audit = await prisma.auditLog.findFirst({
      where: { action: "billing.draft_deleted", entityId: created.id },
      select: { userId: true },
    });
    assert.equal(audit?.userId, user.id);
  });

  it("a kiállított, a sorszámos és a közben mentett vázlat nem törölhető, és megmarad", async () => {
    const conflict = (error: Error) =>
      error.constructor.name === "ConflictException";
    const issued = await service.create(dto({ id: randomUUID() }), user);
    const after = await prisma.invoice.update({
      where: { id: issued.id },
      data: { status: "ISSUED", invoiceNumber: `${PREFIX}-DEL-1` },
      select: { updatedAt: true },
    });
    await assert.rejects(
      service.deleteDraft(issued.id, after.updatedAt.toISOString(), user),
      conflict,
    );

    const numbered = await service.create(dto({ id: randomUUID() }), user);
    const numberedAfter = await prisma.invoice.update({
      where: { id: numbered.id },
      data: { invoiceNumber: `${PREFIX}-DEL-2` },
      select: { updatedAt: true },
    });
    await assert.rejects(
      service.deleteDraft(
        numbered.id,
        numberedAfter.updatedAt.toISOString(),
        user,
      ),
      conflict,
    );

    const saved = await service.create(dto({ id: randomUUID() }), user);
    await service.update(saved.id, dto({ expectedUpdatedAt: saved.updatedAt }));
    await assert.rejects(
      service.deleteDraft(saved.id, saved.updatedAt, user),
      conflict,
    );

    for (const id of [issued.id, numbered.id, saved.id])
      assert.equal(await prisma.invoice.count({ where: { id } }), 1);
  });

  it("a másik bizonylat által hivatkozott vázlat nem törölhető", async () => {
    const proforma = await service.create(
      dto({ id: randomUUID(), documentType: "PROFORMA", invoiceFormat: null }),
      user,
    );
    const child = await service.create(dto({ id: randomUUID() }), user);
    await prisma.invoice.update({
      where: { id: child.id },
      data: { proformaInvoiceId: proforma.id },
    });
    await assert.rejects(
      service.deleteDraft(proforma.id, proforma.updatedAt, user),
      (error: Error) => error.constructor.name === "ConflictException",
    );
    assert.equal(await prisma.invoice.count({ where: { id: proforma.id } }), 1);
    // és a hivatkozás nem szakadt el
    const stored = await prisma.invoice.findUniqueOrThrow({
      where: { id: child.id },
      select: { proformaInvoiceId: true },
    });
    assert.equal(stored.proformaInvoiceId, proforma.id);
  });

  it("az előleg-vázlat törölhető, és ugyanabból a díjbekérőből újra készíthető", async () => {
    const proforma = await service.create(
      dto({ id: randomUUID(), documentType: "PROFORMA", invoiceFormat: null }),
      user,
    );
    await prisma.invoice.update({
      where: { id: proforma.id },
      data: { status: "ISSUED", invoiceNumber: `${PREFIX}-DEL-P` },
    });
    const first = await service.advanceFromProforma(proforma.id, user);
    await service.deleteDraft(first.id, first.updatedAt, user);
    assert.equal(await prisma.invoice.count({ where: { id: first.id } }), 0);
    const second = await service.advanceFromProforma(proforma.id, user);
    assert.equal(second.id, first.id);
    assert.equal(second.status, "DRAFT");
    assert.equal(await prisma.invoice.count({ where: { id: second.id } }), 1);
  });

  it("a mérföldkő díjbekérőjének törlése felszabadítja a mérföldkövet, nem hagyja lógni", async () => {
    const proforma = await service.create(
      dto({ id: randomUUID(), documentType: "PROFORMA", invoiceFormat: null }),
      user,
    );
    const quote = await prisma.quote.create({
      data: { quoteNumber: `${PREFIX}-Q1`, title: `${PREFIX} ajánlat` },
    });
    const version = await prisma.quoteVersion.create({
      data: {
        quoteId: quote.id,
        versionNumber: 1,
        status: "PUBLISHED",
        validUntil: new Date("2099-12-31T00:00:00Z"),
        priceDisplay: "NET",
        pdfStorageKey: "v1-test",
        pdfSha256: "0".repeat(64),
        pageCount: 1,
        publishedAt: new Date(),
      },
    });
    const milestone = await prisma.quotePaymentMilestone.create({
      data: {
        versionId: version.id,
        position: 0,
        label: "Előleg",
        percent: "60",
        proformaInvoiceId: proforma.id,
      },
    });
    await service.deleteDraft(proforma.id, proforma.updatedAt, user);
    assert.equal(await prisma.invoice.count({ where: { id: proforma.id } }), 0);
    const stored = await prisma.quotePaymentMilestone.findUniqueOrThrow({
      where: { id: milestone.id },
      select: { proformaInvoiceId: true },
    });
    assert.equal(stored.proformaInvoiceId, null);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "billing.draft_deleted", entityId: proforma.id },
      select: { metadata: true },
    });
    assert.equal(
      (audit?.metadata as { releasedQuoteMilestoneId?: string } | null)
        ?.releasedQuoteMilestoneId,
      milestone.id,
    );
  });
});
