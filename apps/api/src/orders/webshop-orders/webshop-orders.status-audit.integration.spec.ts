import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import { PERSONAL_DELIVERY_REASON } from "@acropora/types";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";

/**
 * A STÁTUSZVÁLTÁS NAPLÓJA ÉS A KISZÁLLÍTÁSI KAPU FELÜLBÍRÁLÁSÁNAK NAPLÓJA VALÓDI ADATBÁZISON (kártya 33a0d3c7). MI PIROSÍT: ha a sima váltás
 * bármi mást ír, mint az eddigi egy sort; ha a felülbírálás nem külön, szűrhető sor (külön `action`) az indokkal, a hiányzó résszel és az
 * állapotokkal; ha a váltás sora a felülbírálásnál megváltozik (az alakja a régi marad); ha a két sor nem ugyanahhoz a felhasználóhoz és
 * rendeléshez tartozik.
 */
const gate = integrationDatabaseGate(process.env);
const ORDER = "order_status_audit_it";
const EMAIL = "status-audit-it@status-audit-integration.invalid";

describe(
  "the order status audit and the shipping gate override",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new WebshopOrdersRepository();
    let userId = "";

    async function removeLeftovers() {
      await prisma.auditLog.deleteMany({ where: { entityId: ORDER } });
      await prisma.user.deleteMany({ where: { email: EMAIL } });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      userId = (
        await prisma.user.create({
          data: {
            email: EMAIL,
            displayName: "Státusz napló teszt",
            role: "OWNER",
            isActive: true,
          },
        })
      ).id;
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "AuditLog of the test order",
          darab: await prisma.auditLog.count({ where: { entityId: ORDER } }),
        },
        {
          nev: "User by test domain",
          darab: await prisma.user.count({ where: { email: EMAIL } }),
        },
      ]);
    });

    const rows = () =>
      prisma.auditLog.findMany({
        where: { entityId: ORDER },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          userId: true,
          action: true,
          entityType: true,
          metadata: true,
        },
      });

    it("a plain change writes exactly the one status row it always did", async () => {
      await repository.recordStatusChange({
        userId,
        orderId: ORDER,
        from: "confirmed",
        to: "stocking",
      });
      assert.deepEqual(await rows(), [
        {
          userId,
          action: "webshop-order.status-changed",
          entityType: "WebshopOrder",
          metadata: { from: "confirmed", to: "stocking" },
        },
      ]);
      await prisma.auditLog.deleteMany({ where: { entityId: ORDER } });
    });

    it("an overridden shipping gate has its own row: requested before the webshop call, applied after it, and the status row keeps its shape", async () => {
      const trace = {
        userId,
        orderId: ORDER,
        from: "stocking",
        to: "out_for_delivery",
        reason: "A csomagot a GLS portálján adtuk fel kézzel",
        missing: ["kiállított számla", "feladott csomag"],
      };
      const rowId = await repository.requestShippingOverride(trace);
      // an attempt the webshop refused: only the requested row exists
      const attempt = await rows();
      assert.equal(attempt.length, 1);
      assert.equal(
        attempt[0]!.action,
        "webshop-order.shipping-gate-overridden",
      );
      assert.deepEqual(attempt[0]!.metadata, {
        status: "requested",
        from: "stocking",
        to: "out_for_delivery",
        reason: "A csomagot a GLS portálján adtuk fel kézzel",
        missing: ["kiállított számla", "feladott csomag"],
      });
      await repository.markShippingOverrideApplied(rowId, trace);
      await repository.recordStatusChange({
        userId,
        orderId: ORDER,
        from: "stocking",
        to: "out_for_delivery",
      });
      const written = await rows();
      assert.equal(written.length, 2);
      const byAction = Object.fromEntries(
        written.map((row) => [row.action, row]),
      );
      assert.deepEqual(byAction["webshop-order.status-changed"]!.metadata, {
        from: "stocking",
        to: "out_for_delivery",
      });
      assert.deepEqual(
        byAction["webshop-order.shipping-gate-overridden"]!.metadata,
        {
          status: "applied",
          from: "stocking",
          to: "out_for_delivery",
          reason: "A csomagot a GLS portálján adtuk fel kézzel",
          missing: ["kiállított számla", "feladott csomag"],
        },
      );
      assert.ok(
        written.every(
          (row) => row.userId === userId && row.entityType === "WebshopOrder",
        ),
      );
    });

    it("a personal delivery has its own action, apart from the override: requested before the webshop call, applied after, with the constant reason", async () => {
      const trace = {
        kind: "personal" as const,
        userId,
        orderId: ORDER,
        from: "stocking",
        to: "out_for_delivery",
        reason: PERSONAL_DELIVERY_REASON,
        missing: ["feladott csomag"],
      };
      // the previous case leaves its two rows: this one starts from a clean order
      await prisma.auditLog.deleteMany({ where: { entityId: ORDER } });
      const rowId = await repository.requestShippingOverride(trace);
      const attempt = await rows();
      assert.equal(attempt.length, 1);
      assert.equal(attempt[0]!.action, "webshop-order.personal-delivery");
      assert.deepEqual(attempt[0]!.metadata, {
        status: "requested",
        from: "stocking",
        to: "out_for_delivery",
        reason: PERSONAL_DELIVERY_REASON,
        missing: ["feladott csomag"],
      });
      await repository.markShippingOverrideApplied(rowId, trace);
      const applied = await rows();
      assert.equal(applied.length, 1);
      assert.equal(applied[0]!.action, "webshop-order.personal-delivery");
      assert.deepEqual(
        (applied[0]!.metadata as { status: string }).status,
        "applied",
      );
      assert.ok(
        applied.every(
          (row) => row.userId === userId && row.entityType === "WebshopOrder",
        ),
      );
    });
  },
);
