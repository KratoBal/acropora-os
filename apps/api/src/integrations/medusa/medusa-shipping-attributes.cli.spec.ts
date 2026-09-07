import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runShippingAttributesCli,
  type ShippingAttributesCliDatabase,
} from "./medusa-shipping-attributes.cli.js";
import type { MedusaShippingAttributesService } from "./medusa-shipping-attributes.service.js";

const PROFIL = {
  productId: "prod-os-1",
  pickupOnly: true,
  foxpostForbidden: false,
  isHeavy: true,
  isFrozen: false,
};

const FA = [
  { id: "gy1", name: "Korallok", parentId: null },
  { id: "gy1a", name: "SPS", parentId: "gy1" },
  { id: "mu1", name: "Technika", parentId: null },
];

function fakes(
  sorok = [PROFIL],
  besorolasok: { productId: string; categoryId: string }[] = [],
) {
  const ki: string[] = [];
  const hivasok: { id: string; apply: boolean; derived: boolean }[] = [];
  const lekerdezes: unknown[] = [];

  const out = {
    stdout: (v: string) => ki.push(v),
    stderr: (v: string) => ki.push("ERR:" + v),
  };
  const database = {
    category: { findMany: async () => FA },
    productCategory: { findMany: async () => besorolasok },
    productShippingProfile: {
      findMany: async (args: unknown) => {
        lekerdezes.push(args);
        return sorok;
      },
    },
  } as unknown as ShippingAttributesCliDatabase;

  const service = {
    project: async (
      id: string,
      _profil: unknown,
      apply: boolean,
      derived = false,
    ) => {
      hivasok.push({ id, apply, derived });
      return apply
        ? ({
            action: "applied",
            medusaProductId: "prod_medusa_1",
            flags: "csak bolti átvétel",
          } as const)
        : ({
            action: "planned",
            medusaProductId: "prod_medusa_1",
            flags: "csak bolti átvétel",
          } as const);
    },
  } as unknown as MedusaShippingAttributesService;

  return {
    out,
    database,
    service,
    hivasok,
    lekerdezes,
    szoveg: () => ki.join(""),
  };
}

/**
 * A PROBA-ALAK KAPUJA. Ugyanaz a mérce, mint a marka-visszatoltesnel: a
 * bizonyitek NEM a kimenet szovege (egy parancs, ami kiirja, hogy "terv", es
 * kozben ir, ugyanezt a sort adna), hanem az, hogy az iras-kapcsolo HAMISKENT
 * ment at a szolgaltatasnak.
 */
describe("a szállítási jellemzők parancsa", () => {
  it("--apply nélkül tervet ír, és a szolgáltatás NEM ír", async () => {
    const f = fakes();

    const kod = await runShippingAttributesCli(
      [],
      f.out,
      undefined,
      f.database,
      f.service,
    );

    assert.equal(kod, 0);
    assert.deepEqual(f.hivasok, [
      { id: "prod-os-1", apply: false, derived: false },
    ]);
    assert.match(f.szoveg(), /KIKÜLDENÉNK/);
    assert.match(f.szoveg(), /Ez a futás semmit nem írt/);
  });

  it("--apply mellett az írás-kapcsoló igazként megy tovább", async () => {
    const f = fakes();

    await runShippingAttributesCli(
      ["--apply"],
      f.out,
      undefined,
      f.database,
      f.service,
    );

    assert.deepEqual(f.hivasok, [
      { id: "prod-os-1", apply: true, derived: false },
    ]);
    assert.match(f.szoveg(), /most állítottuk be/);
    assert.doesNotMatch(f.szoveg(), /semmit nem írt/);
  });

  /**
   * A HALMAZT AZ ADAT HATAROZZA MEG, NEM A HIVO: azok a termekek, amelyeknek
   * VAN profil-soruk. Egy azonosito-lista ugyanezert lenne rossz alapertelmezes
   * -- a hivonak kellene tudnia, kit vizsgaltak meg, es az a tudas az
   * adatbazisban all.
   */
  it("azonosító nélkül MINDEN profillal rendelkező termék a halmaz", async () => {
    const f = fakes();

    await runShippingAttributesCli([], f.out, undefined, f.database, f.service);

    assert.deepEqual(
      (f.lekerdezes[0] as { where: unknown }).where,
      {},
      "szűrés nélkül kell kérdezni, ha nincs megadva azonosító",
    );
  });

  it("megadott azonosítókra szűkít", async () => {
    const f = fakes();

    await runShippingAttributesCli(
      ["prod-os-1", "prod-os-2"],
      f.out,
      undefined,
      f.database,
      f.service,
    );

    assert.deepEqual((f.lekerdezes[0] as { where: unknown }).where, {
      productId: { in: ["prod-os-1", "prod-os-2"] },
    });
  });

  /**
   * A NULLA NEM HIBA, DE NEM IS NEMA. Egy ures kimenet ugyanugy nezne ki, mint
   * egy elhasalt lekerdezes -- ezert a parancs kimondja, MIT kerdezett.
   */
  /**
   * AZ ELO ALLAT AG AKKOR IS CEL, HA NINCS PROFIL-SORA -- es ez ma az EGYETLEN
   * forras, ami adatot ad: nulla profil-sor all az adatbazisban (acrobot merese,
   * 2026-09-07), mikozben 206 elo allat termek van.
   */
  it("az élő állat ág alatti termék profil nélkül is cél", async () => {
    const f = fakes([], [{ productId: "prod-elo-1", categoryId: "gy1a" }]);

    await runShippingAttributesCli([], f.out, undefined, f.database, f.service);

    assert.deepEqual(f.hivasok, [
      { id: "prod-elo-1", apply: false, derived: true },
    ]);
    assert.match(f.szoveg(), /1 élő állat besorolás alapján/);
  });

  it("profil nélkül megmondja, hogy nincs mit átvinni", async () => {
    const f = fakes([]);

    const kod = await runShippingAttributesCli(
      ["--apply"],
      f.out,
      undefined,
      f.database,
      f.service,
    );

    assert.equal(kod, 0);
    assert.deepEqual(f.hivasok, []);
    assert.match(f.szoveg(), /nincs mit átvinni/);
  });
});
