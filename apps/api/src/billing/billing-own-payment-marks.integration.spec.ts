import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { ownPaymentMarksByInvoice } from "./billing-document-list.repository.js";

/**
 * A SAJÁT, BEÍRT JELÖLÉSEK OLVASÁSA A KIMENŐ NÉZETHEZ, A VALÓDI ADATBÁZISON
 * (acrobot 26027). MI PIROSÍT: ha a PLANNED, UNKNOWN vagy FAILED sor is
 * kifizetésnek számítana (arról nem tudjuk, hogy beíródott); ha a jelölések nem
 * a számlaszám szerint csoportosulnának; ha egy másik számla jelölése ide
 * keveredne.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "ownmark-it-";

async function removeLeftovers() {
  await prisma.outgoingPaymentMark.deleteMany({
    where: { invoiceNumber: { startsWith: PREFIX } },
  });
}

describe(
  "the own written paid marks, by invoice number",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const row = (
        invoice: string,
        source: "GLS_COD" | "SIMPLEPAY",
        state: "WRITTEN" | "PLANNED" | "UNKNOWN" | "FAILED",
        day: string,
      ) =>
        prisma.outgoingPaymentMark.create({
          data: {
            source,
            invoiceNumber: `${PREFIX}${invoice}`,
            markDate: new Date(`${day}T00:00:00.000Z`),
            amount: new Prisma.Decimal(1000),
            sourceRef: `${PREFIX}${invoice}-${state}-${day}`,
            state,
          },
        });
      await row("1", "GLS_COD", "WRITTEN", "2099-03-17");
      await row("1", "SIMPLEPAY", "WRITTEN", "2099-03-20");
      await row("1", "GLS_COD", "FAILED", "2099-03-18");
      await row("2", "GLS_COD", "PLANNED", "2099-03-17");
      await row("3", "SIMPLEPAY", "UNKNOWN", "2099-03-17");
      await row("4", "GLS_COD", "WRITTEN", "2099-03-17");
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "a teszt-jelölés bent maradt a naplóban",
          darab: await prisma.outgoingPaymentMark.count({
            where: { invoiceNumber: { startsWith: PREFIX } },
          }),
        },
      ]);
    });

    it("only WRITTEN rows, grouped by invoice, in day order", async () => {
      const marks = await ownPaymentMarksByInvoice(prisma, [
        `${PREFIX}1`,
        `${PREFIX}2`,
        `${PREFIX}3`,
      ]);
      assert.deepEqual(
        [...marks].map(([invoice, rows]) => [
          invoice,
          rows.map((r) => [r.source, r.markDate.toISOString().slice(0, 10)]),
        ]),
        [
          [
            `${PREFIX}1`,
            [
              ["GLS_COD", "2099-03-17"],
              ["SIMPLEPAY", "2099-03-20"],
            ],
          ],
        ],
      );
    });
  },
);
