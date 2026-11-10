import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import {
  LivestockArrivalsRepository,
  type LivestockArrivalWrite,
} from "./livestock-arrivals.repository.js";

/**
 * THE CONDITIONAL WRITE STANDS ON TWO DATABASE FACTS THAT A UNIT TEST CANNOT SEE (barracuda, #2269 review, 2026-11-06).
 *
 * `update()` writes with `where: { id, updatedAt: <the time the service read> }`. That protects only if (1) `updateMany` moves
 * the `@updatedAt` column by itself, otherwise the second write finds the row unchanged and nothing is refused, and (2) the
 * `TIMESTAMP(3)` the database stores and the JavaScript `Date` made from the ISO string agree to the millisecond, otherwise
 * even the first honest write matches no row. The service spec uses a repository double and proves neither.
 *
 * WHAT TURNS THIS RED: an update that leaves `updatedAt` where it was (the stale write would then be accepted); an
 * `updatedAt` read back and sent again that matches no row (every honest edit refused); two writes from one read that both
 * land (the lost update this exists to stop); a missing row answered "changed" instead of null.
 */
const gate = integrationDatabaseGate(process.env);

describe(
  "LivestockArrivalsRepository integration",
  { skip: gate.mode === "skip" },
  () => {
    const PREFIX = `LA-INT-${Date.now() % 1_000_000}`;
    const repository = new LivestockArrivalsRepository();

    const data = (label: string): LivestockArrivalWrite => ({
      kind: "FISH",
      label: `${PREFIX} ${label}`,
      productId: null,
      expectedOn: "2026-12-01",
      quantity: 4,
      status: "ORDERED",
      preorderable: false,
      note: null,
    });

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
    });

    after(removeLeftovers);

    async function removeLeftovers() {
      await prisma.livestockArrival.deleteMany({
        where: { label: { startsWith: PREFIX } },
      });
      await prisma.product.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      nincsMaradek([
        {
          nev: "LivestockArrival",
          darab: await prisma.livestockArrival.count({
            where: { label: { startsWith: PREFIX } },
          }),
        },
      ]);
    }

    /** A new arrival, and the moment its row was last written, read back the way the service reads it. */
    async function created(label: string) {
      const arrival = await repository.create(data(label), null);
      // the clock of the database column is a millisecond: the next write must be later than this one
      await sleep(20);
      return arrival;
    }

    it("a write with the time that was read lands, moves updatedAt, and the next write with the OLD time is refused", async () => {
      const first = await created("sequence");
      const readAt = first.updatedAt;

      const landed = await repository.update(
        first.id,
        data("sequence second"),
        readAt,
      );
      assert.notEqual(landed, "changed");
      assert.notEqual(landed, null);
      if (landed === "changed" || landed === null) return;
      assert.ok(
        new Date(landed.updatedAt).getTime() > new Date(readAt).getTime(),
        "updateMany did not move updatedAt",
      );

      const stale = await repository.update(
        first.id,
        data("sequence stale"),
        readAt,
      );
      assert.equal(stale, "changed");
      assert.equal(
        (await repository.get(first.id))?.label,
        `${PREFIX} sequence second`,
        "the refused write changed the row",
      );

      await sleep(20);
      const fresh = await repository.update(
        first.id,
        data("sequence third"),
        landed.updatedAt,
      );
      assert.notEqual(fresh, "changed");
      assert.equal(
        (fresh as { label: string } | null)?.label,
        `${PREFIX} sequence third`,
      );
    });

    it("two writes made from the same read: exactly one lands, the other is refused", async () => {
      const first = await created("race");
      const results = await Promise.all([
        repository.update(first.id, data("race a"), first.updatedAt),
        repository.update(first.id, data("race b"), first.updatedAt),
      ]);
      assert.equal(results.filter((result) => result === "changed").length, 1);
      const winner = results.find((result) => result !== "changed");
      assert.ok(winner && winner !== null);
      assert.equal(
        (await repository.get(first.id))?.label,
        (winner as { label: string }).label,
      );
    });

    it("a row that does not exist is null, not changed", async () => {
      const result = await repository.update(
        "no-such-arrival",
        data("ghost"),
        new Date().toISOString(),
      );
      assert.equal(result, null);
    });

    /*
      THE PRODUCT MOVES WITH ITS ARRIVAL (V2.6 S3a). The shop's `livestock_arrival` key is projected from the arrival, and the
      projection picks the products to send from the most recently updated ones: an arrival that changes on a product nobody else
      touched would never be picked. WHAT TURNS THIS RED: a write that leaves the product's `updatedAt` where it was (the key
      would reach the shop only by luck); a re-link that moves only the new product (the old product's page keeps an arrival it no
      longer has); a REFUSED write moving a product it did not change; an arrival with no product failing the write.
    */
    describe("the product's updatedAt moves with its arrival", () => {
      const product = (label: string) =>
        prisma.product.create({
          data: { name: `${PREFIX} ${label}` },
          select: { id: true, updatedAt: true },
        });
      const updatedAtOf = async (id: string) =>
        (
          await prisma.product.findUniqueOrThrow({
            where: { id },
            select: { updatedAt: true },
          })
        ).updatedAt.getTime();

      it("creating an arrival linked to a product moves that product only", async () => {
        const linked = await product("linked");
        const other = await product("other");
        await sleep(20);
        await repository.create(
          { ...data("on a product"), productId: linked.id },
          null,
        );
        assert.ok((await updatedAtOf(linked.id)) > linked.updatedAt.getTime());
        assert.equal(await updatedAtOf(other.id), other.updatedAt.getTime());
      });

      it("re-linking an arrival moves the old product and the new one, and no third", async () => {
        const first = await product("first");
        const second = await product("second");
        const bystander = await product("bystander");
        const arrival = await repository.create(
          { ...data("moves"), productId: first.id },
          null,
        );
        await sleep(20);
        const firstBefore = await updatedAtOf(first.id);
        const secondBefore = await updatedAtOf(second.id);
        const result = await repository.update(
          arrival.id,
          { ...data("moves"), productId: second.id },
          arrival.updatedAt,
        );
        assert.ok(result && result !== "changed");
        assert.ok((await updatedAtOf(first.id)) > firstBefore);
        assert.ok((await updatedAtOf(second.id)) > secondBefore);
        assert.equal(
          await updatedAtOf(bystander.id),
          bystander.updatedAt.getTime(),
        );
      });

      it("taking the link off moves the product it stood on", async () => {
        const stood = await product("stood");
        const arrival = await repository.create(
          { ...data("unlinked"), productId: stood.id },
          null,
        );
        await sleep(20);
        const before = await updatedAtOf(stood.id);
        const result = await repository.update(
          arrival.id,
          { ...data("unlinked"), productId: null },
          arrival.updatedAt,
        );
        assert.ok(result && result !== "changed");
        assert.ok((await updatedAtOf(stood.id)) > before);
      });

      it("a refused write moves nothing, and an arrival with no product writes fine", async () => {
        const stays = await product("stays");
        const arrival = await repository.create(
          { ...data("refused"), productId: stays.id },
          null,
        );
        await sleep(20);
        const before = await updatedAtOf(stays.id);
        const refused = await repository.update(
          arrival.id,
          { ...data("refused"), productId: stays.id },
          "2020-01-01T00:00:00.000Z",
        );
        assert.equal(refused, "changed");
        assert.equal(await updatedAtOf(stays.id), before);
        const free = await repository.create(data("no product"), null);
        assert.equal(free.productId, null);
      });
    });
  },
);
