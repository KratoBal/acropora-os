// A DTO-t a szolgáltatás importálja; a dekorátorok a `Reflect` metaadatot várják.
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProductShippingProfileService } from "./product-shipping-profile.service.js";
import { runShippingBulk } from "./shipping-profile-bulk.js";
import { shippingSummary, shippingWhere } from "./shipping-list-filter.js";
import {
  bulkShippingRow,
  type StoredShippingProfile,
} from "./shipping-profile-sources.js";

/**
 * A SZÁLLÍTÁSI JELZŐK A LISTÁBAN (a82ed229, 2a): szűrő, oszlop, tömeges
 * szerkesztés. MI PIROSÍT: a „korlátozás nélküli” a sor nélkülit is hozza; az
 * eltérés-szűrő nem szűkít; a tömeges szerkesztés a meg nem nevezett jelzőt is
 * írja; egy UNAS-ból egyező érték nem lesz kézi, holott kifejezetten megnevezték;
 * a hiányzó termék elnyelődik.
 */
const sor = (
  over: Partial<StoredShippingProfile> = {},
): StoredShippingProfile & {
  lockerUnsuitable: boolean;
  unasDiffers: boolean;
} => ({
  pickupOnly: false,
  foxpostForbidden: false,
  isHeavy: false,
  isFrozen: false,
  pickupOnlySource: "UNAS",
  foxpostForbiddenSource: "UNAS",
  isHeavySource: "UNAS",
  isFrozenSource: "UNAS",
  lockerUnsuitable: false,
  unasDiffers: false,
  ...over,
});

describe("a lista szállítási szűrője", () => {
  it("egy jelleg a jelző igaz értéke, az eltérés-szűrő mellé kerül", () => {
    assert.deepEqual(shippingWhere("HEAVY", undefined), {
      shippingProfile: { is: { isHeavy: true } },
    });
    assert.deepEqual(shippingWhere("LOCKER_UNSUITABLE", true), {
      shippingProfile: { is: { unasDiffers: true, lockerUnsuitable: true } },
    });
    assert.deepEqual(shippingWhere(undefined, true), {
      shippingProfile: { is: { unasDiffers: true } },
    });
    assert.deepEqual(shippingWhere(undefined, undefined), {});
  });

  it("korlátozás nélküli: van sora és minden jelzője hamis; nincs kitöltve: nincs sora", () => {
    assert.deepEqual(shippingWhere("UNRESTRICTED", undefined), {
      shippingProfile: {
        is: {
          pickupOnly: false,
          isHeavy: false,
          foxpostForbidden: false,
          lockerUnsuitable: false,
          isFrozen: false,
        },
      },
    });
    assert.deepEqual(shippingWhere("NOT_FILLED", undefined), {
      shippingProfile: { is: null },
    });
    // sor nélkül nincs eltérés sem: üres halmaz, nem a szűrő elhagyása
    assert.deepEqual(shippingWhere("NOT_FILLED", true), { id: { in: [] } });
  });

  it("az oszlop a kézi jelzőt és az eltérést is mondja; sor nélkül null", () => {
    assert.equal(shippingSummary(null), null);
    assert.deepEqual(
      shippingSummary(
        sor({ isHeavy: true, isHeavySource: "MANUAL", unasDiffers: true }),
      ),
      {
        pickupOnly: false,
        foxpostForbidden: false,
        isHeavy: true,
        isFrozen: false,
        lockerUnsuitable: false,
        hasManual: true,
        unasDiffers: true,
      },
    );
  });
});

describe("a tömeges szerkesztés sora", () => {
  const unasFoxpost = {
    pickupOnly: false,
    foxpostForbidden: true,
    isHeavy: false,
    isFrozen: false,
  };

  it("a megnevezett jelző kézi lesz, akkor is, ha az értéke nem változik", () => {
    const r = bulkShippingRow(sor({ foxpostForbidden: true }), unasFoxpost, {
      set: { foxpostForbidden: true },
      resetToUnas: [],
    });
    assert.deepEqual(
      [r.foxpostForbidden, r.foxpostForbiddenSource, r.unasDiffers],
      [true, "MANUAL", false],
    );
  });

  it("a „UNAS szerint” a UNAS mai értékét adja vissza, UNAS forrással", () => {
    const r = bulkShippingRow(
      sor({
        foxpostForbidden: false,
        foxpostForbiddenSource: "MANUAL",
        unasDiffers: true,
      }),
      unasFoxpost,
      { set: {}, resetToUnas: ["foxpostForbidden"] },
    );
    assert.deepEqual(
      [r.foxpostForbidden, r.foxpostForbiddenSource, r.unasDiffers],
      [true, "UNAS", false],
    );
  });

  it("új sornál a meg nem nevezett jelzők a UNAS-éi, a csomagautomata kézi", () => {
    const r = bulkShippingRow(null, unasFoxpost, {
      set: { lockerUnsuitable: true, isHeavy: true },
      resetToUnas: [],
    });
    assert.deepEqual(
      [
        r.foxpostForbidden,
        r.foxpostForbiddenSource,
        r.isHeavySource,
        r.lockerUnsuitable,
      ],
      [true, "UNAS", "MANUAL", true],
    );
    // a kézi „nehéz” eltér a UNAS-étól
    assert.equal(r.unasDiffers, true);
  });
});

describe("a tömeges szerkesztés végrehajtása", () => {
  function hamis(profiles: Record<string, ReturnType<typeof sor>>) {
    const upserts: { productId: string; create: unknown; update: unknown }[] =
      [];
    const audits: unknown[] = [];
    const tx = {
      product: {
        findMany: async (args: { where: { id: { in: string[] } } }) =>
          args.where.id.in.filter((id) => id !== "nincs").map((id) => ({ id })),
      },
      productShippingProfile: {
        findMany: async (args: { where: { productId: { in: string[] } } }) =>
          args.where.productId.in
            .filter((id) => profiles[id])
            .map((id) => ({ id: `sp-${id}`, productId: id, ...profiles[id]! })),
        upsert: async (args: {
          where: { productId: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          upserts.push({
            productId: args.where.productId,
            create: args.create,
            update: args.update,
          });
          return { id: `sp-${args.where.productId}`, ...args.create };
        },
      },
      unasProductSnapshot: { findMany: async () => [] },
      auditLog: { create: async (a: unknown) => void audits.push(a) },
      domainEvent: { create: async () => ({}) },
    };
    const db = { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) };
    return { db: db as never, upserts, audits };
  }

  it("frissítéskor csak a megnevezett jelzőt és az eltérés-jelzőt írja; a hiányzó termék kimarad", async () => {
    const h = hamis({ p1: sor({ isHeavy: true }) });
    const r = await runShippingBulk(
      h.db,
      ["p1", "p2", "nincs"],
      { set: { foxpostForbidden: true }, resetToUnas: [] },
      "u-1",
    );
    assert.deepEqual(r, { updated: 1, created: 1, missing: ["nincs"] });
    assert.deepEqual(h.upserts[0]!.update, {
      foxpostForbidden: true,
      foxpostForbiddenSource: "MANUAL",
      unasDiffers: true,
    });
    assert.equal(h.audits.length, 2);
  });
});

describe("a tömeges szerkesztés bemenete", () => {
  const service = new ProductShippingProfileService({} as never);

  it("teendő nélkül, vagy ugyanazt a jelzőt beállítva és visszaállítva: 400", async () => {
    await assert.rejects(
      service.bulk({ productIds: ["p1"], set: {}, resetToUnas: [] }, "u-1"),
      /legalább egy/,
    );
    await assert.rejects(
      service.bulk(
        {
          productIds: ["p1"],
          set: { isHeavy: true },
          resetToUnas: ["isHeavy"],
        },
        "u-1",
      ),
      /egyszerre beállítva és visszaállítva: isHeavy/,
    );
  });
});
