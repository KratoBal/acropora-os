import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { main } from "./shipping-profile-fill.cli.js";
import {
  planUnasShippingFlags,
  type StoredShippingProfile,
} from "./shipping-profile-sources.js";

/**
 * A SZÁLLÍTÁSI JELZŐK GAZDÁJA AZ OS (a82ed229). MI PIROSÍT: a UNAS felülírja a
 * kézi jelzőt; a felülírás nélküli UNAS-termék nem kap sort, vagy nem hamis
 * jelzőkkel kapja; a feltöltő száraz futása ír; egy második futás újra változást
 * mutat.
 */
const sor = (
  over: Partial<StoredShippingProfile> = {},
): StoredShippingProfile => ({
  pickupOnly: false,
  foxpostForbidden: false,
  isHeavy: false,
  isFrozen: false,
  pickupOnlySource: "UNAS",
  foxpostForbiddenSource: "UNAS",
  isHeavySource: "UNAS",
  isFrozenSource: "UNAS",
  ...over,
});

const TILTOTT_FOXPOST = {
  ShippingMethods: {
    Denied: { Method: [{ Name: "Foxpost csomagautomaták" }] },
  },
};
const unasFoxpost = {
  pickupOnly: false,
  foxpostForbidden: true,
  isHeavy: false,
  isFrozen: false,
};

describe("a UNAS-beállítás a szállítási jelzőkre", () => {
  it("sor nélkül: létrejön, minden jelző a UNAS-é, felülírás nélkül mind hamis", () => {
    assert.deepEqual(planUnasShippingFlags(null, null), {
      kind: "create",
      data: sor(),
    });
    const plan = planUnasShippingFlags(null, unasFoxpost);
    assert.equal(plan.kind === "create" && plan.data.foxpostForbidden, true);
  });

  it("a UNAS-forrású jelző követi a UNAS-t, a kézi marad", () => {
    assert.deepEqual(
      planUnasShippingFlags(
        sor({ isHeavy: true, isHeavySource: "MANUAL" }),
        unasFoxpost,
      ),
      {
        kind: "update",
        data: { foxpostForbidden: true },
        flags: ["foxpostForbidden"],
      },
    );
  });

  it("egyezésnél nincs írás", () => {
    assert.deepEqual(
      planUnasShippingFlags(sor({ foxpostForbidden: true }), unasFoxpost),
      { kind: "unchanged" },
    );
  });
});

describe("az egyszeri feltöltő parancs", () => {
  function hamisDb(profiles: Record<string, StoredShippingProfile>) {
    const snapshots = [
      { productId: "p1", rawPayload: TILTOTT_FOXPOST },
      { productId: "p2", rawPayload: {} },
      { productId: "p3", rawPayload: TILTOTT_FOXPOST },
    ];
    const state = { writes: 0, transactions: 0 };
    const productShippingProfile = {
      findMany: async (args: { where: { productId: { in: string[] } } }) =>
        args.where.productId.in
          .filter((id) => profiles[id])
          .map((id) => ({ productId: id, ...profiles[id]! })),
      findUnique: async (args: { where: { productId: string } }) =>
        profiles[args.where.productId] ?? null,
      create: async (args: {
        data: { productId: string } & StoredShippingProfile;
      }) => {
        state.writes++;
        const { productId, ...rest } = args.data;
        profiles[productId] = rest;
        return args.data;
      },
      update: async (args: {
        where: { productId: string };
        data: Partial<StoredShippingProfile>;
      }) => {
        state.writes++;
        Object.assign(profiles[args.where.productId]!, args.data);
        return {};
      },
    };
    const db = {
      unasProductSnapshot: {
        findMany: async (args: { where: { productId?: { gt: string } } }) =>
          snapshots.filter(
            (s) =>
              !args.where.productId || s.productId > args.where.productId.gt,
          ),
      },
      productShippingProfile,
      $transaction: async (fn: (tx: unknown) => Promise<void>) => {
        state.transactions++;
        return fn({ productShippingProfile });
      },
    };
    return { db: db as never, state, profiles };
  }

  const futtat = async (args: string[], h: ReturnType<typeof hamisDb>) => {
    let stdout = "";
    const code = await main(
      args,
      { stdout: (v) => (stdout += v), stderr: () => {} },
      h.db,
    );
    return { code, stdout };
  };

  it("száraz futás: kiírja a tervet és a kézi eltérést, és nem ír", async () => {
    const h = hamisDb({
      p3: sor({ foxpostForbidden: false, foxpostForbiddenSource: "MANUAL" }),
    });
    const r = await futtat([], h);
    assert.equal(r.code, 0);
    assert.equal(h.state.writes, 0);
    assert.match(r.stdout, /Új sor \(eddig nem volt\): 2/);
    assert.match(
      r.stdout,
      /eltér a UNAS-étól \(marad a kézi\): 1\n {2}p3 foxpostForbidden/,
    );
  });

  it("--apply után a második futás nulla változást mutat", async () => {
    const h = hamisDb({});
    await futtat(["--apply"], h);
    assert.equal(h.profiles.p1!.foxpostForbidden, true);
    assert.equal(h.profiles.p2!.foxpostForbidden, false);
    const masodik = await futtat([], h);
    assert.match(masodik.stdout, /Új sor \(eddig nem volt\): 0/);
    assert.match(masodik.stdout, /Frissül \(UNAS-forrású jelző változott\): 0/);
  });
});
