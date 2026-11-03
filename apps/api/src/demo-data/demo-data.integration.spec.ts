import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { prismaDemoStore } from "./demo-data.cli.js";
import { DEMO_PREFIX, demoPlan } from "./demo-data.plan.js";

/**
 * THE DEMO ROWS ON THE REAL DATABASE (card c958804d, T6.3). WHAT TURNS IT RED: a row the
 * plan carries that the database refuses (a new required column, a wrong enum value); a
 * second `apply` that writes again (the run would double the demo data); `remove` leaving a
 * DEMO- row, or taking a row that does not carry the prefix.
 */
const gate = integrationDatabaseGate(process.env);
const KEEP_CUSTOMER = "KEEP-demo-data-it-1";
const DAY = "2026-11-04";

async function counts() {
  return {
    customers: await prisma.customer.count({
      where: { customerNumber: { startsWith: DEMO_PREFIX } },
    }),
    quotes: await prisma.quote.count({
      where: { quoteNumber: { startsWith: DEMO_PREFIX } },
    }),
    incomingInvoices: await prisma.incomingBillingDocument.count({
      where: { externalId: { startsWith: DEMO_PREFIX } },
    }),
  };
}

describe(
  "the demo rows in the database",
  { skip: gate.mode === "skip" },
  () => {
    const store = prismaDemoStore(prisma);
    const plan = demoPlan(DAY);
    const planned = {
      customers: plan.customers.length,
      quotes: plan.quotes.length,
      incomingInvoices: plan.incomingInvoices.length,
    };

    before(async () => {
      await store.remove();
      await prisma.customer.deleteMany({
        where: { customerNumber: KEEP_CUSTOMER },
      });
      await prisma.customer.create({
        data: {
          customerNumber: KEEP_CUSTOMER,
          type: "PERSON",
          displayName: "Nem demo ügyfél",
        },
      });
    });

    after(async () => {
      await store.remove();
      await prisma.customer.deleteMany({
        where: { customerNumber: KEEP_CUSTOMER },
      });
      const left = await counts();
      nincsMaradek([
        { nev: "DEMO ügyfelek", darab: left.customers },
        { nev: "DEMO ajánlatok", darab: left.quotes },
        { nev: "DEMO bejövő számlák", darab: left.incomingInvoices },
        {
          nev: "a kontroll ügyfél",
          darab: await prisma.customer.count({
            where: { customerNumber: KEEP_CUSTOMER },
          }),
        },
      ]);
    });

    it("loads every planned row, and a second run writes nothing", async () => {
      assert.deepEqual(await store.apply(plan), planned);
      assert.deepEqual(await counts(), planned);
      assert.deepEqual(await store.apply(plan), {
        customers: 0,
        quotes: 0,
        incomingInvoices: 0,
      });
      assert.deepEqual(await counts(), planned);
    });

    it("gives every quote its version, blocks, items, milestones and event", async () => {
      for (const quote of plan.quotes) {
        const row = await prisma.quote.findUniqueOrThrow({
          where: { quoteNumber: quote.quoteNumber },
          include: {
            customer: { select: { customerNumber: true } },
            events: true,
            versions: {
              include: {
                blocks: { include: { items: true } },
                milestones: true,
              },
            },
          },
        });
        assert.equal(row.status, "DRAFT", quote.quoteNumber);
        assert.equal(row.customer?.customerNumber, quote.customerNumber);
        assert.equal(row.events.length, 1, quote.quoteNumber);
        assert.equal(row.versions.length, 1, quote.quoteNumber);
        const version = row.versions[0]!;
        assert.equal(version.status, "DRAFT", quote.quoteNumber);
        assert.equal(version.blocks.length, quote.blocks.length);
        assert.equal(
          version.blocks.reduce((n, b) => n + b.items.length, 0),
          quote.blocks.reduce((n, b) => n + b.items.length, 0),
          quote.quoteNumber,
        );
        assert.equal(version.milestones.length, quote.milestones.length);
      }
    });

    it("removes exactly the DEMO- rows and not a row without the prefix", async () => {
      assert.deepEqual(await store.remove(), planned);
      assert.deepEqual(await counts(), {
        customers: 0,
        quotes: 0,
        incomingInvoices: 0,
      });
      assert.equal(
        await prisma.customer.count({
          where: { customerNumber: KEEP_CUSTOMER },
        }),
        1,
      );
    });
  },
);
