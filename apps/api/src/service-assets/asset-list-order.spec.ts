import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { assetListOrderBy } from "./asset-list-order.js";

/**
 * A sema, ahol az allapotok SORRENDJE all. A Postgres enum a deklaracio
 * sorrendjeben rendez, tehat ez a fajl maga a rendezesi szabaly.
 *
 * AZ UTVONAL A MUNKAKONYVTARHOZ KEPEST all (`apps/api`), nem a modulhoz kepest,
 * es ezt mertem, nem feltetelezem: a forditott fajl a `test-dist/` ala kerul,
 * tehat a modul-relativ alak egy nem letezo `apps/api/packages/...` utra mutat.
 * Ugyanaz a minta, amit a tobbi forrast olvaso spec hasznal ebben a repoban.
 */
const SEMA = "../../packages/database/prisma/schema.prisma";

/**
 * AZ ESZKOZ-LISTA RENDEZESE.
 *
 * TISZTA FUGGVENY, ADATBAZIS NELKUL MERHETO -- es ez nem kenyelem: a rendezes
 * HELYE a kerdes (szerver kontra bongeszo), a rendezes ALAKJA pedig egy
 * leiro objektum, amit a Prisma kap. Mindketto eldol az adatbazis elott.
 *
 * AMIT EZ NEM MER: hogy a Postgres tenylegesen ebben a sorrendben adja vissza a
 * sorokat. Az az integracios sor dolga; ez az allitas arrol szol, hogy MIT
 * kerunk tole.
 */
describe("az eszköz-lista rendezése", () => {
  /**
   * A PARAMETER NELKULI HIVAS A MAI SORRENDET ADJA, BETURE.
   *
   * Ez a legfontosabb allitas a fajlban, es a legkonnyebb kihagyni: a
   * rendezes BEVEZETESE nem valtoztathatja meg azt, amit a mai hivok latnak.
   * Egy elcsuszott alapertelmezes minden meglevo kepernyon mas sorrendet adna,
   * es senki nem keresne a rendezesnel.
   */
  it("paraméter nélkül a mai alapértelmezést adja", () => {
    assert.deepEqual(assetListOrderBy(undefined, undefined), [
      { name: "asc" },
      { id: "asc" },
    ]);
  });

  it("név szerint, mindkét irányban", () => {
    assert.deepEqual(assetListOrderBy("name", "asc"), [
      { name: "asc" },
      { id: "asc" },
    ]);
    assert.deepEqual(assetListOrderBy("name", "desc"), [
      { name: "desc" },
      { id: "asc" },
    ]);
  });

  /**
   * AZ ALLAPOT A SEMA SORRENDJEBEN MEGY, NEM BETURENDBEN -- es az allitas
   * ugyanezt a szabalyt a SEMAN is meri, nem csak a leiro objektumon.
   *
   * MIERT KELL A SEMA-ELLENORZES IS: a leiro objektum akkor is helyes marad,
   * ha valaki uj allapotot vesz fel az enum KOZEPERE. A rendezes viszont
   * megvaltozik, csendben, mert a Postgres a deklaracio sorrendjet hasznalja.
   * Egy allitas, ami csak a `{ status: "asc" }` alakot nezi, ezt nem tudja
   * pirosra valtani.
   */
  it("állapot szerint, és a séma sorrendje az, ami értelmes utat ír le", () => {
    assert.deepEqual(assetListOrderBy("status", "asc"), [
      { status: "asc" },
      { name: "asc" },
      { id: "asc" },
    ]);

    // A MASODIK FELE AZ, AMI TENYLEG OR: az elso allitas akkor is zold marad,
    // ha valaki uj allapotot vesz fel az enum KOZEPERE, es ettol a lista
    // sorrendje csendben megvaltozik.
    //
    // ES EZ MEG IS TORTENT, 2026-09-16: a `OUT_OF_SERVICE` helyere KET ertek
    // lepett, epp az enum kozepere. Ez az allitas pirosra fordult, es a helyuk
    // TUDATOS dontes lett, nem a beirasuk sorrendje:
    //
    //   a MELEG ELOBB ALL, MINT A HIDEG, mert tobbet allit -- egy meleg
    //   tartalek azonnal a helyere allithato, egy hideg nem. A sor igy tovabbra
    //   is csokkeno rendelkezesre allast ir le, ahogy a regi negy ertek.
    //
    // Beturendben a `COLD` elozne meg a `WARM`-ot, tehat a lista elejere a
    // KEVESBE elerheto eszkoz kerulne -- pontosan az, amit ez a rendezes kerul.
    const sema = readFileSync(SEMA, "utf8");
    const blokk = /enum AssetStatus \{([^}]*)\}/.exec(sema);
    assert.ok(blokk, "nem találtam az AssetStatus enumot a sémában");
    assert.deepEqual(
      blokk[1]!
        .split("\n")
        .map((sor) => sor.trim())
        .filter(Boolean),
      ["ACTIVE", "WARM_STANDBY", "COLD_STANDBY", "IN_REPAIR", "RETIRED"],
      "az állapotok sorrendje a sémában adja a lista sorrendjét, és megváltozott",
    );
  });

  /**
   * AZ ELHELYEZES KET KULCSON MEGY, mert a tulajdonos POLIMORF: egy eszkoz vagy
   * partnerhez, vagy vevohoz tartozik, tehat nincs egyetlen oszlop a lathato
   * nevvel.
   *
   * AZ IRANY MINDKET KULCSON FORDUL. Ha csak az elson fordulna, a csokkeno
   * rendezes a partnereket visszafele, a vevoket viszont elorefele adna -- egy
   * olyan sorrend, ami sehol nem latszik hibanak, de senki nem tudja elolvasni.
   */
  it("elhelyezés szerint mindkét tulajdonos-ágon fordul az irány", () => {
    assert.deepEqual(assetListOrderBy("placement", "asc"), [
      { supplier: { name: "asc" } },
      { customer: { displayName: "asc" } },
      { name: "asc" },
      { id: "asc" },
    ]);
    assert.deepEqual(assetListOrderBy("placement", "desc"), [
      { supplier: { name: "desc" } },
      { customer: { displayName: "desc" } },
      { name: "asc" },
      { id: "asc" },
    ]);
  });

  /**
   * A MASODLAGOS KULCS MINDIG AZ `id`, ES EZ LAPOZASI FELTETEL, NEM SZEPSEG.
   *
   * Ha ket sor elso kulcsa egyenlo (ket azonos nevu eszkoz, vagy barmelyik
   * allapot-csoport huszonot sornal tobbel), a rendezetlen dontes LAPOK KOZOTT
   * is elcsuszhat: ugyanaz a sor megjelenhet a masodik lapon is, egy masik
   * pedig kimaradhat -- es a felhasznalo azt latja, hogy egy eszkoz eltunt.
   *
   * EGY ALLITAS MIND A NEGY ALAKRA, mert a stabilitas nem a valasztott
   * oszloptol fugg.
   */
  it("minden rendezés stabil: az utolsó kulcs mindig az azonosító", () => {
    for (const rendezes of [undefined, "name", "status", "placement"] as const)
      for (const irany of ["asc", "desc"] as const) {
        const kulcsok = assetListOrderBy(rendezes, irany);
        assert.deepEqual(
          kulcsok.at(-1),
          { id: "asc" },
          `${rendezes ?? "alapértelmezés"} / ${irany}: hiányzik a stabil kulcs`,
        );
      }
  });

  /**
   * AZ ISMERETLEN ERTEK NEM DOB, HANEM VISSZAESIK.
   *
   * A DTO `@IsIn` ellenorzese mar elvagja a rossz erteket, tehat ide szabalyos
   * uton nem jut el semmi -- de ez a fuggveny TISZTA, es mas hivoja is lehet.
   * A visszaeses a mai alapertelmezesre a helyes valasz: egy dobott kivetel
   * egy LISTA-lekerdezest allitana meg egy rendezesi reszlet miatt.
   */
  it("ismeretlen oszlopra az alapértelmezésre esik vissza", () => {
    assert.deepEqual(assetListOrderBy("ismeretlen" as never, "asc"), [
      { name: "asc" },
      { id: "asc" },
    ]);
  });
});
