import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";

/**
 * A VEVŐ ADÓSZÁMA A SAJÁT RENDELÉSEIBŐL, EGYSZER (kártya aaf4f09d; acrobot 42470), valódi
 * Postgresen. MI PIROSÍT: ha az egyetlen magyar adószám nem jut a vevőbe, vagy nem a
 * legutóbbi rendelés alakjában; ha két különböző adószám közül választ; ha külföldi alakú
 * értéket ír a magyar mezőbe; ha a kitöltött adószámot felülírja; ha másodszor futtatva
 * mást ad (idempotens).
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "TAXORDERS-";
/** one DO block: a single statement for a prepared statement */
const SQL = readFileSync(
  new URL(
    "../../../../packages/database/prisma/migrations/20261104160000_customer_tax_number_from_orders/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

async function removeLeftovers() {
  await prisma.salesOrder.deleteMany({
    where: { orderNumber: { startsWith: PREFIX } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

describe(
  "the customer tax number backfill from the orders",
  { skip: gate.mode === "skip" },
  () => {
    const n = Date.now() % 1_000_000;
    const ids: Record<string, string> = {};
    let orders = 0;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const customer = async (key: string, taxNumber?: string) => {
        const row = await prisma.customer.create({
          data: {
            customerNumber: `${PREFIX}${key}-${n}`,
            type: "COMPANY",
            displayName: `${PREFIX}${key}`,
            ...(taxNumber ? { taxNumber } : {}),
          },
          select: { id: true },
        });
        ids[key] = row.id;
      };
      const order = (key: string, buyerTaxNumber: string, day: string) =>
        prisma.salesOrder.create({
          data: {
            orderNumber: `${PREFIX}${key}-${n}-${++orders}`,
            channel: "UNAS",
            customerId: ids[key]!,
            buyerTaxNumber,
            orderedAt: new Date(`${day}T10:00:00.000Z`),
          },
        });
      await customer("one");
      await customer("conflict");
      await customer("foreign");
      await customer("kept", "11111111-1-11");
      await customer("none");
      // the same number twice, in two forms: one number; the latest form goes in
      await order("one", "15490658242", "2026-09-01");
      await order("one", " 15490658-2-42 ", "2026-10-01");
      await order("conflict", "15490658-2-42", "2026-09-01");
      await order("conflict", "22222222-2-22", "2026-10-01");
      await order("foreign", "DE123456789", "2026-10-01");
      await order("kept", "33333333-3-33", "2026-10-01");
    });

    after(removeLeftovers);

    it("fills only an empty tax number from one Hungarian number, and is idempotent", async () => {
      for (let round = 0; round < 2; round++) {
        await prisma.$executeRawUnsafe(SQL);
        const rows = await prisma.customer.findMany({
          where: { id: { in: Object.values(ids) } },
          select: { id: true, taxNumber: true, euTaxNumber: true },
        });
        const tax = new Map(rows.map((row) => [row.id, row.taxNumber]));
        assert.deepEqual(
          {
            one: tax.get(ids.one!),
            conflict: tax.get(ids.conflict!),
            foreign: tax.get(ids.foreign!),
            kept: tax.get(ids.kept!),
            none: tax.get(ids.none!),
          },
          {
            one: "15490658-2-42",
            conflict: null,
            foreign: null,
            kept: "11111111-1-11",
            none: null,
          },
          `round ${round}`,
        );
        assert.ok(
          rows.every((row) => row.euTaxNumber === null),
          `round ${round}: the EU field is never touched`,
        );
      }
    });
  },
);
