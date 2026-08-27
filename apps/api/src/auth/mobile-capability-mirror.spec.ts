import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PERMISSIONS } from "@acropora/types";

/**
 * A MOBIL TÜKÖR MINDEN KULCSÁNAK LEGYEN SZERVER OLDALI PÁRJA.
 *
 * Az Expo app szándékosan nem húzza be a munkatér csomagjait, ezért a
 * jogosultságokról SAJÁT másolatot tart (`webshop-authorization.ts`). Egy
 * másolat annyit ér, amennyire a nevei igazak: a `navView` és a `navManage`
 * évekig úgy állt ott, mintha jog lenne, holott a szerveren nem létezett -- egy
 * MODULT nevezett meg, a szerver pedig MŰVELETEK szerint oszt jogot (a NAV
 * kapcsolat `settings.manage`, az adószám-lekérdezés `customers.manage`, a
 * bejövő számlák `purchasing.view`).
 *
 * Ez a teszt azért itt van, és nem a mobil oldalon, mert CSAK innen látszik
 * mind a két oldal: a szerver jogai importtal, a tükör pedig a fájl SZÖVEGÉBŐL
 * olvasva. A mobil teszt-futtató a szerver listáját nem érheti el, tehát ott
 * ugyanez az állítás nem lenne megfogalmazható.
 *
 * A megfeleltetés kézzel írt, mert nem gépies: a telefonon `assetsView` a neve
 * annak, amit a szerver `service.view`-nak hív. Épp ezért a lista MAGA is
 * mérendő -- lásd a harmadik állítást.
 */

const MIRROR = "../mobile/src/lib/auth/webshop-authorization.ts";

/**
 * A tükör kulcsa -> a szerver joga. A `null` azt jelenti: ez a kulcs
 * SZÁNDÉKOSAN nem jogosultság, hanem egy munkaterület megjelenésének kérdése.
 */
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

/** A két képesség-interfész kulcsai, a fájl szövegéből. */
function mirrorKeys(): string[] {
  const source = readFileSync(MIRROR, "utf8");
  const blocks = [
    /export interface WebshopCapabilities \{([\s\S]*?)\n\}/,
    /export interface ServiceCapabilities \{([\s\S]*?)\n\}/,
  ].map((pattern) => {
    const match = pattern.exec(source);
    assert.ok(match, `Nem találtam a tükör egyik interfészét: ${pattern}`);
    return match![1]!;
  });

  const keys = new Set<string>();
  for (const block of blocks)
    for (const line of block.matchAll(/^\s*(\w+):\s*boolean;/gm))
      keys.add(line[1]!);
  return [...keys].sort();
}

/**
 * A KONTROLL A KERESÉSRE. Ha a fájl szerkezete változik és a minta nem talál
 * kulcsokat, a többi állítás ÜRES halmazon menne végig, és zölden azt mondaná,
 * hogy minden rendben.
 */
test("reads the mirror it claims to read", () => {
  const keys = mirrorKeys();

  assert.ok(
    keys.length >= 10,
    `Csak ${keys.length} kulcsot találtam a tükörben. Ez a keresés hibája, nem a tüköré.`,
  );
  assert.equal(keys.includes("ordersView"), true);
  assert.equal(keys.includes("assetsManage"), true);
});

test("every mirrored key names a permission the server actually has", () => {
  const unpaired = mirrorKeys().filter((key) => {
    if (!(key in SERVER_PAIR)) return true;
    const permission = SERVER_PAIR[key];
    return (
      permission !== null &&
      !Object.values(PERMISSIONS).includes(permission as never)
    );
  });

  assert.deepEqual(
    unpaired,
    [],
    "Ezeknek a mobil kulcsoknak nincs szerver oldali párjuk, tehát olyat állítanak " +
      "a felhasználóról, amit a szerver nem ismer: " +
      unpaired.join(", "),
  );
});

/**
 * ÉS A MEGFELELTETÉS SEM AVULHAT EL. Egy bennragadt sor csendben marad: a
 * szűrő csak azt nézi, mi van a listán KÍVÜL, tehát egy kulcs, ami már nem
 * létezik, sosem válna pirosra -- közben úgy olvasná bárki, mintha a tükörben
 * még ott lenne. (Ez ma reggel meg is történt egy másik listával.)
 */
test("keeps no mapping for a key the mirror no longer has", () => {
  const keys = new Set(mirrorKeys());
  const stale = Object.keys(SERVER_PAIR).filter((key) => !keys.has(key));

  assert.deepEqual(
    stale,
    [],
    "Ezek a sorok olyan kulcsra hivatkoznak, ami már nincs a tükörben: " +
      stale.join(", "),
  );
});
