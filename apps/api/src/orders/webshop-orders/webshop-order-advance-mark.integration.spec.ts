import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { WEBSHOP_ADVANCE_TAG } from "./webshop-order-invoice.rules.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";

/*
  AZ ELŐLEG-JELÖLŐ A BIZONYLATON, VALÓDI ADATBÁZISON (kártya 2c5fbfb5; barracuda a #2839-en). MI PIROSÍT: a vázlat nem kapja meg vagy
  nem veszíti el a jelölőt; a többi címke elvész; egy KIÁLLÍTOTT díjbekérő jelölője megváltozik; a beérkezés díjbekérőjének
  jelölőjét a tár nem látja (a webshop akkor nem kapná meg az előleg-jelölést); a változatlan jelölő is ír (a vázlat `updatedAt`-je
  elmozdul, és a kiállítás 409-cel áll meg: a #2844 regressziója), vagy a tár nem mondja meg, hogy írt.
*/
const gate = integrationDatabaseGate(process.env);
const ORDER = "order_itadvmark_";

async function removeLeftovers() {
  await prisma.webshopTransferReceipt.deleteMany({
    where: { orderId: { startsWith: ORDER } },
  });
  await prisma.invoice.deleteMany({
    where: { sourceId: { startsWith: ORDER } },
  });
}

const proforma = (n: number, status: "DRAFT" | "ISSUED", tags: string[]) =>
  prisma.invoice.create({
    data: {
      direction: "OUTBOUND",
      source: "MANUAL",
      partnerName: "Kitalalt Vevo",
      documentType: "PROFORMA",
      status,
      sourceType: "WEBSHOP_ORDER",
      sourceId: `${ORDER}${n}`,
      grossAmount: new Prisma.Decimal("1600"),
      currency: "HUF",
      tags,
    },
  });

describe(
  "the advance mark on the proforma",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new WebshopOrdersRepository();

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
    });

    it("a draft is marked and unmarked, its other tags kept; an issued one is not changed", async () => {
      const draft = await proforma(1, "DRAFT", ["mas"]);
      assert.equal(await repository.markProformaAdvance(draft.id, true), true);
      assert.deepEqual(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } }))
          .tags,
        ["mas", WEBSHOP_ADVANCE_TAG],
      );
      assert.equal(await repository.markProformaAdvance(draft.id, false), true);
      assert.deepEqual(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } }))
          .tags,
        ["mas"],
      );
      const issued = await proforma(2, "ISSUED", [WEBSHOP_ADVANCE_TAG]);
      assert.equal(
        await repository.markProformaAdvance(issued.id, false),
        false,
      );
      assert.deepEqual(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: issued.id } }))
          .tags,
        [WEBSHOP_ADVANCE_TAG],
      );
    });

    it("an unchanged mark writes nothing, so the draft's `updatedAt` stays what the issue was given", async () => {
      const draft = await proforma(5, "DRAFT", [WEBSHOP_ADVANCE_TAG]);
      assert.equal(await repository.markProformaAdvance(draft.id, true), false);
      const plain = await proforma(6, "DRAFT", []);
      assert.equal(
        await repository.markProformaAdvance(plain.id, false),
        false,
      );
      for (const before of [draft, plain])
        assert.deepEqual(
          (
            await prisma.invoice.findUniqueOrThrow({
              where: { id: before.id },
            })
          ).updatedAt,
          before.updatedAt,
        );
    });

    it("the receipt's proforma tells whether the transfer paid an advance", async () => {
      const advance = await proforma(3, "ISSUED", [WEBSHOP_ADVANCE_TAG]);
      const full = await proforma(4, "ISSUED", []);
      for (const [n, invoice] of [
        [3, advance],
        [4, full],
      ] as const)
        await prisma.webshopTransferReceipt.create({
          data: {
            orderId: `${ORDER}${n}`,
            proformaId: invoice.id,
            source: "MANUAL",
            reference: `IT-${n}`,
            receivedOn: new Date("2026-11-25T00:00:00Z"),
            amount: new Prisma.Decimal("1600"),
            currency: "HUF",
          },
        });
      assert.equal(
        await repository.receiptProformaIsAdvance(`${ORDER}3`),
        true,
      );
      assert.equal(
        await repository.receiptProformaIsAdvance(`${ORDER}4`),
        false,
      );
      assert.equal(
        await repository.receiptProformaIsAdvance(`${ORDER}9`),
        false,
      );
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "Invoice by sourceId prefix",
          darab: await prisma.invoice.count({
            where: { sourceId: { startsWith: ORDER } },
          }),
        },
        {
          nev: "WebshopTransferReceipt by orderId prefix",
          darab: await prisma.webshopTransferReceipt.count({
            where: { orderId: { startsWith: ORDER } },
          }),
        },
      ]);
    });
  },
);
