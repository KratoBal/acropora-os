import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";

/**
 * A KÉZI VISSZATÉRÍTÉS-RENDEZÉS NAPLÓSORA ÉS A KÉSEI PÓTLÁS ALAPJA VALÓDI ADATBÁZISON (kártya 4b381c76). MI PIROSÍT: ha a `hasOrderEdit` egy
 * másik rendelés, vagy egy másik művelet sorára igent mond (a pótlás kimaradna, vagy kétszer írna); ha nincs sor, és mégis igent mond;
 * ha a `recordOrderEdit` az `extra` mezőit nem a `before` MELLÉ írja, vagy az `extra` felülírhatja a `before`-t (a rendezés előtti
 * állapot elveszne); ha az `extra` nélküli hívás alakja megváltozik (a régi sorok `{ before }` alakja marad).
 */
const gate = integrationDatabaseGate(process.env);
const ORDER = "order_refund_audit_it";
const OTHER_ORDER = "order_refund_audit_it_other";
const EMAIL = "refund-audit-it@refund-audit-integration.invalid";

describe(
  "the hand refund settlement audit row and its late supplement",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new WebshopOrdersRepository();
    let userId = "";

    async function removeLeftovers() {
      await prisma.auditLog.deleteMany({
        where: { entityId: { in: [ORDER, OTHER_ORDER] } },
      });
      await prisma.user.deleteMany({ where: { email: EMAIL } });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      userId = (
        await prisma.user.create({
          data: {
            email: EMAIL,
            displayName: "Visszatérítés napló teszt",
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
          nev: "AuditLog of the test orders",
          darab: await prisma.auditLog.count({
            where: { entityId: { in: [ORDER, OTHER_ORDER] } },
          }),
        },
        {
          nev: "User by test domain",
          darab: await prisma.user.count({ where: { email: EMAIL } }),
        },
      ]);
    });

    const settledRows = (orderId: string) =>
      prisma.auditLog.findMany({
        where: {
          entityId: orderId,
          action: "webshop-order.manual-refund-settled",
        },
        select: { userId: true, entityType: true, metadata: true },
      });

    it("says no while there is no settlement row, and yes once there is one", async () => {
      assert.equal(
        await repository.hasOrderEdit(ORDER, "manual-refund-settled"),
        false,
      );
      await repository.recordOrderEdit({
        userId,
        orderId: ORDER,
        action: "manual-refund-settled",
        before: { amount: 39100 },
      });
      assert.equal(
        await repository.hasOrderEdit(ORDER, "manual-refund-settled"),
        true,
      );
    });

    it("counts only its own order and its own action", async () => {
      // egy MÁSIK rendelés rendezési sora és ugyanennek a rendelésnek egy MÁS művelete nem számít bele
      assert.equal(
        await repository.hasOrderEdit(OTHER_ORDER, "manual-refund-settled"),
        false,
      );
      await repository.recordOrderEdit({
        userId,
        orderId: OTHER_ORDER,
        action: "notes-edited",
        before: { note: "x" },
      });
      assert.equal(
        await repository.hasOrderEdit(OTHER_ORDER, "manual-refund-settled"),
        false,
      );
    });

    it("a plain row keeps its { before } shape, and the extra fields land beside the before state, never over it", async () => {
      const plain = await settledRows(ORDER);
      assert.equal(plain.length, 1);
      assert.deepEqual(plain[0]!.metadata, { before: { amount: 39100 } });
      assert.equal(plain[0]!.entityType, "WebshopOrder");

      await repository.recordOrderEdit({
        userId,
        orderId: OTHER_ORDER,
        action: "manual-refund-settled",
        before: { amount: 500 },
        // az extra `before` kulcsa a valódi `before`-t nem írhatja felül
        extra: {
          lateRecord: true,
          markerSettledBy: "Első",
          before: "FELÜLÍRNÁ",
        },
      });
      const late = await settledRows(OTHER_ORDER);
      assert.equal(late.length, 1);
      assert.deepEqual(late[0]!.metadata, {
        lateRecord: true,
        markerSettledBy: "Első",
        before: { amount: 500 },
      });
    });
  },
);
