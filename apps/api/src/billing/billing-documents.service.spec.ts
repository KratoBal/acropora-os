import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import type { BillingDocumentRow } from "./billing-documents.repository.js";
import { BillingDocumentsService } from "./billing-documents.service.js";
import type { BillingDocumentDraftDto } from "./dto/billing-document-draft.dto.js";

/**
 * A SZÁMLÁZÁSI VÁZLAT SZOLGÁLTATÁSA, TÁROLÓ-DUPLÁVAL. A tároló feltételes
 * írását (azonosító-ütközés, `updatedAt`, állapot) a valódi adatbázis méri
 * (`billing-documents.integration.spec.ts`); ez a spec azt, hogy a
 * szolgáltatás mit kér tőle és mit mond a hívónak.
 */
const USER = { id: "user-1" } as AuthenticatedUser;

function dto(overrides: Partial<BillingDocumentDraftDto> = {}) {
  return {
    documentType: "INVOICE",
    invoiceFormat: "ELECTRONIC",
    customerId: "cust-1",
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
        quantity: "1",
        unit: "db",
        unitNet: "1000",
        vatRatePercent: "27",
        discountPercent: null,
        comment: null,
      },
    ],
    ...overrides,
  } as BillingDocumentDraftDto;
}

function row(id: string): BillingDocumentRow {
  const d = (value: string) => new Prisma.Decimal(value);
  return {
    id,
    status: "DRAFT",
    emailStatus: "PENDING",
    invoiceNumber: null,
    documentType: "INVOICE",
    invoiceFormat: "ELECTRONIC",
    customer: null,
    fulfillmentDate: null,
    dueDate: null,
    paymentMethod: null,
    currency: "HUF",
    language: "hu",
    reference: null,
    note: null,
    sourceType: "MANUAL",
    sourceId: null,
    netAmount: d("1000"),
    vatAmount: d("270"),
    grossAmount: d("1270"),
    lines: [],
    createdAt: new Date("2026-09-30T10:00:00Z"),
    updatedAt: new Date("2026-09-30T10:00:00Z"),
  } as unknown as BillingDocumentRow;
}

function repository(overrides: Record<string, unknown> = {}) {
  const calls: Record<string, unknown[]> = { create: [], update: [] };
  const repo = {
    customer: async () => ({
      id: "cust-1",
      displayName: "Állatkert",
      companyName: "Fővárosi Állat- és Növénykert",
      taxNumber: "12345678-2-42",
    }),
    find: async (id: string) => row(id),
    create: async (input: unknown) => {
      calls.create!.push(input);
      return { created: true };
    },
    update: async (input: unknown) => {
      calls.update!.push(input);
      return "ok";
    },
    ...overrides,
  };
  return { repo: repo as never, calls };
}

describe("BillingDocumentsService", () => {
  it("a kliens azonosítójával hoz létre, a partner nevével", async () => {
    const { repo, calls } = repository();
    const detail = await new BillingDocumentsService(repo).create(
      dto({ id: "draft-abc123" }),
      USER,
    );
    assert.equal(detail.id, "draft-abc123");
    const sent = calls.create![0] as {
      id: string;
      partnerName: string;
      createdByUserId: string;
    };
    assert.deepEqual(
      [sent.id, sent.partnerName, sent.createdByUserId],
      ["draft-abc123", "Fővárosi Állat- és Növénykert", "user-1"],
    );
  });

  /*
    A DUPLA KATTINTÁS: a második létrehozás a meglévő vázlatot adja vissza,
    hiba nélkül. MI PIROSÍT: ha a szolgáltatás a `created: false`-t hibának
    venné, vagy új azonosítót generálna.
  */
  it("újraküldött létrehozásnál a meglévő vázlatot adja vissza", async () => {
    const { repo } = repository({ create: async () => ({ created: false }) });
    const detail = await new BillingDocumentsService(repo).create(
      dto({ id: "draft-abc123" }),
      USER,
    );
    assert.equal(detail.id, "draft-abc123");
  });

  it("a nem ide tartozó sor azonosítója ütközés", async () => {
    const { repo } = repository({
      create: async () => ({ created: false }),
      find: async () => null,
    });
    await assert.rejects(
      new BillingDocumentsService(repo).create(dto({ id: "foreign-1" }), USER),
      ConflictException,
    );
  });

  it("a formátum-hiba a tároló előtt áll meg", async () => {
    const { repo, calls } = repository();
    await assert.rejects(
      new BillingDocumentsService(repo).create(
        dto({ documentType: "DELIVERY_NOTE", invoiceFormat: "PAPER" }),
        USER,
      ),
      BadRequestException,
    );
    assert.equal(calls.create!.length, 0);
  });

  it("ismeretlen partnerre nem hoz létre semmit", async () => {
    const { repo, calls } = repository({ customer: async () => null });
    await assert.rejects(
      new BillingDocumentsService(repo).create(dto(), USER),
      BadRequestException,
    );
    assert.equal(calls.create!.length, 0);
  });

  it("mentés az ütközés-őr nélkül nem indul", async () => {
    const { repo, calls } = repository();
    await assert.rejects(
      new BillingDocumentsService(repo).update("d1", dto()),
      BadRequestException,
    );
    assert.equal(calls.update!.length, 0);
  });

  it("a kiállított és az időközben mentett vázlat ütközés, a hiányzó 404", async () => {
    for (const [outcome, name] of [
      ["not-editable", "ConflictException"],
      ["stale", "ConflictException"],
      ["gone", "NotFoundException"],
    ] as const) {
      const { repo } = repository({ update: async () => outcome });
      await assert.rejects(
        new BillingDocumentsService(repo).update(
          "d1",
          dto({ expectedUpdatedAt: "2026-09-30T10:00:00.000Z" }),
        ),
        (error: Error) => error.constructor.name === name,
      );
    }
  });
});
