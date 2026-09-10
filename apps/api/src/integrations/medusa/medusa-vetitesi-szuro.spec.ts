import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { TILTOTT_KOD_PAROSOK } from "./medusa-vetitesi-szuro.data.js";
import {
  indexelTiltoLista,
  tiltottKod,
  type TiltottKodParos,
} from "./medusa-vetitesi-szuro.js";

/**
 * A SZURO ALLITASAI. Amit itt merunk, az nem a lista TARTALMA, hanem a
 * szabaly: mikor sul el es mikor NEM.
 *
 * A lista maga adat, es kulon jon; ha ide masolnank belole, az allitasok a
 * katalogus valtozasatol pirosodnanak ki.
 */
describe("a vetitesi szuro parosa", () => {
  const LISTA: TiltottKodParos[] = [
    {
      sku: "AF_starterpack",
      ertek: "5902026731010",
      indok: "proba",
      mert: "2026-09-10",
    },
    {
      sku: "_190496",
      ertek: "710270148523",
      indok: "proba",
      mert: "2026-09-10",
    },
  ];
  const index = indexelTiltoLista(LISTA);

  it("a teljes paros egyezesenel tilt", () => {
    assert.equal(tiltottKod("AF_starterpack", "5902026731010", index), true);
  });

  /**
   * A LENYEG. Ugyanaz az ertek egy MASIK terméken NEM tiltott -- a legtobb
   * hibas ertek egy jogos gazda kodja, es azt a terméket nem nemitjuk el.
   */
  it("ugyanaz az ertek MASIK cikkszamon nem tiltott", () => {
    assert.equal(tiltottKod("_190495", "5902026731010", index), false);
  });

  /**
   * A MASODIK LENYEG: a szuro MAGATOL LEJAR. Ha a forrasban javul az ertek,
   * a paros nem egyezik, es a termek uj kodja akadalytalanul kimegy.
   */
  it("ugyanaz a cikkszam MASIK ertekkel nem tiltott", () => {
    assert.equal(tiltottKod("AF_starterpack", "5901234123457", index), false);
  });

  it("hianyzo cikkszam vagy ertek eseten nem tilt", () => {
    assert.equal(tiltottKod(null, "5902026731010", index), false);
    assert.equal(tiltottKod("AF_starterpack", null, index), false);
    assert.equal(tiltottKod("", "", index), false);
  });

  it("a korulvevo szokozok nem szamitanak", () => {
    assert.equal(
      tiltottKod(" AF_starterpack ", " 5902026731010 ", index),
      true,
    );
  });

  /**
   * ISMERT POZITIV KONTROLL AZ INDEXRE: a hianyos sorok kimaradnak, DE a
   * teljesek bent maradnak. Egy puszta "az ures sor nem kerul be" allitast egy
   * teljesen ures index is kielegitene.
   */
  it("a hianyos sorok kimaradnak, a teljesek bent maradnak", () => {
    const vegyes = indexelTiltoLista([
      { sku: "", ertek: "5902026731010", indok: "proba", mert: "2026-09-10" },
      { sku: "_190496", ertek: "", indok: "proba", mert: "2026-09-10" },
      {
        sku: "AF_starterpack",
        ertek: "5902026731010",
        indok: "proba",
        mert: "2026-09-10",
      },
    ]);
    assert.equal(vegyes.size, 1);
    assert.equal(tiltottKod("AF_starterpack", "5902026731010", vegyes), true);
  });

  /**
   * ES AMIT EZ AZ ALLITAS VED: egy ures sor NE tegyen tiltotta minden ertek
   * nelkuli terméket. Ez az a tulszures, amit egy darabszamon nem lehet
   * eszrevenni.
   */
  it("ures sor nem tilt le minden ertek nelkuli terméket", () => {
    const uressel = indexelTiltoLista([
      { sku: "", ertek: "", indok: "proba", mert: "2026-09-10" },
    ]);
    assert.equal(tiltottKod("barmi", "", uressel), false);
    assert.equal(tiltottKod("", "", uressel), false);
  });
});

/**
 * A BEKOTES -- ES AMIT EZ AZ ALLITAS-KESZLET NEM TUD.
 *
 * A vetites TORZSE ebben a repoban nem fut le tesztben (a runner-t a tobbi
 * spec is FORRASKENT olvassa), tehat a bekotesre nincs viselkedes-allitasom.
 * Ezert forrast olvasok, ugyanabban az alakban, ahogy a szomszedos specek.
 *
 * AMIT BIZONYIT: hogy a szuro be VAN kotve, es hogy a tiltott ag KULON sort
 * es KULON szamlalot kap.
 * AMIT NEM: hogy futaskor tenyleg visszatart egy erteket. Azt csak egy eles
 * vetites-futas mondja meg, es azt nem en inditom.
 */
describe("a szuro bekotese a vetitesbe", () => {
  const UT = "src/integrations/medusa/medusa-projection.runner.ts";

  it("a vetites betolti a listat, es a paros dontest atadja", async () => {
    const forras = await readFile(UT, "utf-8");

    assert.equal(forras.includes("betoltTiltoLista(out)"), true);
    assert.equal(
      forras.includes("tiltottKod(product.variants[0]?.sku, nyersVonalkod"),
      true,
    );
  });

  /**
   * A TILTOTT AG KULON SZAMLALOT ES KULON SORT KAP. Ha valaki osszevonja az
   * ismetlodessel, a naplo ket kulonbozo teendot mond ugyanazzal a szoval.
   */
  it("a tiltott ag kulon szamlalon es kulon soron all", async () => {
    const forras = await readFile(UT, "utf-8");

    assert.equal(forras.includes("let tiltottVonalkod = 0;"), true);
    assert.equal(forras.includes("describeBlockedBarcode("), true);
    assert.equal(forras.includes("a vetítési szűrő miatt"), true);
  });

  /**
   * ISMERT POZITIV KONTROLL A KERESESRE: a fajlt tenyleg beolvastuk, es all
   * benne a REGI ag is. Enelkul egy elgepelt utvonal nulla talalatot adna, es
   * a fenti ket allitas hamisan bukna el -- vagy ami rosszabb, egy elrontott
   * minta mellett hamisan menne at.
   */
  it("a forras olvashato, es a regi ismetlodes-ag is all benne", async () => {
    const forras = await readFile(UT, "utf-8");

    assert.equal(forras.includes("describeSkippedBarcode("), true);
    assert.equal(forras.includes("let kihagyottVonalkod = 0;"), true);
  });
});

/**
 * A VALODI LISTA MINOSEGE -- NEM A TARTALMA.
 *
 * Ezek az allitasok NEM azt merik, mi all a listan (az adat, es a katalogus
 * valtozasaval valtozik), hanem hogy minden sor MEGFEJTHETO marad: van indoka
 * es van meresi datuma. A tipus ezt mar kikenyszeriti forditaskor; ez a
 * szakasz azt fogja meg, ha valaki egy URES sztringgel elegiti ki.
 *
 * A DARABSZAMOT SZANDEKOSAN NEM ALLITOM. Egy "84" a tesztben azt jelentene,
 * hogy a lista minden jogos valtozasa pirosat ad -- es akkor a szam atirasa
 * valna reflexsze, nem a lista atgondolasa.
 */
describe("a valodi tilto lista minosege", () => {
  it("nem ures, es minden soron all indok es meresi datum", () => {
    assert.equal(TILTOTT_KOD_PAROSOK.length > 0, true);

    for (const sor of TILTOTT_KOD_PAROSOK) {
      assert.equal(sor.sku.trim().length > 0, true);
      assert.equal(sor.ertek.trim().length > 0, true);
      assert.equal(sor.indok.trim().length > 0, true);
      assert.match(sor.mert, /^\d{4}-\d{2}-\d{2}$/);
    }
  });

  /**
   * ISMETLODO PAROS NINCS. Ez a lista GENERALT, es egy ujragenaralas
   * duplikalhat -- a szuro ettol nem romlana el, de a darabszam hazudna, es
   * azon a szamon meruk le, mekkora a halmaz.
   */
  it("egy paros csak egyszer szerepel", () => {
    const kulcsok = TILTOTT_KOD_PAROSOK.map(
      (sor) => `${sor.sku.trim()} ${sor.ertek.trim()}`,
    );
    assert.equal(new Set(kulcsok).size, kulcsok.length);
  });
});
