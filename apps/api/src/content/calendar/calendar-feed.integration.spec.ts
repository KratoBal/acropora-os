import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";
import type { ContentCalendarEntry } from "@acropora/types";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { CalendarFeedRepository } from "./calendar-feed.repository.js";
import { CalendarFeedService } from "./calendar-feed.service.js";

/*
  THE CALENDAR FEED ON THE DATABASE (T5.5 S1). The range is 2031-05-10..12 (summer time, UTC+2), far from any other
  test's data; the feed reads everything, so each assertion looks only at this file's own rows.

  What turns this red: a discarded item, a cancelled arrival, a received order, an archived product's sale or a sale
  that ended at the range's first instant shown; the last Budapest hour of the last day or the first of the first day
  cut off; an order line's own day ignored; two variants of one sale shown twice; an open order without a day dropped
  silently instead of counted.
*/
const gate = integrationDatabaseGate(process.env);

describe(
  "Content calendar feed, on the database",
  { skip: gate.mode === "skip" },
  () => {
    const tag = `t55-int-${Date.now() % 1_000_000}`;
    const D = (v: string) => new Prisma.Decimal(v);
    const at = (iso: string) => new Date(iso);
    const ids = {
      content: [] as string[],
      arrivals: [] as string[],
      products: [] as string[],
      orders: [] as string[],
      suppliers: [] as string[],
      warehouses: [] as string[],
    };
    const p: Record<string, { id: string; variantId: string }> = {};
    let supplierId = "";
    let warehouseId = "";
    const service = new CalendarFeedService(new CalendarFeedRepository());

    async function product(
      key: string,
      data: Partial<Prisma.ProductUncheckedCreateInput> = {},
      variant: Partial<Prisma.ProductVariantUncheckedCreateInput> = {},
    ) {
      const created = await prisma.product.create({
        data: {
          name: `${tag} ${key}`,
          catalogAuthority: "ACROPORA",
          ...data,
          variants: { create: { sku: `${tag}-${key}`, ...variant } },
        } as Prisma.ProductUncheckedCreateInput,
        select: { id: true, variants: { select: { id: true } } },
      });
      ids.products.push(created.id);
      p[key] = { id: created.id, variantId: created.variants[0]!.id };
      return p[key]!;
    }

    async function order(
      status: "SENT" | "RECEIVED",
      expectedAt: Date | null,
      lines: {
        key: string;
        expectedAt?: Date;
        ordered?: string;
        received?: string;
      }[],
    ) {
      const created = await prisma.purchaseOrder.create({
        data: {
          orderNumber: `${tag}-${ids.orders.length}`,
          supplierId,
          warehouseId,
          status,
          expectedAt,
          lines: {
            create: lines.map((line) => ({
              variantId: p[line.key]!.variantId,
              description: line.key,
              orderedQuantity: D(line.ordered ?? "3"),
              receivedQuantity: D(line.received ?? "0"),
              unit: "db",
              unitNet: D("100"),
              expectedAt: line.expectedAt ?? null,
            })),
          },
        },
        select: { id: true },
      });
      ids.orders.push(created.id);
      return created.id;
    }

    const own = (
      startsAt: string,
      endsAt: string,
    ): Partial<Prisma.ProductVariantUncheckedCreateInput> => ({
      sellingSaleGrossPrice: D("900"),
      sellingSaleStartsAt: at(startsAt),
      sellingSaleEndsAt: at(endsAt),
    });
    const mirror = (startsAt: Date | null, endsAt: Date | null) => ({
      catalogAuthority: "UNAS" as const,
      unasSnapshot: {
        create: {
          rawPayload: {},
          saleGrossPrice: D("900"),
          saleStartsAt: startsAt,
          saleEndsAt: endsAt,
        },
      },
    });

    let datedOrder = "";

    before(async () => {
      supplierId = (
        await prisma.supplier.create({
          data: { code: tag, name: tag },
          select: { id: true },
        })
      ).id;
      ids.suppliers.push(supplierId);
      warehouseId = (
        await prisma.warehouse.create({
          data: { code: tag, name: tag },
          select: { id: true },
        })
      ).id;
      ids.warehouses.push(warehouseId);

      // Budapest 2031-05-10 00:00 .. 2031-05-13 00:00 (UTC+2)
      const window = own("2031-05-09T22:00:00Z", "2031-05-12T22:00:00Z");
      await product("saleA", {}, window);
      await product("saleB", {}, window);
      await product("archived", { archivedAt: new Date() }, window);
      // ended at the range's first instant: the half-open window does not touch the range
      await product(
        "endedAtStart",
        {},
        own("2031-05-01T00:00:00Z", "2031-05-09T22:00:00Z"),
      );
      await product("mirrorOpen", mirror(null, null));
      await product("mirrorEnded", mirror(null, at("2031-05-01T10:00:00Z")));
      await product("lineA");
      await product("lineB");
      await product("lineReceived");

      datedOrder = await order("SENT", at("2031-05-11T08:00:00Z"), [
        { key: "lineA" },
        { key: "lineB", expectedAt: at("2031-05-12T08:00:00Z") },
        { key: "lineReceived", ordered: "2", received: "2" },
      ]);
      await order("RECEIVED", at("2031-05-11T08:00:00Z"), [{ key: "lineA" }]);

      for (const [label, status, expectedOn] of [
        ["ordered", "ORDERED", "2031-05-11"],
        ["cancelled", "CANCELLED", "2031-05-11"],
        ["after", "ORDERED", "2031-05-13"],
      ] as const)
        ids.arrivals.push(
          (
            await prisma.livestockArrival.create({
              data: {
                kind: "FISH",
                label: `${tag} ${label}`,
                status,
                expectedOn: at(`${expectedOn}T00:00:00Z`),
                quantity: 4,
              },
              select: { id: true },
            })
          ).id,
        );

      for (const [title, state, plannedFor] of [
        // Budapest 2031-05-10 00:30: the first hour of the first day
        ["firstHour", "IDEA", "2031-05-09T22:30:00Z"],
        // Budapest 2031-05-12 23:30: the last hour of the last day
        ["lastHour", "DRAFTING", "2031-05-12T21:30:00Z"],
        // Budapest 2031-05-13 00:30: the day after
        ["after", "IDEA", "2031-05-12T22:30:00Z"],
        ["discarded", "DISCARDED", "2031-05-11T10:00:00Z"],
      ] as const)
        ids.content.push(
          (
            await prisma.contentItem.create({
              data: {
                title: `${tag} ${title}`,
                channel: "FACEBOOK_POST",
                state,
                plannedFor: at(plannedFor),
                discardReason: state === "DISCARDED" ? "teszt" : null,
              },
              select: { id: true },
            })
          ).id,
        );
    });

    after(async () => {
      await prisma.purchaseOrder.deleteMany({
        where: { id: { in: ids.orders } },
      });
      await prisma.supplier.deleteMany({
        where: { id: { in: ids.suppliers } },
      });
      await prisma.warehouse.deleteMany({
        where: { id: { in: ids.warehouses } },
      });
      await prisma.livestockArrival.deleteMany({
        where: { id: { in: ids.arrivals } },
      });
      await prisma.contentItem.deleteMany({
        where: { id: { in: ids.content } },
      });
      await prisma.product.deleteMany({ where: { id: { in: ids.products } } });
      nincsMaradek([
        {
          nev: "PurchaseOrder (calendar feed test)",
          darab: await prisma.purchaseOrder.count({
            where: { id: { in: ids.orders } },
          }),
        },
        {
          nev: "LivestockArrival (calendar feed test)",
          darab: await prisma.livestockArrival.count({
            where: { id: { in: ids.arrivals } },
          }),
        },
        {
          nev: "ContentItem (calendar feed test)",
          darab: await prisma.contentItem.count({
            where: { id: { in: ids.content } },
          }),
        },
        {
          nev: "Product (calendar feed test)",
          darab: await prisma.product.count({
            where: { id: { in: ids.products } },
          }),
        },
      ]);
    });

    const ours = (entries: ContentCalendarEntry[]) =>
      entries.filter((entry) => entry.title.includes(tag) || ours.keys(entry));
    ours.keys = (entry: ContentCalendarEntry) =>
      ("products" in entry &&
        entry.products.some((product) => ids.products.includes(product.id))) ||
      ("purchaseOrderId" in entry &&
        ids.orders.includes(entry.purchaseOrderId));

    it("content by its planned Budapest day, both edge hours in, the day after and the discarded out", async () => {
      const feed = await service.feed("2031-05-10", "2031-05-12");
      const content = ours(feed.entries).filter((e) => e.kind === "CONTENT");
      assert.deepEqual(
        content.map((e) => [e.title.replace(`${tag} `, ""), e.startsOn]),
        [
          ["firstHour", "2031-05-10"],
          ["lastHour", "2031-05-12"],
        ],
      );
    });

    it("live arrivals in the range, the cancelled and the later one out", async () => {
      const feed = await service.feed("2031-05-10", "2031-05-12");
      const arrivals = ours(feed.entries).filter(
        (e) => e.kind === "LIVESTOCK_ARRIVAL",
      );
      assert.deepEqual(
        arrivals.map((e) => [e.title.replace(`${tag} `, ""), e.startsOn]),
        [["ordered", "2031-05-11"]],
      );
    });

    it("an open order by each line's day; the received line and the received order out", async () => {
      const feed = await service.feed("2031-05-10", "2031-05-12");
      const purchases = ours(feed.entries).filter(
        (e) => e.kind === "PURCHASE_ARRIVAL",
      );
      assert.deepEqual(
        purchases.map((e) => [
          e.kind === "PURCHASE_ARRIVAL" ? e.purchaseOrderId : "",
          e.startsOn,
          "products" in e ? e.products.map((x) => x.id) : [],
        ]),
        [
          [datedOrder, "2031-05-11", [p.lineA!.id]],
          [datedOrder, "2031-05-12", [p.lineB!.id]],
        ],
      );
    });

    it("one own sale for the two variants of the window, its last day the day before the end; the archived and the ended out; the open mirror sale says so", async () => {
      const feed = await service.feed("2031-05-10", "2031-05-12");
      const sales = ours(feed.entries).filter((e) => e.kind === "SALE");
      const own = sales.filter(
        (e) => e.kind === "SALE" && e.source === "saját",
      );
      assert.equal(own.length, 1);
      assert.equal(own[0]!.startsOn, "2031-05-10");
      assert.equal(own[0]!.endsOn, "2031-05-12");
      assert.deepEqual(
        "products" in own[0]! ? own[0]!.products.map((x) => x.id).sort() : [],
        [p.saleA!.id, p.saleB!.id].sort(),
      );
      const mirrorSales = sales.filter(
        (e) => e.kind === "SALE" && e.source === "UNAS tükör",
      );
      assert.equal(mirrorSales.length, 1);
      const open = mirrorSales[0]!;
      assert.equal(open.startsOn, "ismeretlen");
      assert.equal(open.endsOn, null);
      assert.ok(
        "products" in open &&
          open.products.some((x) => x.id === p.mirrorOpen!.id) &&
          !open.products.some((x) => x.id === p.mirrorEnded!.id),
      );
    });

    it("an open order with no day anywhere is counted, not dropped", async () => {
      const before = (await service.feed("2031-05-10", "2031-05-12")).withoutDay
        .purchaseOrders;
      await order("SENT", null, [{ key: "lineA" }]);
      const afterOne = (await service.feed("2031-05-10", "2031-05-12"))
        .withoutDay.purchaseOrders;
      assert.equal(afterOne, before + 1);
    });
  },
);
