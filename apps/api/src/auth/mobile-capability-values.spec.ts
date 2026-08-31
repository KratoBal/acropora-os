import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import ts from "typescript";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@acropora/types";
import type { UserRole } from "@acropora/types";

/**
 * A TÜKÖR NEVEI EGYEZNEK. AZ ÉRTÉKEI NEM VOLTAK MÉRVE.
 *
 * A szomszédos `mobile-capability-mirror.spec.ts` azt őrzi, hogy a mobil tükör
 * minden KULCSA olyan jogot nevez meg, ami a szerveren létezik. Ez szükséges,
 * és nem elég: egy létező jog nevét szerepenként ROSSZ értékkel is le lehet
 * írni.
 *
 * Ma egy `SALES: { purchasingView: true }` sor a tükörben mindhárom ottani
 * állításon átmenne, miközben a szerver a SALES szerepnek nem ad
 * `purchasing.view` jogot. A telefon mutatna egy csempét, amit utána minden
 * hívás elutasít -- és a fordítottja rosszabb: egy hamisan `false` érték némán
 * elrejt valamit, amit a felhasználó használhatna, és arról senki nem kap
 * hibaüzenetet.
 *
 * MÉRVE 2026-08-27: ma NINCS ilyen eltérés, 7 szerep és 84 összevetett pár
 * mellett (a szám a munkalap két kulcsával nőtt 70-ről). Ez a fájl tehát nem javít semmit, hanem megőrzi ezt az állapotot.
 *
 * MIÉRT NEM A FÁJL SZÖVEGÉT NÉZI. A webshop-oldali táblát még ki lehetne
 * olvasni mintával, de a szolgáltatás-oldali képességeket egy FÜGGVÉNY számolja
 * (`getServiceCapabilities`), szerep-felsorolásokkal a törzsében. Egy szöveges
 * minta ott vagy törékeny, vagy hazudik. Ezért a tükör itt LEFORDUL és
 * LEFUT: a mérés a valódi két függvényt hívja meg minden szerepre.
 */

const MIRROR = "../mobile/src/lib/auth/webshop-authorization.ts";

/** A tükör kulcsa -> a szerver joga. `null`: szándékosan nem jogosultság. */
const SERVER_PAIR: Record<string, string | null> = {
  workspace: null,
  ordersView: PERMISSIONS.ORDERS_VIEW,
  ordersManage: PERMISSIONS.ORDERS_MANAGE,
  purchasingView: PERMISSIONS.PURCHASING_VIEW,
  purchasingManage: PERMISSIONS.PURCHASING_MANAGE,
  productsView: PERMISSIONS.PRODUCTS_VIEW,
  productsManage: PERMISSIONS.PRODUCTS_MANAGE,
  partnersView: PERMISSIONS.PARTNERS_VIEW,
  partnersManage: PERMISSIONS.PARTNERS_MANAGE,
  assetsView: PERMISSIONS.SERVICE_VIEW,
  assetsManage: PERMISSIONS.SERVICE_MANAGE,
  // Ugyanaz a két szerver-jog, mint az eszközöké: a szerviz modult a szerver
  // egyetlen jogosultság-párral védi, a telefonon viszont két csempe áll rajta.
  worksheetsView: PERMISSIONS.SERVICE_VIEW,
  worksheetsManage: PERMISSIONS.SERVICE_MANAGE,
};

interface Mirror {
  getWebshopCapabilities(role: UserRole): Record<string, boolean>;
  getServiceCapabilities(role: UserRole): Record<string, boolean>;
}

/**
 * A tükör betöltése futtatható alakban.
 *
 * A fájl csak típust importál (`import type { UserRole }`), amit a fordítás
 * eltávolít, tehát a maradék önmagában futtatható. Ha egy nap VALÓDI importot
 * kap, ez a betöltés elhasal -- az piros teszt, nem csendes kihagyás, és
 * pontosan ez a kívánt viselkedés.
 */
async function loadMirror(): Promise<Mirror> {
  const source = readFileSync(MIRROR, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
    },
  }).outputText;
  const encoded = Buffer.from(javascript, "utf8").toString("base64");
  return (await import(
    `data:text/javascript;base64,${encoded}`
  )) as unknown as Mirror;
}

/** Minden (szerep, kulcs) pár, ami jogot hordoz. */
function comparisons(mirror: Mirror) {
  const rows: Array<{
    role: string;
    key: string;
    client: boolean;
    server: boolean;
    permission: string;
  }> = [];

  for (const role of Object.keys(ROLE_PERMISSIONS)) {
    const capabilities = {
      ...mirror.getWebshopCapabilities(role as UserRole),
      ...mirror.getServiceCapabilities(role as UserRole),
    };
    for (const [key, client] of Object.entries(capabilities)) {
      const permission = SERVER_PAIR[key];
      // A nem nevesített kulcs nem ennek a fájlnak a dolga: a szomszédos spec
      // az, ami pirosra vált tőle. Itt kihagyni helyes, elhallgatni nem az --
      // ezért az alábbi darabszám-őrző.
      if (permission === null || permission === undefined) continue;
      rows.push({
        role,
        key,
        client,
        server: (
          ROLE_PERMISSIONS[role as UserRole] as readonly string[]
        ).includes(permission),
        permission,
      });
    }
  }
  return rows;
}

describe("a mobil tükör ÉRTÉKEI", () => {
  it("minden szerepre ugyanazt mondja, mint a szerver", async () => {
    const rows = comparisons(await loadMirror());

    // ÜRES SÖPRÉS NE LÁTSZÓDJON ZÖLDNEK. Hét szerep és tizenkét jog-hordozó
    // kulcs nyolcvannégy párt ad; ha ennél sokkal kevesebb jön ki, a betöltés
    // vagy a megfeleltetés romlott el, nem a tükör lett hibátlan.
    assert.ok(
      rows.length >= 60,
      `Csak ${rows.length} párt tudtam összevetni. Ez a mérés hibája, nem a tüköré.`,
    );

    const divergent = rows
      .filter((row) => row.client !== row.server)
      .map(
        (row) =>
          `${row.role}.${row.key}: a telefon ${row.client}, a szerver ${row.server} (${row.permission})`,
      );

    assert.deepEqual(
      divergent,
      [],
      "A telefon mást állít a felhasználó jogairól, mint a szerver. A `true` " +
        "oldalon egy csempe jelenik meg, amit minden hívás elutasít; a `false` " +
        "oldalon némán eltűnik valami, amit használhatna: " +
        divergent.join("; "),
    );
  });

  /**
   * A FALSZIFIKÁCIÓ. A fenti állítás akkor is zöld lenne, ha az összevetés
   * semmit nem tudna megtalálni. Ez a sor egy szándékosan hazudó tükröt ad
   * neki, és megköveteli, hogy pontosan egy eltérést jelentsen.
   */
  it("észreveszi, ha a tükör többet állít a szervernél", async () => {
    const mirror = await loadMirror();
    const lying: Mirror = {
      getServiceCapabilities: (role) => mirror.getServiceCapabilities(role),
      getWebshopCapabilities: (role) => ({
        ...mirror.getWebshopCapabilities(role),
        // A SALES szerepnek a szerver nem ad purchasing.view jogot.
        ...(role === "SALES" ? { purchasingView: true } : {}),
      }),
    };

    const divergent = comparisons(lying).filter(
      (row) => row.client !== row.server,
    );

    assert.equal(divergent.length, 1);
    assert.equal(divergent[0]?.role, "SALES");
    assert.equal(divergent[0]?.key, "purchasingView");
  });
});
