import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import {
  type ParcelReservation,
  WebshopParcelRepository,
} from "./webshop-parcel.repository.js";

// "EGY RENDELESHEZ EGY AKTIV CSOMAG" ADATBAZIS-TULAJDONSAG: a migracio
// reszleges egyedi indexe tartja, amit a Prisma sema nem lat. Egy mockolt
// tar csak azt bizonyitja, hogy a szolgaltatas jo sorrendben kerdez; hogy a
// Postgres ket PARHUZAMOS foglalasbol egyet enged at, azt csak ez meri.
const gate = integrationDatabaseGate(process.env);

// Minden sor, amit ez a csomag ir, ezzel az elotaggal kezdodik: egy
// felbeszakadt futas maradeka a kovetkezo elejen is eltakarithato.
const PREFIX = "parcel-integration-";

describe(
  "WebshopParcelRepository integration",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new WebshopParcelRepository();
    const suffix = Date.now();
    const reservation = (order: string): ParcelReservation => ({
      commerceOrderId: `${PREFIX}${order}-${suffix}`,
      carrier: "foxpost",
      reference: "1042",
      size: "s",
      codHuf: null,
      createdByUserId: null,
    });

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "the suite's parcels survived the cleanup",
          darab: await prisma.webshopParcel.count({
            where: { commerceOrderId: { startsWith: PREFIX } },
          }),
        },
      ]);
    });

    async function removeLeftovers() {
      await prisma.webshopParcel.deleteMany({
        where: { commerceOrderId: { startsWith: PREFIX } },
      });
    }

    it("lets one of two CONCURRENT reservations through, and answers the other with null", async () => {
      const order = reservation("parhuzamos");
      const results = await Promise.all([
        repository.reserve(order),
        repository.reserve(order),
      ]);

      assert.equal(results.filter((row) => row !== null).length, 1);
      assert.equal(results.filter((row) => row === null).length, 1);
      assert.equal(
        await prisma.webshopParcel.count({
          where: { commerceOrderId: order.commerceOrderId, status: "ACTIVE" },
        }),
        1,
      );
    });

    it("refuses a second reservation after the parcel is confirmed", async () => {
      const order = reservation("megerositett");
      const row = await repository.reserve(order);
      assert.ok(row);
      await repository.confirm(row.id, {
        parcelNumber: `STUB-FOXPOST-${suffix}`,
      });
      assert.equal(await repository.reserve(order), null);
    });

    it("a cancelled parcel frees the order, and its row stays for the record", async () => {
      const order = reservation("lemondott");
      const row = await repository.reserve(order);
      assert.ok(row);
      await repository.confirm(row.id, {
        parcelNumber: `STUB-FOXPOST-L${suffix}`,
      });
      assert.equal(await repository.markCancelled(row.id), true);
      assert.equal(
        await repository.markCancelled(row.id),
        false,
        "a second cancel writes nothing",
      );

      const next = await repository.reserve(order);
      assert.ok(next);
      assert.equal(
        await prisma.webshopParcel.count({
          where: { commerceOrderId: order.commerceOrderId },
        }),
        2,
      );
    });

    it("drops only an unconfirmed reservation", async () => {
      const order = reservation("eldobott");
      const row = await repository.reserve(order);
      assert.ok(row);
      await repository.confirm(row.id, {
        parcelNumber: `STUB-FOXPOST-E${suffix}`,
      });
      await repository.dropReservation(row.id);
      assert.ok(
        await repository.findActive(order.commerceOrderId),
        "a confirmed parcel is not dropped",
      );

      const other = reservation("eldobott-2");
      const pending = await repository.reserve(other);
      assert.ok(pending);
      await repository.dropReservation(pending.id);
      assert.equal(await repository.findActive(other.commerceOrderId), null);
    });

    it("releases an unconfirmed reservation only when it is older than the given moment", async () => {
      const order = reservation("feloldas");
      const row = await repository.reserve(order);
      assert.ok(row);
      const before = new Date(row.createdAt.getTime() - 1);
      assert.equal(
        await repository.markCancelled(row.id, {
          unconfirmedOnly: true,
          olderThan: before,
        }),
        false,
      );
      const later = new Date(row.createdAt.getTime() + 1);
      assert.equal(
        await repository.markCancelled(row.id, {
          unconfirmedOnly: true,
          olderThan: later,
        }),
        true,
      );
    });

    it("lists only the active parcels of the asked orders", async () => {
      const a = reservation("lista-a");
      const b = reservation("lista-b");
      const rowA = await repository.reserve(a);
      const rowB = await repository.reserve(b);
      assert.ok(rowA && rowB);
      await repository.markCancelled(rowB.id);

      const rows = await repository.findActiveMany([
        a.commerceOrderId,
        b.commerceOrderId,
        `${PREFIX}nincs-${suffix}`,
      ]);
      assert.deepEqual(
        rows.map((row) => row.commerceOrderId),
        [a.commerceOrderId],
      );
      assert.deepEqual(await repository.findActiveMany([]), []);
    });
  },
);
