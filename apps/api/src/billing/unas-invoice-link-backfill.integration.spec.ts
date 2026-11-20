import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { prismaInvoiceLinkStore as store } from "./unas-invoice-link-backfill.cli.js";

/*
  THE INVOICE LINK STORE ON THE REAL DATABASE (785dfea6). WHAT TURNS IT RED: a link written over an existing one; a second row for
  the same (source, number) instead of `false`; the new row not OUTBOUND/UNAS/RECEIVED or not tied to the local order; an order
  deleted in UNAS still taken as the local order; a local order found by neither the stable Id nor the legacy Key.
*/
const gate = integrationDatabaseGate(process.env);

describe(
  "a UNAS számlalink-visszaolvasó tára valódi adatbázison",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now()}`;
    const number = (n: string) => `ULB-${suffix}/${n}`;
    let liveOrder = "";
    let deletedOrder = "";
    let legacyOrder = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      const make = async (name: string, deleted = false) =>
        (
          await prisma.salesOrder.create({
            data: {
              orderNumber: `ULB-${suffix}-${name}`,
              channel: "UNAS",
              ...(deleted ? { unasDeletedAt: new Date() } : {}),
            },
          })
        ).id;
      liveOrder = await make("live");
      deletedOrder = await make("deleted", true);
      legacyOrder = await make("legacy");
      await prisma.externalReference.createMany({
        data: [
          {
            system: "UNAS",
            entityType: "SalesOrder",
            entityId: liveOrder,
            externalId: `ulb-id-${suffix}-live`,
          },
          {
            system: "UNAS",
            entityType: "SalesOrder",
            entityId: deletedOrder,
            externalId: `ulb-id-${suffix}-deleted`,
          },
          // a row from before the Id/Key split: its externalId is the Key
          {
            system: "UNAS",
            entityType: "SalesOrder",
            entityId: legacyOrder,
            externalId: `ulb-key-${suffix}-legacy`,
          },
        ],
      });
      await prisma.invoice.createMany({
        data: [
          {
            direction: "OUTBOUND",
            source: "UNAS",
            invoiceNumber: number("with-url"),
            partnerName: "ULB",
            externalUrl: "https://www.cmfx.hu/regi",
          },
          {
            direction: "OUTBOUND",
            source: "UNAS",
            invoiceNumber: number("no-url"),
            partnerName: "ULB",
          },
        ],
      });
    });

    after(async () => {
      await prisma.invoice.deleteMany({
        where: { invoiceNumber: { startsWith: `ULB-${suffix}/` } },
      });
      await prisma.externalReference.deleteMany({
        where: { entityId: { in: [liveOrder, deletedOrder, legacyOrder] } },
      });
      await prisma.salesOrder.deleteMany({
        where: { orderNumber: { startsWith: `ULB-${suffix}-` } },
      });
    });

    it("finds the local order by the Id, then by the legacy Key, and not a deleted one", async () => {
      assert.deepEqual(
        [
          await store.localOrderId({ id: `ulb-id-${suffix}-live`, key: "x" }),
          await store.localOrderId({
            id: "nincs",
            key: `ulb-key-${suffix}-legacy`,
          }),
          await store.localOrderId({
            id: `ulb-id-${suffix}-deleted`,
            key: "x",
          }),
          await store.localOrderId({ id: null, key: "nincs" }),
        ],
        [liveOrder, legacyOrder, null, null],
      );
    });

    it("writes a link only where it is empty, and says whether it did", async () => {
      assert.deepEqual(
        [
          await store.existing(number("with-url")),
          await store.existing(number("no-url")),
          await store.existing(number("missing")),
        ],
        [{ hasUrl: true }, { hasUrl: false }, null],
      );
      assert.equal(
        await store.setUrlIfEmpty(number("with-url"), "https://www.cmfx.hu/uj"),
        false,
      );
      assert.equal(
        await store.setUrlIfEmpty(number("no-url"), "https://www.cmfx.hu/uj"),
        true,
      );
      assert.equal(
        await store.setUrlIfEmpty(
          number("no-url"),
          "https://www.cmfx.hu/masik",
        ),
        false,
      );
      const urls = await prisma.invoice.findMany({
        where: {
          invoiceNumber: { in: [number("with-url"), number("no-url")] },
        },
        select: { invoiceNumber: true, externalUrl: true },
        orderBy: { invoiceNumber: "asc" },
      });
      assert.deepEqual(
        urls.map((row) => [row.invoiceNumber, row.externalUrl]),
        [
          [number("no-url"), "https://www.cmfx.hu/uj"],
          [number("with-url"), "https://www.cmfx.hu/regi"],
        ],
      );
    });

    it("creates the row as the order sync would, tied to the local order, and a second create is false", async () => {
      const input = {
        number: number("new"),
        url: "https://www.cmfx.hu/x",
        salesOrderId: liveOrder,
        partnerName: "Vevő",
        partnerTaxNumber: null,
        currency: "HUF",
      };
      assert.equal(await store.create(input), true);
      assert.equal(
        await store.create({ ...input, url: "https://www.cmfx.hu/y" }),
        false,
      );
      const row = await prisma.invoice.findFirstOrThrow({
        where: { invoiceNumber: number("new") },
        select: {
          direction: true,
          documentType: true,
          source: true,
          syncStatus: true,
          salesOrderId: true,
          externalUrl: true,
        },
      });
      assert.deepEqual(row, {
        direction: "OUTBOUND",
        documentType: "INVOICE",
        source: "UNAS",
        syncStatus: "RECEIVED",
        salesOrderId: liveOrder,
        externalUrl: "https://www.cmfx.hu/x",
      });
      assert.equal(
        await prisma.invoice.count({ where: { invoiceNumber: number("new") } }),
        1,
      );
    });
  },
);
