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

function fakes(sorok = [PROFIL]) {
  const ki: string[] = [];
  const hivasok: { id: string; apply: boolean }[] = [];
  const lekerdezes: unknown[] = [];

  const out = {
    stdout: (v: string) => ki.push(v),
    stderr: (v: string) => ki.push("ERR:" + v),
  };
  const database = {
    productShippingProfile: {
      findMany: async (args: unknown) => {
        lekerdezes.push(args);
        return sorok;
      },
    },
  } as unknown as ShippingAttributesCliDatabase;

  const service = {
    project: async (id: string, _profil: unknown, apply: boolean) => {
      hivasok.push({ id, apply });
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
    assert.deepEqual(f.hivasok, [{ id: "prod-os-1", apply: false }]);
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

    assert.deepEqual(f.hivasok, [{ id: "prod-os-1", apply: true }]);
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
