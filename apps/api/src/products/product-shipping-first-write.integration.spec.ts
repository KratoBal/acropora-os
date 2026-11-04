import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ProductShippingProfileRepository } from "./product-shipping-profile.repository.js";

/**
 * THE FIRST SAVE OF A PRODUCT WITHOUT A SHIPPING PROFILE, on a real Postgres (barracuda, #2198 a). WHAT TURNS THIS
 * RED: the snapshot read the database refuses (a select with a made-up field compiles); the first save freezing a
 * flag that matches UNAS as MANUAL, so the sync never follows it again; a product without UNAS data getting a UNAS
 * source.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = `SHIPFIRST-${Date.now() % 1_000_000}`;
const ids: Record<string, string> = {};
const flags = {
  pickupOnly: false,
  foxpostForbidden: false,
  isHeavy: false,
  isFrozen: false,
};

describe(
  "the first shipping save measures against the product's UNAS data",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await prisma.product.deleteMany({
        where: { name: { startsWith: "SHIPFIRST-" } },
      });
      ids.user = (
        await prisma.user
          .findFirstOrThrow({ select: { id: true } })
          .catch(async () =>
            prisma.user.create({
              data: {
                email: `${PREFIX.toLowerCase()}@example.invalid`,
                displayName: PREFIX,
                role: "OWNER",
              },
              select: { id: true },
            }),
          )
      ).id;
      for (const key of ["unas", "local"])
        ids[key] = (
          await prisma.product.create({
            data: { name: `${PREFIX} ${key}`, isActive: true },
            select: { id: true },
          })
        ).id;
      // UNAS denies Foxpost on this one
      await prisma.unasProductSnapshot.create({
        data: {
          productId: ids.unas!,
          rawPayload: {
            ShippingMethods: {
              Denied: { Method: [{ Name: "Foxpost csomagautomaták" }] },
            },
          },
        },
      });
    });

    after(async () => {
      if (gate.mode === "run")
        await prisma.product.deleteMany({
          where: { name: { startsWith: "SHIPFIRST-" } },
        });
    });

    it("only the parcel-locker flag switched on: the four UNAS flags keep following UNAS", async () => {
      const repository = new ProductShippingProfileRepository();
      const detail = await repository.upsert(
        ids.unas!,
        { ...flags, foxpostForbidden: true, lockerUnsuitable: true },
        ids.user!,
      );
      assert.deepEqual(detail.sources, {
        pickupOnly: "UNAS",
        foxpostForbidden: "UNAS",
        isHeavy: "UNAS",
        isFrozen: "UNAS",
      });
      assert.equal(detail.lockerUnsuitable, true);
    });

    it("a product with no UNAS data: the first save is all by hand", async () => {
      const detail = await new ProductShippingProfileRepository().upsert(
        ids.local!,
        { ...flags, isHeavy: true },
        ids.user!,
      );
      assert.deepEqual(detail.sources, {
        pickupOnly: "MANUAL",
        foxpostForbidden: "MANUAL",
        isHeavy: "MANUAL",
        isFrozen: "MANUAL",
      });
    });
  },
);
