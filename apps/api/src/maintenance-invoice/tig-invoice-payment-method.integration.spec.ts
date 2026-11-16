import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";

/**
 * THE ISSUED TIG INVOICES' PAYMENT METHOD, BACK-FILLED ONLY FROM A SOURCE (acrobot 47337: "a fizetési módot ne találd
 * ki"), on a real Postgres. WHAT TURNS THIS RED: a row with no Számlázz.hu twin gets a payment method anyway; twins
 * that disagree pick one; a payment method already on the row is overwritten; a draft, or a row that is not a TIG
 * invoice, is touched.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "TIGPAYMETHOD-";
const n = String(Date.now() % 1_000_000);

const BACKFILL = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../packages/database/prisma/migrations/20261111210000_tig_invoice_payment_method/migration.sql",
  ),
  "utf8",
);

const zero = new Prisma.Decimal(0);
const number = (key: string) => `${PREFIX}${key}-${n}`;

async function removeLeftovers() {
  await prisma.externalBillingDocument.deleteMany({
    where: { documentNumber: { startsWith: PREFIX } },
  });
  await prisma.invoice.deleteMany({ where: { partnerName: `${PREFIX}vevo` } });
}

async function invoice(
  key: string,
  over: Partial<Prisma.InvoiceUncheckedCreateInput> = {},
) {
  return prisma.invoice.create({
    data: {
      id: randomUUID(),
      direction: "OUTBOUND",
      documentType: "INVOICE",
      source: "SZAMLAZZ",
      status: "ISSUED",
      invoiceNumber: number(key),
      sourceType: "COMPLETION_CERTIFICATE",
      sourceId: randomUUID(),
      partnerName: `${PREFIX}vevo`,
      currency: "HUF",
      netAmount: zero,
      vatAmount: zero,
      grossAmount: zero,
      ...over,
    },
    select: { id: true },
  });
}

async function twin(key: string, paymentMethod: string | null) {
  await prisma.externalBillingDocument.create({
    data: {
      source: "SZAMLAZZ",
      externalId: `${PREFIX}${randomUUID()}`,
      feedMessageId: `${PREFIX}msg`,
      feedReceivedAt: new Date(),
      kindCode: "SZ",
      documentNumber: number(key),
      electronic: true,
      issueDate: new Date("2026-11-10T00:00:00Z"),
      currency: "HUF",
      customerName: `${PREFIX}vevo`,
      netAmount: zero,
      vatAmount: zero,
      grossAmount: zero,
      lines: [],
      paymentMethod,
    },
  });
}

describe(
  "the TIG invoices' payment method back-fill",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
    });
    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("fills only from one agreeing Számlázz.hu twin, and leaves every other row as it is", async () => {
      const rows = {
        twin: await invoice("twin"),
        noTwin: await invoice("notwin"),
        emptyTwin: await invoice("emptytwin"),
        disagree: await invoice("disagree"),
        alreadySet: await invoice("set", { paymentMethod: "Bankkártya" }),
        draft: await invoice("draft", {
          status: "DRAFT",
          invoiceNumber: null,
          sourceType: null,
          sourceId: null,
        }),
        notTig: await invoice("nottig", { sourceType: "MANUAL" }),
      };
      await twin("twin", "Átutalás");
      await twin("twin", "Átutalás"); // a second version of the same invoice agrees
      await twin("emptytwin", " ");
      await twin("disagree", "Átutalás");
      await twin("disagree", "Készpénz");
      await twin("set", "Átutalás");
      await twin("nottig", "Átutalás");

      await prisma.$executeRawUnsafe(BACKFILL);

      const found = await prisma.invoice.findMany({
        where: { id: { in: Object.values(rows).map((row) => row.id) } },
        select: { id: true, paymentMethod: true },
      });
      const methodOf = (key: keyof typeof rows) =>
        found.find((row) => row.id === rows[key].id)?.paymentMethod;
      assert.deepEqual(
        Object.fromEntries(
          (Object.keys(rows) as (keyof typeof rows)[]).map((key) => [
            key,
            methodOf(key),
          ]),
        ),
        {
          twin: "Átutalás",
          noTwin: null,
          emptyTwin: null,
          disagree: null,
          alreadySet: "Bankkártya",
          draft: null,
          notTig: null,
        },
      );
    });
  },
);
