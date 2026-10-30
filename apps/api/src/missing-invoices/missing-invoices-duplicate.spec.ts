import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { MissingInvoicesRepository } from "./missing-invoices.repository.js";
import { MissingInvoicesService } from "./missing-invoices.service.js";
import type { SupplierInvoiceImportService } from "../purchasing/supplier-invoice-import/supplier-invoice-import.service.js";

/**
 * DUPLIKÁTUM-JELÖLÉS (task bank-dupla-import). MI PIROSIT: egy párosított sor jelölhető (a dokumentum
 * árván maradna); a visszavonás nem ír; ismételt azonos kérés ír; a jelölés nem ír auditot / a mezők
 * nem nullázódnak vissza; a sor saját párja lehet; ismeretlen sor 200; a hónap-szűrő hibás alakja átmegy.
 */
const USER = { id: "u1" } as AuthenticatedUser;
const READER = {} as unknown as SupplierInvoiceImportService;
const D = (v: number | string) => new Prisma.Decimal(v);

function build(
  rows: Record<string, { duplicateMarkedAt: Date | null; matches: number }>,
) {
  const annotated: {
    id: string;
    action: string;
    data: unknown;
    metadata: unknown;
  }[] = [];
  const repository = {
    bankTransactionForDuplicate: async (id: string) =>
      rows[id]
        ? {
            id,
            duplicateMarkedAt: rows[id]!.duplicateMarkedAt,
            _count: { matches: rows[id]!.matches },
          }
        : null,
    annotate: async (
      id: string,
      _user: string,
      action: string,
      data: unknown,
      metadata: unknown,
    ) => {
      annotated.push({ id, action, data, metadata });
    },
    duplicates: async (month: string | null) => [
      {
        id: "t9",
        amount: D(1186.8),
        currency: "EUR",
        bookingDate: new Date("2026-10-12T00:00:00Z"),
        counterpartyName: "Aquarioom",
        narrative: "CM9266 0,0 CMCIFR2A",
        duplicateMarkedAt: new Date("2026-10-30T09:00:00Z"),
        duplicateOfId: "t8",
        _month: month,
      },
    ],
  } as unknown as MissingInvoicesRepository;
  return { service: new MissingInvoicesService(repository, READER), annotated };
}

describe("MissingInvoicesService.markDuplicate", () => {
  it("marks an unmatched line: the three fields and an audit action; the pair is recorded", async () => {
    const { service, annotated } = build({
      t1: { duplicateMarkedAt: null, matches: 0 },
      t0: { duplicateMarkedAt: null, matches: 0 },
    });
    assert.deepEqual(await service.markDuplicate("t1", true, "t0", USER), {
      id: "t1",
      duplicate: true,
    });
    assert.equal(annotated.length, 1);
    assert.equal(annotated[0]!.action, "missing-invoices.duplicate-marked");
    const data = annotated[0]!.data as {
      duplicateMarkedAt: Date;
      duplicateMarkedByUserId: string;
      duplicateOfId: string;
    };
    assert.ok(data.duplicateMarkedAt instanceof Date);
    assert.equal(data.duplicateMarkedByUserId, "u1");
    assert.equal(data.duplicateOfId, "t0");
  });

  it("a line paired to a document is refused (409), nothing is written", async () => {
    const { service, annotated } = build({
      t1: { duplicateMarkedAt: null, matches: 1 },
    });
    await assert.rejects(
      service.markDuplicate("t1", true, null, USER),
      ConflictException,
    );
    assert.deepEqual(annotated, []);
  });

  it("clearing resets the three fields and leaves an audit action", async () => {
    const { service, annotated } = build({
      t1: { duplicateMarkedAt: new Date(), matches: 0 },
    });
    assert.deepEqual(await service.markDuplicate("t1", false, null, USER), {
      id: "t1",
      duplicate: false,
    });
    assert.equal(annotated[0]!.action, "missing-invoices.duplicate-cleared");
    assert.deepEqual(annotated[0]!.data, {
      duplicateMarkedAt: null,
      duplicateMarkedByUserId: null,
      duplicateOfId: null,
    });
  });

  it("the same request again changes nothing (marked twice, cleared twice)", async () => {
    const { service, annotated } = build({
      marked: { duplicateMarkedAt: new Date(), matches: 0 },
      plain: { duplicateMarkedAt: null, matches: 0 },
    });
    assert.deepEqual(await service.markDuplicate("marked", true, null, USER), {
      id: "marked",
      duplicate: true,
    });
    assert.deepEqual(await service.markDuplicate("plain", false, null, USER), {
      id: "plain",
      duplicate: false,
    });
    assert.deepEqual(annotated, []);
  });

  it("an unknown line is 404; a line cannot be its own pair; an unknown pair is 400", async () => {
    const { service, annotated } = build({
      t1: { duplicateMarkedAt: null, matches: 0 },
    });
    await assert.rejects(
      service.markDuplicate("nincs", true, null, USER),
      NotFoundException,
    );
    await assert.rejects(
      service.markDuplicate("t1", true, "t1", USER),
      BadRequestException,
    );
    await assert.rejects(
      service.markDuplicate("t1", true, "nincs", USER),
      BadRequestException,
    );
    assert.deepEqual(annotated, []);
  });
});

describe("MissingInvoicesService.duplicates", () => {
  it("lists the marked lines with their amounts as the pages show them; a bad month is refused", async () => {
    const { service } = build({});
    const list = await service.duplicates("2026-10");
    assert.deepEqual(list.items, [
      {
        id: "t9",
        bookingDate: "2026-10-12",
        amount: "1186.80",
        currency: "EUR",
        partner: "Aquarioom",
        narrative: "CM9266 0,0 CMCIFR2A",
        markedAt: "2026-10-30T09:00:00.000Z",
        duplicateOfId: "t8",
      },
    ]);
    await assert.rejects(service.duplicates("2026-13"), BadRequestException);
    await assert.rejects(service.duplicates("október"), BadRequestException);
    assert.equal((await service.duplicates(null)).items.length, 1);
  });
});

describe("MissingInvoicesRepository: the pages never read a marked duplicate", () => {
  const withCapture = () => {
    const seen: { where?: Record<string, unknown> }[] = [];
    const repository = new MissingInvoicesRepository();
    Object.assign(repository, {
      database: {
        bankTransaction: {
          findMany: async (args: { where?: Record<string, unknown> }) => (
            seen.push(args),
            []
          ),
        },
      },
    });
    return { repository, seen };
  };

  it("debits and credits leave the marked lines out, and a caller's where cannot bring them back", async () => {
    const { repository, seen } = withCapture();
    await repository.debits();
    await repository.debits({
      duplicateMarkedAt: { not: null },
      direction: "CREDIT",
    });
    await repository.credits();
    assert.deepEqual(seen[0]!.where, {
      direction: "DEBIT",
      duplicateMarkedAt: null,
    });
    assert.deepEqual(seen[1]!.where, {
      direction: "DEBIT",
      duplicateMarkedAt: null,
    });
    assert.deepEqual(seen[2]!.where, {
      direction: "CREDIT",
      duplicateMarkedAt: null,
    });
  });
});
