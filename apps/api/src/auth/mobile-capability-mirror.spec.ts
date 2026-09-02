import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { HUMAN_ROLES, MACHINE_ROLES, PERMISSIONS } from "@acropora/types";

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

const ROLE_MIRROR = "../mobile/src/lib/auth/types.ts";

/** A mobil `UserRole` unió tagjai, a fájl szövegéből. */
function mirrorRoles(): string[] {
  const source = readFileSync(ROLE_MIRROR, "utf8");
  const match = /export type UserRole =([\s\S]*?);/.exec(source);
  assert.ok(match, "Nem találtam a mobil UserRole uniót.");
  return [...match![1]!.matchAll(/"(\w+)"/g)].map((hit) => hit[1]!).sort();
}

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

/**
 * A SZEREP-LISTA IS TÜKÖR, ÉS EDDIG SENKI NEM MÉRTE.
 *
 * A mobil app saját `UserRole` uniót tart, és rá EXHAUSTIVE `Record`-okat épít
 * (`ROLE_CAPABILITIES`, `userRoleLabel`). Amíg a két lista egyezik, ez a
 * másolat biztonságos: a fordító a telefonon minden szerephez kikényszerít egy
 * sort. Ha a szerver kap egy ÚJ EMBERI szerepet, és a mobil unió nem tud róla,
 * a telefon FORDUL, és futásidőben ad `undefined` képességet arra a szerepre --
 * egy `Record` kulcs nélkül nem hibázik, csak nem válaszol.
 *
 * A GÉPI SZEREPEK SZÁNDÉKOSAN KIMARADNAK. Egy ágens-fiók nem jelentkezik be a
 * telefonon: nincs jelszava, és a tokene csak egy szerver-végpontot nyit. Ha
 * mégis felvennénk a mobil unióba, minden képesség-táblát ki kellene tölteni
 * egy szerepre, ami ott soha nem fordul elő -- az a felület tágítása lenne,
 * cserébe semmiért.
 *
 * MI PIROSÍT: egy új emberi szerep a szerveren, amit a mobil tükör nem kapott
 * meg; és egy gépi szerep, ami mégis bekerült a telefonra.
 */
test("the mobile role mirror covers every human role, and no machine role", () => {
  const mobil = mirrorRoles();

  // A KONTROLL A KERESESRE, ugyanabbol az okbol, mint a kulcsoknal: ha a minta
  // nem talal semmit, az osszehasonlitas ket ures halmazon menne vegig.
  assert.ok(
    mobil.length >= 5,
    `Csak ${mobil.length} szerepet találtam a mobil unióban. Ez a keresés hibája, nem a tüköré.`,
  );

  assert.deepEqual(
    mobil,
    [...HUMAN_ROLES].sort(),
    "A mobil UserRole unió elcsúszott a szerver emberi szerepeitől. " +
      "Ha új emberi szerep van, vedd fel a mobil tükörbe is (és a képesség-táblákba).",
  );

  const gepi = mobil.filter((role) =>
    (MACHINE_ROLES as readonly string[]).includes(role),
  );
  assert.deepEqual(
    gepi,
    [],
    "Gépi szerep került a mobil tükörbe: " + gepi.join(", "),
  );
});
