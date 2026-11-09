import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { WebshopInvoiceRepository } from "./webshop-invoice.repository.js";

/**
 * A VENDÉG SZÁMLA-LETÖLTÉSÉNEK TÁROLÓJA VALÓDI POSTGRESEN. MI PIROSÍT: ha a token beváltása nem egyedi (a második használat
 * átmegy); ha a beváltás nem hagy naplót (esemény) vagy a napló nem a tokenhez tartozik; ha egy másik rendelés számlája
 * kijön egy rendelés keresésén; ha a sztornózott számla nem derül ki; ha a bizonylat-keresés bejövő vagy nem webshopos sort ad.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "WINV-";

async function removeLeftovers() {
  const invoices = await prisma.invoice.findMany({
    where: { sourceId: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = invoices.map((row) => row.id);
  // a sztornó hivatkozik az eredetire: előbb a hivatkozók
  await prisma.invoice.deleteMany({
    where: { id: { in: ids }, referencedInvoiceId: { not: null } },
  });
  await prisma.invoice.deleteMany({ where: { id: { in: ids } } });
  await prisma.webshopInvoiceDownload.deleteMany({
    where: { orderId: { startsWith: PREFIX } },
  });
  await prisma.domainEvent.deleteMany({
    where: {
      eventType: "webshop.invoice.downloaded",
      aggregateId: { startsWith: PREFIX },
    },
  });
}

describe(
  "the guest invoice download's store, on a real database",
  { skip: gate.mode === "skip" },
  () => {
    const n = Date.now() % 1_000_000;
    const orderA = `${PREFIX}A-${n}`;
    const orderB = `${PREFIX}B-${n}`;
    const repository = new WebshopInvoiceRepository();
    const ids: Record<string, string> = {};

    const create = (orderId: string, over: Record<string, unknown> = {}) =>
      prisma.invoice.create({
        data: {
          direction: "OUTBOUND",
          source: "SZAMLAZZ",
          documentType: "INVOICE",
          status: "ISSUED",
          partnerName: `${PREFIX} Kitalált Kft.`,
          sourceType: "WEBSHOP_ORDER",
          sourceId: orderId,
          pdfStorageKey: "k",
          ...over,
        } as never,
        select: { id: true },
      });

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      ids.a1 = (await create(orderA)).id;
      ids.a2 = (await create(orderA)).id;
      ids.b1 = (await create(orderB)).id;
      // a sztornó az A rendelés első számlájára hivatkozik
      ids.storno = (
        await create(orderA, {
          documentType: "STORNO",
          referencedInvoiceId: ids.a1,
        })
      ).id;
      // egy másik típusú forrás ugyanazzal a sourceId-val nem a webshopé
      await create(orderA, { sourceType: "CONTRACT" });
    });
    after(async () => {
      if (gate.mode === "run") await removeLeftovers();
    });

    it("finds only the webshop order's own documents, and tells the stornoed one", async () => {
      const found = await repository.candidatesOf(orderA);
      assert.equal(found.length, 3);
      assert.deepEqual(
        found.map((row) => row.id).sort(),
        [ids.a1, ids.a2, ids.storno].sort(),
      );
      const stornoed = await repository.stornoedAmong(found.map((r) => r.id));
      assert.deepEqual([...stornoed], [ids.a1]);
      assert.equal((await repository.candidatesOf(orderB)).length, 1);
    });

    it("a document is found for its own order only", async () => {
      assert.ok(await repository.candidate(ids.a1!, orderA));
      assert.equal(await repository.candidate(ids.a1!, orderB), null);
      assert.equal(await repository.candidate(ids.b1!, orderA), null);
    });

    it("redeems a token once: the second try is false, and the first left one log event", async () => {
      const jti = `${PREFIX}jti-${n}`;
      assert.equal(await repository.redeem(jti, orderA, ids.a2!), true);
      assert.equal(await repository.redeem(jti, orderA, ids.a2!), false);
      const rows = await prisma.webshopInvoiceDownload.findMany({
        where: { jti },
      });
      assert.equal(rows.length, 1);
      const events = await prisma.domainEvent.findMany({
        where: { eventType: "webshop.invoice.downloaded", aggregateId: orderA },
      });
      assert.equal(events.length, 1);
      assert.deepEqual(events[0]!.payload, { invoiceId: ids.a2, jti });
    });
  },
);
