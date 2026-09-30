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
    assert.equal(detail.totals.grossAmount, "22860.0000");
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
});
