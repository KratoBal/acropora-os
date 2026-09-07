import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeBrandMergePlan,
  planBrandMerge,
  type BrandSide,
} from "./brand-merge.js";
import {
  mergeInTransaction,
  type MergeTransaction,
} from "./brand-merge.cli.js";

const oldal = (overrides: Partial<BrandSide> = {}): BrandSide => ({
  id: "b-from",
  name: "AquaMedic",
  normalizedName: "aquamedic",
  aliases: [],
  productCount: 9,
  isActive: true,
  ...overrides,
});

const cel = (overrides: Partial<BrandSide> = {}): BrandSide =>
  oldal({
    id: "b-into",
    name: "Aqua Medic",
    normalizedName: "aqua medic",
    aliases: [
      { id: "a-1", alias: "AquaMedic", normalizedAlias: "aquamedic" },
      { id: "a-2", alias: "Aqua Mdic", normalizedAlias: "aqua mdic" },
    ],
    productCount: 0,
    ...overrides,
  });

describe("a márka-összevonás terve", () => {
  /**
   * A KET TERMEKSZAM EGYUTT MONDJA MEG, HOGY JO IRANYBA MEGYUNK-E.
   *
   * Egy "9 termek mozdul" sor onmagaban akkor is helyesnek latszik, ha forditva
   * hivtuk. A ket oldal egymas mellett viszont azonnal mutatja: a nulla termeku
   * markarol a kilencre mozgatni majdnem biztosan teves irany.
   */
  it("a terv MIND A KÉT oldal termékszámát kiírja", () => {
    const szoveg = describeBrandMergePlan(planBrandMerge(oldal(), cel()));

    assert.match(szoveg, /Forrás: "AquaMedic" -- 9 termék/);
    assert.match(szoveg, /Cél: *"Aqua Medic" -- 0 termék/);
  });

  /**
   * A CELON MAR ALLO KULCS NEM KERUL FEL MEGEGYSZER -- es ez nem takarekossag:
   * a `BrandAlias.normalizedAlias` EGYEDI, tehat a masodik beszuras elhasalna.
   */
  it("a célon már álló kulcsot nem viszi fel újra", () => {
    const plan = planBrandMerge(
      oldal({
        aliases: [
          { id: "a-9", alias: "AQUAMEDIC", normalizedAlias: "aquamedic" },
        ],
      }),
      cel(),
    );

    assert.deepEqual(plan.moveAliases, []);
    assert.equal(plan.keptAliases.length, 1);
    // ES A FORRAS NEVE SEM, mert a celon MAR alias:
    assert.equal(plan.nameAsAlias, null);
  });

  it("archivált célra nem enged összevonni", () => {
    const plan = planBrandMerge(oldal(), cel({ isActive: false }));

    assert.ok(plan.refusals.some((r) => /archivált/.test(r)));
  });
});

/**
 * A SORREND VEDVE VAN, NEM CSAK LEIRVA.
 *
 * acrobot kerte kulon: a forras nevet csak azutan lehet a cel aliasakent
 * felvinni, hogy a forras MAR NEM birtokolja azt a kulcsot. Egy leirt sorrend
 * nem vedelem -- ezert all itt allitas.
 */
describe("a márka-összevonás végrehajtása", () => {
  function tx(overrides: Partial<MergeTransaction> = {}) {
    const hivasok: string[] = [];
    const alap: MergeTransaction = {
      product: {
        updateMany: async () => {
          hivasok.push("termek");
          return { count: 9 };
        },
      },
      brandAlias: {
        update: async () => {
          hivasok.push("alias-mozgatas");
          return {};
        },
        create: async () => {
          hivasok.push("nev-aliaskent");
          return {};
        },
        findMany: async () => [],
      },
      brand: {
        update: async (args: unknown) => {
          const data = (args as { data: Record<string, unknown> }).data;
          hivasok.push("isActive" in data ? "archivalas" : "atnevezes");
          return {};
        },
        findMany: async () => [],
      },
      auditLog: {
        create: async () => {
          hivasok.push("naplo");
          return {};
        },
      },
      domainEvent: {
        create: async () => {
          hivasok.push("esemeny");
          return {};
        },
      },
      ...overrides,
    };
    return { tx: alap, hivasok };
  }

  const terv = () =>
    planBrandMerge(
      oldal(),
      cel({
        aliases: [
          { id: "a-2", alias: "Aqua Mdic", normalizedAlias: "aqua mdic" },
        ],
      }),
    );

  it("a forrás neve csak a NYUGDÍJAZÁS után lehet a cél aliasa", async () => {
    const f = tx();

    await mergeInTransaction(f.tx, terv(), "user-1");

    const atnevezes = f.hivasok.indexOf("atnevezes");
    const aliaskent = f.hivasok.indexOf("nev-aliaskent");
    assert.ok(atnevezes >= 0, "az átnevezésnek meg kell történnie");
    assert.ok(aliaskent >= 0, "a névnek aliasként fel kell kerülnie");
    assert.ok(
      atnevezes < aliaskent,
      `az átnevezésnek ELŐBB kell állnia: ${f.hivasok.join(" -> ")}`,
    );
  });

  it("az archiválás a név-alias lépés UTÁN áll", async () => {
    const f = tx();

    await mergeInTransaction(f.tx, terv(), "user-1");

    assert.ok(
      f.hivasok.indexOf("nev-aliaskent") < f.hivasok.indexOf("archivalas"),
      `rossz sorrend: ${f.hivasok.join(" -> ")}`,
    );
  });

  /**
   * A ZARO ORZO: A MOZGATAS KELETKEZTETHETI AZT, AMIT TILT.
   *
   * A tranzakcio VEGEN ellenorzunk, mert az elejen meg nem letezik az az
   * allapot, amit tiltunk.
   */
  it("a mozgatás után maradó kétértelmű kulcs megállítja", async () => {
    const f = tx({
      brand: {
        update: async () => ({}),
        findMany: async () => [
          { id: "b-x", name: "Maradék", normalizedName: "maradek" },
        ],
      },
      brandAlias: {
        update: async () => ({}),
        create: async () => ({}),
        findMany: async () => [
          { alias: "Maradék", normalizedAlias: "maradek", brandId: "b-into" },
        ],
      },
    });

    await assert.rejects(
      () => mergeInTransaction(f.tx, terv(), "user-1"),
      /MERGE_WOULD_LEAVE_AMBIGUOUS_KEY/,
    );
  });

  /**
   * ES A POZITIV KONTROLL: ha a kulcs UGYANAHHOZ a markahoz tartozik (a sajat
   * neve es a sajat aliasa), az NEM ketertelmu. Enelkul az orzot az is
   * kielegitene, ha minden osszevonast megallitana.
   */
  it("a saját nevével egyező saját alias NEM állítja meg", async () => {
    const f = tx({
      brand: {
        update: async () => ({}),
        findMany: async () => [
          { id: "b-into", name: "Aqua Medic", normalizedName: "aqua medic" },
        ],
      },
      brandAlias: {
        update: async () => ({}),
        create: async () => ({}),
        findMany: async () => [
          {
            alias: "Aqua Medic",
            normalizedAlias: "aqua medic",
            brandId: "b-into",
          },
        ],
      },
    });

    await mergeInTransaction(f.tx, terv(), "user-1");
  });
});
