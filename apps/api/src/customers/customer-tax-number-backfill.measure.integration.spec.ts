import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  CustomerTaxNumberBackfillRepository,
  type BackfillMeasure,
} from "./customer-tax-number-backfill.reporter.js";

/**
 * A VISSZATÖLTÉS MÉRÉSE VALÓDI POSTGRESEN (acrobot 42586). A számlálás az egész
 * adatbázisra fut, ezért a teszt a feltöltés előtti és utáni mérés KÜLÖNBSÉGÉT méri.
 * MI PIROSÍT: ha egy számláló rossz halmazt számol (nem UNAS rendelés, üres adószám,
 * kötetlen rendelés, nem UNAS-vevő, a típusok, a céges adószámos rendelés vevőnként egyszer).
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "TAXMEASURE-";

async function removeLeftovers() {
  await prisma.salesOrder.deleteMany({
    where: { orderNumber: { startsWith: PREFIX } },
  });
  await prisma.externalReference.deleteMany({
    where: { externalId: { startsWith: PREFIX } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

describe(
  "the customer tax number backfill measurement",
  { skip: gate.mode === "skip" },
  () => {
    const n = Date.now() % 1_000_000;
    const repository = new CustomerTaxNumberBackfillRepository();
    let before0: BackfillMeasure;
    let orders = 0;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      before0 = await repository.measure();
      const customer = async (
        key: string,
        type: "PERSON" | "COMPANY",
        unas: boolean,
      ) => {
        const row = await prisma.customer.create({
          data: {
            customerNumber: `${PREFIX}${key}-${n}`,
            type,
            displayName: `${PREFIX}${key}`,
          },
          select: { id: true },
        });
        if (unas)
          await prisma.externalReference.create({
            data: {
              system: "UNAS",
              entityType: "Customer",
              entityId: row.id,
              externalId: `${PREFIX}${key}-${n}`,
            },
          });
        return row.id;
      };
      const order = (data: {
        channel?: "UNAS" | "POS";
        customerId?: string | null;
        buyerTaxNumber?: string | null;
        buyerCustomerType?: string | null;
      }) =>
        prisma.salesOrder.create({
          data: {
            orderNumber: `${PREFIX}${n}-${++orders}`,
            channel: data.channel ?? "UNAS",
            customerId: data.customerId ?? null,
            buyerTaxNumber: data.buyerTaxNumber ?? null,
            buyerCustomerType: data.buyerCustomerType ?? null,
          },
        });
      const companyUnas = await customer("company", "COMPANY", true);
      const personUnas = await customer("person", "PERSON", true);
      const manual = await customer("manual", "COMPANY", false);
      // a company typed as a person in UNAS, with two company orders: one customer
      await order({
        customerId: personUnas,
        buyerTaxNumber: "11111111-1-11",
        buyerCustomerType: "company",
      });
      await order({
        customerId: personUnas,
        buyerTaxNumber: "11111111-1-11",
        buyerCustomerType: "company",
      });
      await order({
        customerId: companyUnas,
        buyerTaxNumber: "22222222-2-22",
        buyerCustomerType: "private",
      });
      // taxed, but bound to a customer that is not from UNAS
      await order({
        customerId: manual,
        buyerTaxNumber: "33333333-3-33",
        buyerCustomerType: "company",
      });
      // taxed, not bound to any customer
      await order({
        buyerTaxNumber: "44444444-4-44",
        buyerCustomerType: "company",
      });
      // no tax number (null and empty), and a POS order with one
      await order({ customerId: companyUnas });
      await order({ customerId: companyUnas, buyerTaxNumber: "" });
      await order({
        channel: "POS",
        customerId: companyUnas,
        buyerTaxNumber: "55555555-5-55",
      });
    });

    after(removeLeftovers);

    it("counts each set, and a customer once", async () => {
      const now = await repository.measure();
      const delta = Object.fromEntries(
        Object.entries(now).map(([key, value]) => [
          key,
          value - before0[key as keyof BackfillMeasure],
        ]),
      );
      assert.deepEqual(delta, {
        unasOrders: 7,
        unasOrdersWithTax: 5,
        unasOrdersWithTaxLinked: 4,
        unasOrdersWithTaxUnasCustomer: 3,
        unasCustomers: 2,
        unasCustomersPerson: 1,
        unasCustomersCompany: 1,
        unasCustomersWithCompanyTaxedOrder: 1,
      });
    });
  },
);
