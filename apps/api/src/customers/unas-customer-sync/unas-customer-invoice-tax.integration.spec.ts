import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import {
  UnasInvoiceTaxRepository,
  unasInvoiceTaxCounts,
} from "./unas-customer-invoice-tax.js";

/**
 * THE MEASUREMENT'S READ, on a real Postgres (acrobot 42630). WHAT TURNS THIS RED: a UNAS customer's invoice bound
 * only through its sales order missing; a storno, a draft, an incoming invoice or a non-UNAS customer's invoice
 * counted; a select field that does not exist (a Prisma select is not type-checked against a typo in a nested path
 * the way a where is).
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "UNASINVTAX-";
const n = String(Date.now() % 1_000_000).padStart(6, "0");
const ids: Record<string, string> = {};

async function removeLeftovers() {
  await prisma.invoice.deleteMany({
    where: { invoiceNumber: { startsWith: PREFIX } },
  });
  await prisma.salesOrder.deleteMany({
    where: { orderNumber: { startsWith: PREFIX } },
  });
  await prisma.externalReference.deleteMany({
    where: { system: "UNAS", externalId: { startsWith: `98${n}` } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

describe(
  "the UNAS customers' invoice tax measurement",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      let k = 0;
      for (const key of ["direct", "order", "excluded", "plain"]) {
        const row = await prisma.customer.create({
          data: {
            customerNumber: `${PREFIX}${key}-${n}`,
            type: "COMPANY",
            displayName: `${PREFIX}${key}`,
          },
          select: { id: true },
        });
        ids[key] = row.id;
        if (key !== "plain")
          await prisma.externalReference.create({
            data: {
              system: "UNAS",
              entityType: "Customer",
              entityId: row.id,
              externalId: `98${n}${++k}`,
            },
          });
      }
      const order = await prisma.salesOrder.create({
        data: {
          orderNumber: `${PREFIX}order-${n}`,
          channel: "UNAS",
          customerId: ids.order!,
          orderedAt: new Date("2026-10-01T10:00:00.000Z"),
        },
        select: { id: true },
      });
      let i = 0;
      const invoice = (
        data: Partial<Parameters<typeof prisma.invoice.create>[0]["data"]>,
      ) =>
        prisma.invoice.create({
          data: {
            direction: "OUTBOUND",
            source: "SZAMLAZZ",
            status: "ISSUED",
            invoiceNumber: `${PREFIX}${n}-${++i}`,
            partnerName: "x",
            partnerTaxNumber: "15490658-2-42",
            ...data,
          } as Parameters<typeof prisma.invoice.create>[0]["data"],
        });
      await invoice({ customerId: ids.direct });
      // bound through the order only, the way a UNAS invoice comes in
      await invoice({
        salesOrderId: order.id,
        buyerSnapshot: { name: "x", taxNumber: "22222222-2-22" },
      });
      await invoice({ customerId: ids.excluded, documentType: "STORNO" });
      await invoice({ customerId: ids.excluded, status: "DRAFT" });
      await invoice({ customerId: ids.excluded, direction: "INBOUND" });
      await invoice({ customerId: ids.plain });
    });

    after(removeLeftovers);

    it("reads the UNAS customers' issued outgoing invoices, through the customer or the order", async () => {
      const { unasCustomerIds, invoices } =
        await new UnasInvoiceTaxRepository().rows();
      const ours = new Set(Object.values(ids));
      const counts = unasInvoiceTaxCounts(
        unasCustomerIds.filter((id) => ours.has(id)),
        invoices.filter(
          (row) =>
            ours.has(row.customerId ?? "") ||
            ours.has(row.salesOrder?.customerId ?? ""),
        ),
      );
      assert.deepEqual(counts, {
        unasCustomers: 3,
        customersWithInvoice: 2,
        invoices: 2,
        invoicesBoundThroughOrder: 1,
        invoicesWithHuTaxNumber: 2,
        customersUnambiguous: 2,
        customersContradictory: 0,
        customersWithoutHuTaxNumber: 0,
      });
    });
  },
);
