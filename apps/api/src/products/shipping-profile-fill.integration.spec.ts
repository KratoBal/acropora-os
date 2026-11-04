import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ConflictException } from "@nestjs/common";
import { prisma } from "@acropora/database";

import {
  ShippingProfileFillRepository,
  ShippingProfileFillService,
} from "./shipping-profile-fill.service.js";

import { integrationDatabaseGate } from "../common/integration-database.js";

/**
 * THE FILL'S ADMIN ENDPOINT, on a real Postgres (a82ed229; acrobot 42998: no container exec, so an endpoint like the
 * partner migration's). WHAT TURNS THIS RED: a preview that writes; an apply without the preview's fingerprint, or
 * after the plan changed, that writes anyway; an apply that does not write the UNAS rows, or writes no audit row; a
 * second preview that still has work (the fill must be idempotent).
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = `SHIPFILL-${Date.now() % 1_000_000}`;
const ids: Record<string, string> = {};
const service = () =>
  new ShippingProfileFillService(new ShippingProfileFillRepository());

const foxpostDenied = {
  ShippingMethods: {
    Denied: { Method: [{ Name: "Foxpost csomagautomaták" }] },
  },
};

describe(
  "the shipping fill's preview and apply",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await prisma.product.deleteMany({
        where: { name: { startsWith: "SHIPFILL-" } },
      });
      ids.user = (
        await prisma.user.create({
          data: {
            email: `${PREFIX.toLowerCase()}@example.invalid`,
            displayName: PREFIX,
            role: "OWNER",
          },
          select: { id: true },
        })
      ).id;
      for (const key of ["a", "b"]) {
        ids[key] = (
          await prisma.product.create({
            data: { name: `${PREFIX} ${key}`, isActive: true },
            select: { id: true },
          })
        ).id;
        await prisma.unasProductSnapshot.create({
          data: { productId: ids[key]!, rawPayload: foxpostDenied },
        });
      }
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await prisma.auditLog.deleteMany({ where: { userId: ids.user } });
      await prisma.product.deleteMany({
        where: { name: { startsWith: "SHIPFILL-" } },
      });
      await prisma.user.deleteMany({ where: { id: ids.user } });
    });

    const ours = () =>
      prisma.productShippingProfile.findMany({
        where: { productId: { in: [ids.a!, ids.b!] } },
        select: {
          productId: true,
          foxpostForbidden: true,
          foxpostForbiddenSource: true,
        },
      });

    it("the preview writes nothing, and names the target", async () => {
      const preview = await service().preview();
      assert.ok(preview.report.create >= 2);
      assert.match(preview.fingerprint, /^[0-9a-f]{64}$/);
      assert.ok(preview.target.length > 0);
      assert.deepEqual(await ours(), []);
    });

    it("refuses a wrong fingerprint, and a plan that changed after the preview", async () => {
      await assert.rejects(
        () => service().apply("0".repeat(64), ids.user!),
        ConflictException,
      );
      const { fingerprint } = await service().preview();
      // the UNAS data of one product changes before the apply: the plan is another one
      await prisma.unasProductSnapshot.update({
        where: { productId: ids.b! },
        data: { rawPayload: {} },
      });
      await assert.rejects(
        () => service().apply(fingerprint, ids.user!),
        ConflictException,
      );
      assert.deepEqual(await ours(), []);
    });

    it("the preview's fingerprint writes the UNAS rows, with an audit row, and a second preview has no work for them", async () => {
      const { fingerprint } = await service().preview();
      const result = await service().apply(fingerprint, ids.user!);
      assert.ok(result.created >= 2);
      const rows = await ours();
      assert.deepEqual(
        rows
          .map((row) => [
            row.productId === ids.a,
            row.foxpostForbidden,
            row.foxpostForbiddenSource,
          ])
          .sort(),
        [
          [false, false, "UNAS"],
          [true, true, "UNAS"],
        ].sort(),
      );
      assert.equal(
        await prisma.auditLog.count({
          where: {
            userId: ids.user,
            action: "product_shipping_profile.filled",
          },
        }),
        1,
      );
      const again = await service().preview();
      assert.equal(again.report.create, 0);
    });
  },
);
