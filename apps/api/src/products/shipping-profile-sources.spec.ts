import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { main } from "./shipping-profile-fill.cli.js";
import {
  applyUnasShippingFlags,
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
      data: { ...sor(), unasDiffers: false },
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
        // a kézi „nehéz” eltér a UNAS-étól: az eltérés-jelző is felkerül
        data: { foxpostForbidden: true, unasDiffers: true },
        flags: ["foxpostForbidden"],
      },
    );
  });

  it("az eltérés-jelző csak a kézi jelzőre, és eltűnik, ha a UNAS utoléri", () => {
    // kézi, és egyezik a UNAS-szal: nem eltérés
    assert.deepEqual(
      planUnasShippingFlags(
        sor({ foxpostForbidden: true, foxpostForbiddenSource: "MANUAL" }),
        unasFoxpost,
      ),
      { kind: "unchanged" },
    );
    // eddig eltért, most a UNAS is tiltja: a jelző lekerül
    assert.deepEqual(
      planUnasShippingFlags(
        sor({
          foxpostForbidden: true,
          foxpostForbiddenSource: "MANUAL",
          unasDiffers: true,
        }),
        unasFoxpost,
      ),
      { kind: "update", data: { unasDiffers: false }, flags: [] },
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
      createMany: async (args: {
        data: ({ productId: string } & StoredShippingProfile)[];
      }) => {
        let count = 0;
        for (const { productId, ...rest } of args.data)
          if (!profiles[productId]) {
            profiles[productId] = rest;
            state.writes++;
            count++;
          }
        return { count };
      },
      updateMany: async (args: {
        where: { productId: string } & Record<string, unknown>;
        data: Partial<StoredShippingProfile>;
      }) => {
        const row = profiles[args.where.productId];
        const { productId: _p, ...feltetel } = args.where;
        if (
          !row ||
          !Object.entries(feltetel).every(
            ([k, v]) => (row as Record<string, unknown>)[k] === v,
          )
        )
          return { count: 0 };
        state.writes++;
        Object.assign(row, args.data);
        return { count: 1 };
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

/*
  VERSENY A KÉZI ÍRÁSSAL (barracuda, #1654 2a és 2b). A tranzakció-dupla a
  szinkron olvasása UTÁN, az írása ELŐTT futtat egy kézi írást, és a feltételes
  írást úgy értékeli, ahogy a Postgres a sorzár után: a `where` a MOSTANI sorra.
  MI PIROSÍT: a szinkron a régi olvasat alapján felülírja a közben kézire állított
  jelzőt; egy egyidejű első létrehozás P2002-vel dob.
*/
describe("a szinkron és a közbeíró kézi írás", () => {
  function tx(
    row: StoredShippingProfile | null,
    kozbe: (a: { row: StoredShippingProfile | null }) => void,
  ) {
    const allapot = { row };
    let elsoIras = true;
    const iras = () => {
      if (elsoIras) {
        elsoIras = false;
        kozbe(allapot);
      }
    };
    return {
      allapot,
      tx: {
        productShippingProfile: {
          findUnique: async () => (allapot.row ? { ...allapot.row } : null),
          createMany: async (args: { data: StoredShippingProfile[] }) => {
            iras();
            if (allapot.row) return { count: 0 };
            allapot.row = { ...args.data[0]! };
            return { count: 1 };
          },
          updateMany: async (args: {
            where: Record<string, unknown>;
            data: Partial<StoredShippingProfile>;
          }) => {
            iras();
            const { productId: _p, ...feltetel } = args.where;
            const r = allapot.row as Record<string, unknown> | null;
            if (!r || !Object.entries(feltetel).every(([k, v]) => r[k] === v))
              return { count: 0 };
            Object.assign(r, args.data);
            return { count: 1 };
          },
        },
      } as never,
    };
  }

  it("a közben kézire állított jelzőt a szinkron nem írja vissza", async () => {
    // a szinkron olvas: nehéz, UNAS; a UNAS most azt mondja, nem nehéz
    const t = tx(sor({ isHeavy: true }), (a) => {
      Object.assign(a.row!, { isHeavy: true, isHeavySource: "MANUAL" });
    });
    await applyUnasShippingFlags(t.tx, "p1", {});
    assert.deepEqual(
      [t.allapot.row!.isHeavy, t.allapot.row!.isHeavySource],
      [true, "MANUAL"],
    );
  });

  it("a szinkron az eltérés-jelzőt a végső sorból állítja", async () => {
    // kézi: nem tiltott; a UNAS most tiltja -> eltér
    const t = tx(
      sor({ foxpostForbidden: false, foxpostForbiddenSource: "MANUAL" }),
      () => {},
    );
    await applyUnasShippingFlags(t.tx, "p1", TILTOTT_FOXPOST);
    assert.equal(t.allapot.row!.unasDiffers, true);
  });

  it("egyidejű első létrehozás: nem dob, és a közben létrejött kézi sort nem írja felül", async () => {
    const t = tx(null, (a) => {
      a.row = sor({
        foxpostForbidden: false,
        foxpostForbiddenSource: "MANUAL",
        pickupOnlySource: "MANUAL",
        isHeavySource: "MANUAL",
        isFrozenSource: "MANUAL",
      });
    });
    await applyUnasShippingFlags(t.tx, "p1", TILTOTT_FOXPOST);
    assert.deepEqual(
      [t.allapot.row!.foxpostForbidden, t.allapot.row!.foxpostForbiddenSource],
      [false, "MANUAL"],
    );
  });
});
