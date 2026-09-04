import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareQueuedUpdate,
  rebuildResolvedPatch,
  resolutionIsEmpty,
  type CurrentAssetLike,
} from "./asset-conflict-resolution";
import type { UpdateAssetInput } from "../assets/asset-fields";

/**
 * A MÉRCE: A SZERELŐ DÖNTÉSE PONTOSAN AZ LEGYEN, AMI TÖRTÉNIK.
 *
 * Két néma vesztés van a közelben, és mindkettőre külön állítás van:
 *  - a nem választott mező TÖRLÉSSÉ változna (`null`), ha a törzsbe kerülne,
 *  - az elavult verzió bennmaradna, és a küldés ugyanazt a 409-et kapná.
 */

const most: CurrentAssetLike = {
  updatedAt: "2026-09-04T16:00:00Z",
  status: "IN_REPAIR",
  criticality: "HIGH",
  manufacturer: "Wilo",
  model: null,
  serialNumber: null,
  inventoryNumber: null,
  description: null,
  notes: null,
  unit: { id: "unit-2", name: "Gépház" },
};

const torzs: UpdateAssetInput = {
  expectedUpdatedAt: "2026-09-04T08:00:00Z",
  manufacturer: "Grundfos",
  status: "ACTIVE",
};

describe("mi az enyém és mi a másiké", () => {
  it("CSAK azokat a mezőket sorolja, amiket a szerelő átírt", () => {
    /*
      A torzs eleve csak a megvaltozott mezoket viszi. Egy teljes mezolista azt
      kerdezne a szerelotol, amihez hozza sem nyult -- es a sajat javitasai
      elvesznenek a sorok kozott.

      MI PIROSIT: ha a lista a MEZO-lekepezesbol indulna a torzs helyett.
    */
    const rows = compareQueuedUpdate({ patch: torzs, current: most });

    assert.deepEqual(
      rows.map((r) => r.field),
      ["status", "manufacturer"],
    );
  });

  it("mindkét oldalt OLVASHATÓ alakban adja, nem kódként", () => {
    const rows = compareQueuedUpdate({ patch: torzs, current: most });
    const statusz = rows.find((r) => r.field === "status");

    assert.equal(statusz?.mine, "Aktív");
    assert.equal(statusz?.theirs, "Javítás alatt");
  });

  it("az EGYEZŐ mező is a listán marad, csak nem tér el", () => {
    /*
      A MODUL MINDEN ATIRT MEZOT VISSZAAD; hogy a kepernyo melyiket KERDEZI meg,
      azt a `conflicting` donti el, nem ez a lista. Igy a keperno tud
      osszefoglalo sort mutatni azokrol, amik magutol atmennek.
    */
    const rows = compareQueuedUpdate({
      patch: {
        expectedUpdatedAt: torzs.expectedUpdatedAt,
        manufacturer: "Wilo",
      },
      current: most,
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.differs, false);
  });

  it("CSAK ott ütközik, ahol MÁS is hozzányúlt", () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN, ES EGY MERT TERVEZESI HIBAT KOT
      LE (acrobot kikotese, 2026-09-04).

      Az elso valtozat a beirt es a MOSTANI erteket vetette ossze, es minden
      atirt mezorol kerdezett. Ha a szerelo Wilorol Grundfosra irta at a gyartot
      es RAJTA KIVUL SENKI nem nyult hozza, a friss eszkozon meg mindig Wilo
      all: elteres van, utkozes NINCS. A regi keperno megkerdezte volna, es ha a
      szerelo zavaraban a masikat valasztja, a SAJAT javitasa tunik el csendben.

      MI PIROSIT: ha az utkozes megint a beirt es a mostani ertek kulonbsegebol
      szuletik.
    */
    const rows = compareQueuedUpdate({
      patch: torzs,
      current: most,
      // A szerelo Wilot latott a gyartonal, es azt latja MOST is: nem utkozes.
      // A statuszt viszont ACTIVE-nek latta, es most IN_REPAIR all: utkozes.
      base: { manufacturer: "Wilo", status: "ACTIVE" },
    });

    const gyarto = rows.find((r) => r.field === "manufacturer");
    const statusz = rows.find((r) => r.field === "status");

    assert.equal(gyarto?.differs, true, "a beirt ertek elter a mostanitol");
    assert.equal(gyarto?.conflicting, false, "de mas nem nyult hozza");
    assert.equal(statusz?.conflicting, true);
  });

  it("ALAPÉRTÉK NÉLKÜL mindent ütközőnek vesz", () => {
    /*
      A mezo elott sorba tett modositasokon nincs alapertek, tehat NEM TUDJUK.
      Ilyenkor a keperno TOBBET kerdez a kelletenel -- kellemetlen, de semmit
      nem hallgat el. A forditott alapertelmezes CSENDBEN felulirna valaki mas
      szandekos valtoztatasat.

      MI PIROSIT: ha a hianyzo alapertek "nincs utkozes"-t jelentene.
    */
    const rows = compareQueuedUpdate({ patch: torzs, current: most });

    assert.equal(
      rows.every((r) => r.conflicting),
      true,
    );
  });

  it("a HELYSZÍN ütközését az AZONOSÍTÓ dönti el, nem a név", () => {
    /*
      A torzs azonositot visz, a keperno nevet mutat. Ha az utkozes a NEVEN
      dolne el, egy ATNEVEZETT helyszin valtozasnak latszana, holott ugyanaz a
      helyszin -- es a szerelo egy nem letezo utkozest oldana fel.
    */
    const rows = compareQueuedUpdate({
      patch: { expectedUpdatedAt: "x", departmentId: "unit-9" },
      current: most,
      unitNames: { "unit-2": "Kazánház", "unit-9": "Pince" },
      base: { departmentId: "unit-2" },
    });

    // A nev MAS ("Kazánház" a "Gépház" helyett), az azonosito UGYANAZ.
    assert.equal(rows[0]!.conflicting, false);
  });

  it("az ÜRES szöveg és a hiány UGYANAZ az állapot", () => {
    /*
      A szerver a torlest `null`-kent tarolja, egy urlap viszont ures
      karakterlancot adhat. Ha a kettot megkulonboztetnenk, egy ures mezo
      "valtozasnak" latszana, es a szerelo egy nem letezo utkozest oldana fel.
    */
    const rows = compareQueuedUpdate({
      patch: { expectedUpdatedAt: "x", model: "X-200" },
      current: most,
      base: { model: "" },
    });

    assert.equal(rows[0]!.conflicting, false);
  });

  it("az ÜRES értéknek NEVE van, nem üres cella", () => {
    /*
      Egy ures cella nem mondja meg, hogy TORLESROL van szo. A szerelo epp azt
      donti el, hogy a sajat torlese maradjon-e.
    */
    const rows = compareQueuedUpdate({
      patch: { expectedUpdatedAt: torzs.expectedUpdatedAt, manufacturer: null },
      current: most,
    });

    assert.equal(rows[0]!.mine, "nincs megadva");
    assert.equal(rows[0]!.theirs, "Wilo");
  });

  it("a HELYSZÍN nevét mutatja, ha ismerjük, és az azonosítót, ha nem", () => {
    /*
      A torzsben azonosito all, mert a szerver azt varja. Egy `unit_01M...`
      alaku karakterlanc a kepernyon nem dontest segit.

      ES A VISSZAESES NEM AZ URES SZOVEG: az azt mondana, hogy a szerelo torolni
      akarja a helyszint -- pedig epp beallitott egyet.
    */
    const nevvel = compareQueuedUpdate({
      patch: { expectedUpdatedAt: "x", departmentId: "unit-9" },
      current: most,
      unitNames: { "unit-9": "Pince" },
    });
    assert.equal(nevvel[0]!.mine, "Pince");
    assert.equal(nevvel[0]!.theirs, "Gépház");

    const nev_nelkul = compareQueuedUpdate({
      patch: { expectedUpdatedAt: "x", departmentId: "unit-9" },
      current: most,
    });
    assert.equal(nev_nelkul[0]!.mine, "unit-9");
  });

  it("ISMERETLEN kódot kiír, nem nyel el", () => {
    /*
      Ha a szerver egyszer uj statuszt vezet be, a lekepezes nem ismeri. Egy
      ures cella azt mondana, hogy nincs ertek -- holott van, csak nem tudjuk a
      nevet.
    */
    const rows = compareQueuedUpdate({
      patch: { expectedUpdatedAt: "x", status: "MOTHBALLED" as never },
      current: most,
    });

    assert.equal(rows[0]!.mine, "MOTHBALLED");
  });
});

describe("mi megy el a feloldás után", () => {
  it("a FRISS verzió kerül a törzsbe", () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN. Amig a regi, elavult verzio ott
      all, a kuldes ugyanazt a 409-et kapja vissza -- a feloldas nem attol
      mukodik, hogy a szerelo valasztott, hanem ettol a mezotol.

      MI PIROSIT: ha az ujraepites atviszi a regi `expectedUpdatedAt` erteket.
    */
    const uj = rebuildResolvedPatch({
      patch: torzs,
      keepMine: ["manufacturer"],
      freshUpdatedAt: most.updatedAt,
    });

    assert.equal(uj.expectedUpdatedAt, "2026-09-04T16:00:00Z");
  });

  it("amit a szerelő NEM tart meg, az KIMARAD, nem nullázódik", () => {
    /*
      A hianyzo mezo azt jelenti, hogy "hagyd beken"; a `null` azt, hogy
      "torold". Ha a nem valasztott mezoket null-ra irnank, a szerelo dontese
      ("maradjon a masike") TORLESSE valtozna -- pontosan az ellenkezojeve.

      MI PIROSIT: egy alak, ami minden mezot atvisz, es a nem valasztottakat
      null-ra allitja.
    */
    const uj = rebuildResolvedPatch({
      patch: torzs,
      keepMine: ["manufacturer"],
      freshUpdatedAt: most.updatedAt,
    });

    assert.equal("status" in uj, false);
    assert.equal(uj.manufacturer, "Grundfos");
  });

  it("a megtartott TÖRLÉS törlés marad", () => {
    /*
      TESTVER-KONTROLL a fentihez: egy "csak az igaz ertekeket vidd" alaku
      masolas CSENDBEN elhagyna a torleseket, es a fenti allitason atmenne.
    */
    const uj = rebuildResolvedPatch({
      patch: { expectedUpdatedAt: "regi", manufacturer: null },
      keepMine: ["manufacturer"],
      freshUpdatedAt: most.updatedAt,
    });

    assert.equal("manufacturer" in uj, true);
    assert.equal(uj.manufacturer, null);
  });

  it("ha MINDENT a másikénak hagy, a törzs ÜRES, és ezt ki lehet mondani", () => {
    /*
      Egy ures torzs kuldese annyit tenne, hogy megerintjuk a rekordot: a
      `updatedAt` mozdulna anelkul, hogy barmi valtozna. A helyes lepes ilyenkor
      az ELVETES, es a kepernyonek ezt kell felkinalnia.
    */
    const uj = rebuildResolvedPatch({
      patch: torzs,
      keepMine: [],
      freshUpdatedAt: most.updatedAt,
    });

    assert.equal(resolutionIsEmpty(uj), true);
    // ISMERT POZITIV: egy nem ures torzsre hamis, kulonben az allitas halott.
    assert.equal(
      resolutionIsEmpty({ expectedUpdatedAt: "x", notes: "valami" }),
      false,
    );
  });
});
