import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { hasPermission, PERMISSIONS } from "@acropora/types";

import {
  assignableUserWhere,
  SERVICE_ASSIGNABLE_ROLES,
} from "./service-assignment.js";

/**
 * KIT LEHET SZERVIZ-MUNKÁRA KIOSZTANI -- ÉS A KÉRDÉS NEM AZ, HOGY KINEK VAN JOGA.
 *
 * Balázs jelzése (2026-09-17, mobilalkalmazás szál, szó szerint): „A munkalapon
 * mobilon tudok felelőst hozzáadni. Viszont ott megjelenik ampartner felhasználó
 * is akinek nem kellene".
 *
 * A szabály a `service.manage` jogból számolt, és a `PARTNER_SERVICE` szerep azt
 * megkapja -- a saját hatókörében joggal. Vagyis a partner-fiók megjelent a
 * választóban, ÉS ki is lehetett osztani rá a lapot: az író út ugyanebből a
 * listából ellenőrzött.
 *
 * A SZABÁLY NEM TÉVEDETT, HANEM MÁSRA KÉRDEZETT. Ez a fájl azt méri, hogy most
 * arra kérdez, amire kell.
 */
describe("SERVICE_ASSIGNABLE_ROLES", () => {
  /**
   * A LÉNYEGI ÁLLÍTÁS. MI PIROSÍT: a partner-szűrés elhagyása, vagyis a
   * 2026-09-17 előtti alak.
   */
  it("a partner-szerep nincs benne, holott a joga megvan", () => {
    // AZ ELOFELTETEL IS ALLITAS: ha a partner egyszer elveszitene a jogot, ez a
    // teszt CSENDBEN trivialissa valna -- akkor a kizarast mar a jog vegezne, es
    // senki nem venne eszre, hogy a nevesitett szures feleslegesse vagy eppen
    // hianyossa valt.
    assert.equal(
      hasPermission("PARTNER_SERVICE", PERMISSIONS.SERVICE_MANAGE),
      true,
      "a partner elvesztette a service.manage jogot: ez a teszt ettől már nem azt méri, amit",
    );
    assert.equal(SERVICE_ASSIGNABLE_ROLES.includes("PARTNER_SERVICE"), false);
  });

  /**
   * POZITÍV KONTROLL: A BELSŐS SZEREPEK TOVÁBBRA IS KIOSZTHATÓK.
   *
   * Enélkül egy ÜRES lista is zöld lenne -- és akkor senkit sem lehetne
   * felelősnek tenni, ami sokkal nagyobb kár, mint az, amit javítunk.
   */
  it("kontroll: a szerelő és a vezetői szerepek kioszthatók maradnak", () => {
    assert.ok(SERVICE_ASSIGNABLE_ROLES.includes("SERVICE"));
    assert.ok(
      SERVICE_ASSIGNABLE_ROLES.length >= 2,
      `gyanúsan rövid lista: ${SERVICE_ASSIGNABLE_ROLES.join(", ")}`,
    );
    // ES MINDEGYIKNEK MEGVAN A JOGA: a szures szukit, nem valt masik kerdesre.
    for (const role of SERVICE_ASSIGNABLE_ROLES)
      assert.equal(hasPermission(role, PERMISSIONS.SERVICE_MANAGE), true);
  });

  /**
   * A VIEWER LÁTJA A LAPOT, DE NEM ÍR RÁ. Kiosztva megkapná az értesítést,
   * megnyitná a lapot, és nem tudna rögzíteni semmit -- ez a MÁSIK tengely,
   * amit a partner-szűrés nem helyettesít.
   */
  it("a néző szerep kimarad, mert nem tud dolgozni a lapon", () => {
    assert.equal(hasPermission("VIEWER", PERMISSIONS.SERVICE_VIEW), true);
    assert.equal(SERVICE_ASSIGNABLE_ROLES.includes("VIEWER"), false);
  });
});

describe("assignableUserWhere", () => {
  /**
   * A KÖTÉS IS FELTÉTEL, NEM CSAK A SZEREP.
   *
   * A két tengely külön mechanizmus: a szerep TÍPUS-szintű tény, a kötés a SOR
   * tulajdonsága. Ma egybeesnek (kötött fiók kötelezően `PARTNER_SERVICE`, és
   * kötés nélkül az a szerep nem is létezhet), de ha az egyik valaha enged, a
   * másik még áll.
   */
  it("a kötött fiókot a szerepén kívül a kötése is kizárja", () => {
    const where = assignableUserWhere();
    assert.equal(where.customerId, null);
    assert.equal(where.supplierId, null);
  });

  it("csak aktív fiók kapható meg, és csak kiosztható szereppel", () => {
    const where = assignableUserWhere();
    assert.equal(where.isActive, true);
    assert.deepEqual(where.role, { in: [...SERVICE_ASSIGNABLE_ROLES] });
  });

  /**
   * MIND A HÁROM LEKÉRDEZÉS EBBŐL DOLGOZIK -- ÉS EZT A SZÁM MONDJA KI.
   *
   * A kalibráció hozta elő: ha az egyik hívó visszatér a saját, kézzel írt
   * `where`-jére, a fenti állítások VÉGIG ZÖLDEK maradnak. Azok a FÜGGVÉNYT
   * mérik, nem a BEKÖTÉSÉT -- a bekötéshez adatbázis kellene.
   *
   * A három hely: a választó listája, a munkalap-mentés ellenőrzése, és a
   * hibajegy-delegálás. A második a súlyosabb: az író út.
   *
   * HA EZ A SZÁM ELMOZDUL, az döntés, nem hiba. Négy hívónál a szám megy
   * feljebb; háromnál lejjebb viszont azt jelenti, hogy valaki KIVETTE a közös
   * feltételt -- és akkor a neve is látszik a diffen.
   *
   * A KOMMENTEKET KISZEDJÜK: a fenti magyarázó mondatok ugyanazt a nevet
   * használják, amit a keresés keres.
   */
  it("mind a három lekérdezés a közös feltételt használja", () => {
    const kod = (ut: string) =>
      readFileSync(ut, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");

    const fajlok = [
      "src/worksheets/worksheets.repository.ts",
      "src/service-jobs/service-jobs.repository.ts",
    ];
    // POZITIV KONTROLL A BEOLVASASRA: rossz utvonalnal a szamlalas nullat adna,
    // es egy nullara allitott varakozas mellett ez zolden atmenne.
    for (const ut of fajlok)
      assert.ok(kod(ut).length > 2000, `${ut}: üres vagy gyanúsan rövid`);

    const db = fajlok
      .map((ut) => kod(ut).split("assignableUserWhere(").length - 1)
      .reduce((a, b) => a + b, 0);
    assert.equal(
      db,
      3,
      `a közös feltétel ${db} helyen áll: a választó listája, a munkalap-mentés ellenőrzése és a hibajegy-delegálás kell`,
    );
  });
});
