import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { UnasApiCustomer, UnasApiCustomerAddress } from "@acropora/types";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import {
  UNAS_TAX_BACKFILL_EVENT_ID,
  UnasCustomerSyncRepository,
} from "./unas-customer-sync.repository.js";

/**
 * THE UNAS CUSTOMER SYNC'S TAX FIELDS AND THE MERGE GUARD, on a real Postgres (Balázs 2026-11-04 19:07 UTC, acrobot
 * 42670, murena 42674). WHAT TURNS THIS RED: a new company row without its UNAS tax number, EU number or name; an
 * empty field left empty on an unchanged UNAS record; a colleague's tax number overwritten; a merged reference whose
 * row, addresses or tax field the sync touches; a backfill that writes on a filled, merged or person row, counts a
 * customer in another bucket, leaves no marker, or runs a second time.
 */
const gate = integrationDatabaseGate(process.env);
const repository = new UnasCustomerSyncRepository();

const n = String(Date.now() % 1_000_000).padStart(6, "0");
const id = (k: number) => `97${n}${k}`;

const address = (
  over: Partial<UnasApiCustomerAddress> = {},
): UnasApiCustomerAddress => ({
  name: "Állatkert Teszt Zrt.",
  zip: "1146",
  city: "Budapest",
  street: "Teszt utca 1.",
  country: "Magyarország",
  countryCode: "HU",
  taxNumber: "15490658-2-42",
  euTaxNumber: "HU15490658",
  customerType: "company",
  ...over,
});
const customer = (
  k: number,
  invoiceAddress: UnasApiCustomerAddress | null,
  contactName = `Teszt ${k}`,
): UnasApiCustomer => ({
  externalId: id(k),
  email: null,
  contactName,
  contactPhone: null,
  contactMobile: null,
  invoiceAddress,
  shippingAddress: null,
  sourceCreatedAt: null,
  sourceUpdatedAt: null,
});

const company = customer(1, address());
const person = customer(2, address({ customerType: "private" }));
const manual = customer(3, address({ taxNumber: "22222222-2-22" }));
const merged = customer(4, address());

async function references() {
  const rows = await prisma.externalReference.findMany({
    where: {
      system: "UNAS",
      entityType: "Customer",
      externalId: { in: [1, 2, 3, 4, 5].map(id) },
    },
  });
  return new Map(rows.map((row) => [row.externalId, row]));
}

async function rowOf(k: number) {
  const reference = (await references()).get(id(k))!;
  return prisma.customer.findUniqueOrThrow({
    where: { id: reference.entityId },
    select: {
      displayName: true,
      taxNumber: true,
      euTaxNumber: true,
      companyName: true,
      addresses: { select: { line1: true } },
    },
  });
}

async function apply(customers: UnasApiCustomer[]) {
  const windowEnd = new Date();
  const runId = await repository.createRun({ windowStart: null, windowEnd });
  return repository.apply(runId, customers, null, windowEnd);
}

async function removeLeftovers() {
  await prisma.domainEvent.deleteMany({
    where: { id: UNAS_TAX_BACKFILL_EVENT_ID },
  });
  const refs = await references();
  const ids = [...refs.values()].map((row) => row.entityId);
  await prisma.externalReference.deleteMany({
    where: { id: { in: [...refs.values()].map((row) => row.id) } },
  });
  await prisma.customer.deleteMany({ where: { id: { in: ids } } });
}

describe(
  "the UNAS customer sync's tax fields",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
    });
    after(removeLeftovers);

    it("a new company row gets the tax fields, a person none", async () => {
      const result = await apply([company, person, manual, merged]);
      assert.equal(result.createdCount, 4);
      assert.deepEqual(
        {
          taxNumber: (await rowOf(1)).taxNumber,
          euTaxNumber: (await rowOf(1)).euTaxNumber,
          companyName: (await rowOf(1)).companyName,
        },
        {
          taxNumber: "15490658-2-42",
          euTaxNumber: "HU15490658",
          companyName: "Állatkert Teszt Zrt.",
        },
      );
      assert.equal((await rowOf(2)).taxNumber, null);
      assert.equal((await rowOf(2)).companyName, null);
    });

    it("fills an empty field on an unchanged record, keeps a hand edit, and leaves a merged row alone", async () => {
      const refs = await references();
      await prisma.customer.update({
        where: { id: refs.get(id(1))!.entityId },
        data: { taxNumber: null },
      });
      await prisma.customer.update({
        where: { id: refs.get(id(3))!.entityId },
        data: { taxNumber: "11111111-1-11" },
      });
      const mergedRef = refs.get(id(4))!;
      await prisma.externalReference.update({
        where: { id: mergedRef.id },
        data: {
          metadata: {
            ...(mergedRef.metadata as object),
            mergedFrom: "gone-row",
          },
        },
      });
      await prisma.customer.update({
        where: { id: mergedRef.entityId },
        data: { taxNumber: null },
      });

      const result = await apply([
        company,
        manual,
        // the UNAS record changed: today's sync would rewrite the name and the addresses
        customer(4, address({ street: "Új utca 9." }), "Új név"),
      ]);
      assert.equal(result.updatedCount, 1, "the refilled row");
      assert.equal(result.unchangedCount, 2, "the hand edit and the merged");
      assert.equal((await rowOf(1)).taxNumber, "15490658-2-42");
      assert.equal((await rowOf(3)).taxNumber, "11111111-1-11");
      const mergedRow = await rowOf(4);
      assert.equal(mergedRow.displayName, "Teszt 4");
      assert.equal(mergedRow.taxNumber, null);
      assert.deepEqual(
        mergedRow.addresses.map((row) => row.line1),
        ["Teszt utca 1."],
      );
      const after = (await references()).get(id(4))!;
      assert.ok(after.lastSyncedAt! > mergedRef.lastSyncedAt!);
      assert.equal(
        (after.metadata as { mergedFrom?: string }).mergedFrom,
        "gone-row",
      );
    });

    it("the backfill fills once, counts every customer in one bucket, and leaves a marker", async () => {
      const refs = await references();
      await prisma.customer.update({
        where: { id: refs.get(id(1))!.entityId },
        data: { taxNumber: null, euTaxNumber: "  ", companyName: null },
      });
      const unknown = customer(5, address());
      const counts = await repository.backfillTaxFields([
        company,
        person,
        manual,
        merged,
        unknown,
      ]);
      assert.deepEqual(counts, {
        customers: 5,
        filled: 1,
        alreadyHad: 1,
        missingInUnas: 0,
        notHungarianShape: 0,
        person: 1,
        noOsRow: 1,
        merged: 1,
        companyNameFilled: 1,
      });
      const row = await rowOf(1);
      assert.equal(row.taxNumber, "15490658-2-42");
      assert.equal(row.euTaxNumber, "HU15490658");
      assert.equal((await rowOf(3)).taxNumber, "11111111-1-11");
      assert.equal((await rowOf(4)).taxNumber, null);

      const event = await prisma.domainEvent.findUniqueOrThrow({
        where: { id: UNAS_TAX_BACKFILL_EVENT_ID },
      });
      assert.deepEqual((event.payload as { filled: unknown }).filled, [
        {
          customerId: refs.get(id(1))!.entityId,
          fields: ["companyName", "euTaxNumber", "taxNumber"],
        },
      ]);

      await prisma.customer.update({
        where: { id: refs.get(id(1))!.entityId },
        data: { taxNumber: null },
      });
      assert.equal(await repository.backfillTaxFields([company]), null);
      assert.equal(
        (await rowOf(1)).taxNumber,
        null,
        "the second run writes nothing",
      );
    });
  },
);
