import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { prismaOwnInvoicesByNumber } from "./external-invoice-mail-pdf.cli.js";

/*
  THE OS'S OWN INVOICE BEHIND A CMFX LETTER, ON THE REAL DATABASE (785dfea6, acrobot 58556, 58560). WHAT TURNS IT RED: the
  query not running on Postgres (a column or enum name); an own outbound invoice written differently (spaces, case) not
  found; an inbound invoice with the number taken for ours.
*/
const gate = integrationDatabaseGate(process.env);

describe(
  "a cmfx-levél mögötti saját számla valódi adatbázison",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now()}`;
    const outbound = `ACRW-IT${suffix}/00001`;
    const inbound = `ACRW-IT${suffix}/00002`;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await prisma.invoice.createMany({
        data: [
          {
            direction: "OUTBOUND",
            source: "UNAS",
            invoiceNumber: ` acrw-it${suffix}/ 00001`,
            partnerName: "Webshop vevő",
          },
          {
            direction: "INBOUND",
            source: "NAV",
            invoiceNumber: inbound,
            partnerName: "Beszállító",
          },
        ],
      });
    });

    after(async () => {
      await prisma.invoice.deleteMany({
        where: {
          partnerName: { in: ["Webshop vevő", "Beszállító"] },
          invoiceNumber: { contains: `IT${suffix}`, mode: "insensitive" },
        },
      });
    });

    it("finds our outbound invoice written differently, with its source, and not an inbound one", async () => {
      assert.deepEqual(
        (await prismaOwnInvoicesByNumber([outbound, inbound])).map((row) => [
          row.invoiceNumber,
          row.source,
        ]),
        [[` acrw-it${suffix}/ 00001`, "UNAS"]],
      );
      assert.deepEqual(await prismaOwnInvoicesByNumber([]), []);
    });
  },
);
