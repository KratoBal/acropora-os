import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { TILTOTT_KOD_PAROSOK } from "./medusa-vetitesi-szuro.data.js";
import {
  indexelTiltoLista,
  tiltottKod,
  tiltottKodBarmelyikValtozaton,
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
    /*
      A HIVAS ALAKJA 2026-09-10-EN MEGVALTOZOTT, ES EZT AZ ALLITAS FOGTA MEG.

      Eredetileg `tiltottKod(product.variants[0]?.sku, ...)` allt itt. A mezo
      viszont TERMEK-szintu (a szinkron minden valtozat-sorra ugyanazt masolja),
      tehat a paros barmelyik aktiv valtozat cikkszamaval egyezhet. Amikor a
      hivast atirtam, EZ az allitas valtott pirosra -- nem a szemem vette eszre,
      hogy a bekotes megvaltozott.
    */
    assert.equal(forras.includes("tiltottKodBarmelyikValtozaton("), true);
    assert.equal(
      forras.includes("product.variants.map((valtozat) => valtozat.sku)"),
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

/**
 * A SZURO MERLEGE A KIMENETBEN -- ES MIERT KET SZAM, NEM EGY.
 *
 * Forras-olvaso allitasok, ugyanabban az idiomaban, mint a bekotes-szakasz: a
 * vetites torzse ebben a repoban nem fut le tesztben.
 *
 * A "84 parosbol 0 illeszkedett" onmagaban ketfelet jelent: vagy nincs mar
 * tiltott ertek a katalogusban, vagy a futas KET termeket nezett meg. A ket
 * szam egyutt eldontheto -- ezert all rá KULON allitas, hogy a masodik szam
 * (a megnezett termekek) ki ne essen egy kesobbi egyszerusitesben.
 */
describe("a szuro merlege a futas vegen", () => {
  const UT = "src/integrations/medusa/medusa-projection.runner.ts";

  it("a merleg MIND A KET szamot kiirja", async () => {
    const forras = await readFile(UT, "utf-8");

    assert.equal(forras.includes("let megnezettTermek = 0;"), true);
    assert.equal(forras.includes("megnezettTermek += 1;"), true);
    assert.equal(forras.includes("${tiltoIndex.size} párosából"), true);
    assert.equal(forras.includes("${megnezettTermek} terméket érintett"), true);
  });

  /**
   * A MERLEG NEM FELTETELES. Ez a lenyeg: a tobbi sor esemenyt jelent, ez
   * ALLAPOTOT. Egy halott lista-sor semmilyen esemenyt nem valt ki, tehat csak
   * itt jelenhet meg -- ha valaki `if (tiltottVonalkod)` moge teszi, a nulla
   * eset megint nema lesz.
   */
  it("a merleg akkor is kiirodik, ha nulla illeszkedett", async () => {
    const forras = await readFile(UT, "utf-8");

    const merleg = forras.indexOf("A vetítési szűrő ${tiltoIndex.size}");
    assert.equal(merleg > 0, true);

    /* A merleg ELOTT allo utolso `if` nem a tiltott szamlalora szol. */
    const elotte = forras.slice(0, merleg);
    const utolsoIf = elotte.lastIndexOf("if (tiltottVonalkod)");
    assert.equal(utolsoIf === -1 || merleg - utolsoIf > 400, true);
  });
});

/**
 * A PAROS BARMELYIK VALTOZAT CIKKSZAMAVAL EGYEZHET.
 *
 * === MIERT KELL, HOLOTT MA NEM SUL EL ===
 *
 * A teszt adatbazison mind a 84 lista-cikkszam EGYVALTOZATOS termeken all
 * (acrobot merese, 2026-09-10): "tobb valtozatos termek: 0", "nem elso
 * valtozat: 0", es a kontroll szerint a lekerdezes KEPES lenne tobbet talalni
 * (1896 termekbol 9 tobb valtozatos).
 *
 * Vagyis a kulonbseg a TESZT adaton nem merheto. Az ELES katalogusra viszont
 * nincs meresunk -- a flottanak ma nincs hozzaferese --, es a mezo
 * TERMEK-szintu: a szinkron minden valtozat-sorra ugyanazt az erteket masolja,
 * mikozben a vetites az ELSO valtozatet olvassa.
 *
 * Ezek az allitasok tehat NEM egy mert hibat zarnak be, hanem egy mert
 * MECHANIZMUST kovetnek. Ezt kimondom, mert egy allitas, ami ma nem tud
 * elbukni a valodi adaton, konnyen latszik feleslegesnek -- a fixtura viszont
 * pontosan azt az esetet allitja elo, ami elesben elofordulhat.
 */
describe("a paros barmelyik valtozat cikkszamaval", () => {
  const index = indexelTiltoLista([
    {
      sku: "MASODIK_VALTOZAT",
      ertek: "5902026731010",
      indok: "proba",
      mert: "2026-09-10",
    },
  ]);

  it("akkor is tilt, ha a lista a MASODIK valtozat cikkszamat nevezi meg", () => {
    assert.equal(
      tiltottKodBarmelyikValtozaton(
        ["ELSO_VALTOZAT", "MASODIK_VALTOZAT"],
        "5902026731010",
        index,
      ),
      true,
    );
  });

  /**
   * ES A REGI ALAK EZT NEM FOGTA VOLNA MEG: az elso valtozat cikkszamaval
   * kerdezve a paros nem egyezik, es a hibas ertek kimenne -- holott a termeken
   * MINDENHOL ugyanaz all.
   */
  it("a regi, elso-valtozatos alak ugyanezt ATENGEDNE", () => {
    assert.equal(tiltottKod("ELSO_VALTOZAT", "5902026731010", index), false);
  });

  /**
   * A TAGITAS NEM LEP AT TERMEK-HATART: egy MASIK termek valtozatai nem
   * egyeznek, barmennyi van belolük. Enelkul ez az allitas-keszlet egy
   * mindig-igazat ado fuggvenyt is kielegitene.
   */
  it("masik termek cikkszamaival NEM tilt", () => {
    assert.equal(
      tiltottKodBarmelyikValtozaton(
        ["IDEGEN_A", "IDEGEN_B"],
        "5902026731010",
        index,
      ),
      false,
    );
  });

  it("ures lista es hianyzo cikkszamok eseten nem tilt", () => {
    assert.equal(
      tiltottKodBarmelyikValtozaton([], "5902026731010", index),
      false,
    );
    assert.equal(
      tiltottKodBarmelyikValtozaton([null, undefined], "5902026731010", index),
      false,
    );
  });
});
