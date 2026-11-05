import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ProductShippingProfileRepository } from "./product-shipping-profile.repository.js";
import { ProductShippingProfileService } from "./product-shipping-profile.service.js";

/**
 * THE BULK EDIT ON A REAL POSTGRES (a82ed229, 2c). WHAT TURNS THIS RED: a flag not asked for changed; a product with
 * no profile whose untouched flags become MANUAL (the sync would never follow them again) or lose their UNAS value;
 * the snapshot read the database refuses; a missing product stopping the others.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = `SHIPBULK-${Date.now() % 1_000_000}`;
const ids: Record<string, string> = {};

describe("the shipping bulk edit", { skip: gate.mode === "skip" }, () => {
  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await prisma.product.deleteMany({
      where: { name: { startsWith: "SHIPBULK-" } },
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
    for (const key of ["profiled", "unasOnly", "local"])
      ids[key] = (
        await prisma.product.create({
          data: { name: `${PREFIX} ${key}`, isActive: true },
          select: { id: true },
        })
      ).id;
    await prisma.productShippingProfile.create({
      data: {
        productId: ids.profiled!,
        pickupOnly: false,
        foxpostForbidden: false,
        isHeavy: true,
        isFrozen: false,
        pickupOnlySource: "UNAS",
        foxpostForbiddenSource: "UNAS",
        isHeavySource: "UNAS",
        isFrozenSource: "UNAS",
      },
    });
    await prisma.unasProductSnapshot.create({
      data: {
        productId: ids.unasOnly!,
        rawPayload: {
          ShippingMethods: {
            Denied: { Method: [{ Name: "Foxpost csomagautomaták" }] },
          },
        },
      },
    });
  });

  after(async () => {
    if (gate.mode !== "run") return;
    await prisma.auditLog.deleteMany({ where: { userId: ids.user } });
    await prisma.product.deleteMany({
      where: { name: { startsWith: "SHIPBULK-" } },
    });
    await prisma.user.deleteMany({ where: { id: ids.user } });
  });

  it("sets only the asked flag; the untouched ones keep their value and their UNAS source", async () => {
    const service = new ProductShippingProfileService(
      new ProductShippingProfileRepository(),
    );
    const result = await service.bulk(
      [ids.profiled!, ids.unasOnly!, ids.local!, "no-such-product"],
      { lockerUnsuitable: true },
      ids.user!,
    );
    assert.deepEqual(result, { updated: 3, notFound: ["no-such-product"] });
    const rows = await prisma.productShippingProfile.findMany({
      where: { productId: { in: [ids.profiled!, ids.unasOnly!, ids.local!] } },
    });
    const by = new Map(rows.map((row) => [row.productId, row]));
    const profiled = by.get(ids.profiled!)!;
    assert.equal(profiled.lockerUnsuitable, true);
    assert.equal(profiled.isHeavy, true);
    assert.equal(profiled.isHeavySource, "UNAS");
    const unasOnly = by.get(ids.unasOnly!)!;
    assert.equal(unasOnly.lockerUnsuitable, true);
    // the UNAS value, still followed by the sync
    assert.equal(unasOnly.foxpostForbidden, true);
    assert.equal(unasOnly.foxpostForbiddenSource, "UNAS");
    assert.equal(unasOnly.isHeavySource, "UNAS");
    const local = by.get(ids.local!)!;
    assert.equal(local.lockerUnsuitable, true);
    assert.equal(local.isHeavySource, "MANUAL");
  });
});
