import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  decideMedusaBarcode,
  describeSkippedBarcode,
  hasValidCheckDigit,
  vonalkodAlakjai,
  vonalkodSorKiirhato,
} from "./medusa-barcode.policy.js";

describe("hasValidCheckDigit", () => {
  /**
   * ISMERT POZITIV ES NEGATIV KONTROLL EGY TESZTBEN, es ez az egyetlen hely,
   * ahol egybe tartoznak: a kettonek EGYUTT van jelentese. Egy fuggveny, ami
   * mindig igazat ad, atmenne a pozitiv eseten; egy, ami mindig hamisat, a
   * negativon. Csak a par zarja ki mind a kettot.
   */
  it("elfogad egy valodi EAN-13-at, es elutasitja ugyanazt elrontva", () => {
    assert.equal(hasValidCheckDigit("4006381333931"), true);
    assert.equal(hasValidCheckDigit("4006381333932"), false);
  });

  it("elfogadja a 12 jegyu UPC-A alakot is", () => {
    // 036000291452 -- szabvanyos UPC-A pelda.
    assert.equal(hasValidCheckDigit("036000291452"), true);
  });

  it("elutasitja a nem szabvanyos hosszt es a nem szamjegyet", () => {
    assert.equal(hasValidCheckDigit("9873109230"), false); // 10 jegy
    assert.equal(hasValidCheckDigit("core7_otherm_bulk"), false);
    assert.equal(hasValidCheckDigit(""), false);
  });
});

describe("decideMedusaBarcode", () => {
  it("a 13 jegyu ervenyes kod az ean mezobe megy", () => {
    const dontes = decideMedusaBarcode("4006381333931", 1);

    assert.equal(dontes.kind, "ean");
    assert.equal(dontes.field, "ean");
    assert.equal(dontes.value, "4006381333931");
  });

  /**
   * A HOSSZ DONTI EL A MEZOT, ES EZ NEM IZLES: egy 12 jegyu kod az `ean`
   * mezoben ugyanugy megtalalhatatlan lenne a boltban.
   */
  it("a 12 jegyu ervenyes kod az upc mezobe megy, nem az ean-be", () => {
    const dontes = decideMedusaBarcode("036000291452", 1);

    assert.equal(dontes.kind, "upc");
    assert.equal(dontes.field, "upc");
  });

  it("a valodi gyartoi cikkszam nem vonalkod, es nem is jelent hianyt", () => {
    const dontes = decideMedusaBarcode("core7_otherm_bulk", 1);

    assert.equal(dontes.kind, "none");
    assert.equal(dontes.duplicate, null);
  });

  /**
   * A KIADVANY-ELOTAG ERVENYES, ES MEGSEM TERMEK-VONALKOD.
   *
   * A 9780301379722 valodi, ervenyes ellenorzo szamjegyu kod -- es egy ISBN,
   * tehat konyv. A mert adatban egy ilyen all, egy olyan termeken, aminek a
   * sajat cikkszama ugyanez.
   *
   * ES AZ EGYEDISEG NEM VEDI MEG: a tobbi generalt kodot ma az ismetlodes-ag
   * tartja vissza, de az VELETLEN vedelem -- nem azert maradnak bent, mert
   * generaltak, hanem mert tobbszor allnak. Ezert all itt kulon allitas, es
   * ezert EGYEDIKENT adjuk at (sameValueCount 1): epp azt az esetet merjuk,
   * amit az ismetlodes-ag NEM fogna meg.
   */
  it("a kiadvany-elotagu kod nem megy ki, meg akkor sem, ha egyedi es ervenyes", () => {
    const dontes = decideMedusaBarcode("9780301379722", 1);

    assert.equal(dontes.kind, "none");
    assert.equal(dontes.field, null);
    // NEM `skipped`: a ket kimenet MAS teendot jelent. A `skipped` a
    // forras-oldali tisztitasra var; ez soha nem lesz termek-vonalkod.
    assert.equal(dontes.duplicate, null);
  });

  it("a nem kiadvany-elotagu 13 jegyu kod tovabbra is kimegy", () => {
    // ISMERT POZITIV KONTROLL a fenti allitashoz: enelkul egy olyan
    // megvalositas is atmenne, ami MINDEN 13 jegyu kodot elutasit.
    assert.equal(decideMedusaBarcode("4006381333931", 1).kind, "ean");
  });

  /**
   * AZ ISMETLODES A LEGFONTOSABB AG: ket kulonbozo cikkszam ugyanarra a
   * vonalkodra a boltban azt allitana, hogy a ket termek ugyanaz. Merve a
   * forrason: 50 kod 151 termeken all igy.
   *
   * Es a `skipped` NEM ugyanaz, mint a `none`: a keres torzsere nezve igen
   * (egyik sem kuld kodot), de az egyik RENDBEN van, a masik HIANY.
   */
  it("az ismetlodo kodot kihagyja, es HIANYKENT jelenti, nem csendben", () => {
    const dontes = decideMedusaBarcode("4006381333931", 2);

    assert.equal(dontes.kind, "skipped");
    assert.equal(dontes.field, null);
    assert.equal(dontes.duplicate, "4006381333931");
  });

  /**
   * A GS1 TOBBI NEM-TERMEK TARTOMANYA, UGYANAZZAL AZ INDOKKAL, MINT A KIADVANY.
   *
   * A mert adatban EGY ilyen kod all (9579907673293, a GS1 Global Office
   * tartomanyaban), es MA az ismetlodes-ag tartja vissza, mert ket cikkszamon
   * szerepel. DE AZ A VEDELEM VELETLEN: nem azert marad bent, mert kupon,
   * hanem mert tobbszor all.
   *
   * EZERT ADJUK AT EGYEDIKENT (sameValueCount 1): epp azt az esetet merjuk,
   * amit az ismetlodes-ag NEM fogna meg. Ugyanaz a szerkezet, mint az
   * ISBN-allitasnal.
   */
  it("a GS1 kupon-tartomanyu kod nem megy ki, meg egyedikent sem", () => {
    const dontes = decideMedusaBarcode("9579907673293", 1);

    assert.equal(dontes.kind, "none");
    assert.equal(dontes.duplicate, null);
  });

  /**
   * A BELSO HASZNALATU (2-vel kezdodo) TARTOMANYRA a mert adatban NULLA eset
   * van. Az allitas ELORE szol: ezek a kodok boltonkent szabadon kiosztottak,
   * tehat a boltunkon KIVUL semmit nem azonositanak -- es epp attol
   * veszelyesek, hogy barmikor keletkezhetnek.
   */
  it("a belso hasznalatu, 2-vel kezdodo kod sem megy ki", () => {
    // 2123456789010 -- ervenyes ellenorzo szamjeggyel, belso tartomany.
    // A szamjegyet KISZAMOLTAM, nem talaltam ki: az elso probam (...013) nem
    // ment at a checksumon, es a teszt sajat allitasa fogta meg. Egy kitalalt
    // fixtura ugyanugy hamis meres, mint egy kitalalt szam a jelentesben.
    assert.equal(hasValidCheckDigit("2123456789010"), true);
    assert.equal(decideMedusaBarcode("2123456789010", 1).kind, "none");
  });

  /**
   * ISMERT POZITIV KONTROLL A HAROM KIZARASHOZ EGYUTT: egy valodi
   * orszag-tartomanyu kod tovabbra is kimegy. Enelkul egy olyan megvalositas is
   * atmenne, ami a 13 jegyu kodok tobbsegét elutasitja.
   */
  it("a valodi orszag-tartomanyu kod tovabbra is kimegy", () => {
    // 4-es elotag: Nemetorszag. A mert adatban 210 ilyen all.
    assert.equal(decideMedusaBarcode("4006381333931", 1).kind, "ean");
    // 5-os elotag: Egyesult Kiralysag. 103 ilyen all a mert adatban.
    assert.equal(decideMedusaBarcode("5060139358699", 1).kind, "ean");
  });

  /**
   * A HARMADIK ESET, AMI A KET SORRENDET MEGKULONBOZTETI.
   *
   * A masik ket kiadvany-allitas EGYEDI koddal dolgozik, tehat a sorrend nem
   * szamit bennuk: mindket felallasban `none` jonne ki. Ez az eset az egyetlen,
   * ami elvalasztja oket.
   *
   * ES A KULONBSEG NEM BELSO: a `skipped` azt mondja a kimenetben, hogy a
   * tisztitas helye a forras, ott dol el, MELYIK terméke a kod. Egy ISBN-nel ez
   * hamis -- egyikuke sem --, es a tisztitasi lista ezeket kulon csoportba
   * teszi ("a mezo torlendo"). Ha a mi kimenetunk a masik csoportba sorolna
   * oket, a ket lista ellentmondana egymasnak.
   */
  it("az ismetlodo KIADVANY-kod is none, nem skipped -- a sorrend miatt", () => {
    const dontes = decideMedusaBarcode("9780301379722", 4);

    assert.equal(dontes.kind, "none");
    assert.equal(dontes.duplicate, null);
  });

  /**
   * UGYANEZ A HOSSZRA. Egy nyolc jegyu ervenyes kod ismetlodve is `none`: nincs
   * cel-mezoje, tehat nincs mire varni a forrastol. A mert adatban ma nulla ilyen
   * all, tehat ez az ag elore szol, nem visszamenoleg.
   */
  it("az ismetlodo, cel-mezo nelkuli hosszusagu kod is none", () => {
    // 96385074 -- ervenyes EAN-8 ellenorzo szamjeggyel.
    assert.equal(hasValidCheckDigit("96385074"), true);
    assert.equal(decideMedusaBarcode("96385074", 3).kind, "none");
  });

  /**
   * A NULLA DARABSZAM A HIVO SZAMLALASI HIBAJA, es ilyenkor NEM dobunk el egy
   * jo kodot. A ket teves irany ara nem egyforma: egy folosleges kod
   * kikuldese lathato es javithato, egy csendben eldobott kod nem.
   */
  it("nulla darabszamnal is kikuldi a kodot, mert az a hivo hibaja lenne", () => {
    const dontes = decideMedusaBarcode("4006381333931", 0);

    assert.equal(dontes.kind, "ean");
  });
});

describe("describeSkippedBarcode", () => {
  it("megnevezi a termeket, a kodot es a darabszamot, es a forrasra mutat", () => {
    const sor = describeSkippedBarcode("prod-1", "4006381333931", 3);

    assert.ok(sor.includes("prod-1"));
    assert.ok(sor.includes("4006381333931"));
    assert.ok(sor.includes("3"));
    // A tisztitas helye a forras, nem a vetites -- enelkul a kovetkezo olvaso
    // a vetitesben keresne a hibat.
    assert.ok(sor.includes("UNAS"));
  });
});

/**
 * UGYANAZ A FIZIKAI KOD KET IRASMODBAN (02ef8620).
 *
 * === A SZAMOK, AMIK MIATT EZ NEM ELMELETI (merve 2026-09-21) ===
 *
 * A nyers UNAS exporton a szamjegyes cikkszamok kozott a 12 jegyu alak a
 * MASODIK leggyakoribb hossz: 165 kulonbozo ertek (a 13 jegyu 783). A staging
 * adatbazis fuggetlenul ugyanezt mondja: 998 kitoltott cikkszambol 92 tizenket
 * jegyu.
 *
 * ES A DONTO SZAM: HARMINCHET 13 jegyu kod all VEZETO NULLAVAL -- vagyis mar a
 * kiegeszitett alakban. A katalogus MA IS ket konvenciot visel egymas mellett.
 * Utkozo par ma nincs (merve, mukodo pozitiv kontrollal), de harminchet kod all
 * EGYETLEN forras-oldali szerkesztesnyire tole.
 *
 * KORABBAN EGY SZARMAZTATOTT FAJLBOL AZT MERTEM, hogy 12 jegyu kod NINCS. Az
 * hamis volt: a szarmaztato szkript `len in (13, 8)` szerint szur, tehat a 12
 * jegyu SZERKEZETILEG nem kerulhetett a kimenetbe. Egy szarmaztatott fajl nem
 * tud arrol, amit a szuro kihagyott.
 */
describe("ugyanaz a kod ket irasmodban", () => {
  it("a 12 jegyu alak mellett a vezeto nullas 13 jegyu is jelolt", () => {
    assert.deepEqual(vonalkodAlakjai("653341191120"), [
      "653341191120",
      "0653341191120",
    ]);
  });

  it("a vezeto nullas 13 jegyu mellett a csupasz 12 jegyu is jelolt", () => {
    assert.deepEqual(vonalkodAlakjai("0653341191120"), [
      "0653341191120",
      "653341191120",
    ]);
  });

  /*
    ISMERT POZITIV KONTROLL A LENTI EGYELEMU ESETEKHEZ: a fenti ket allitas
    bizonyitja, hogy a fuggveny TUD ket alakot adni. Enelkul egy olyan
    valtozat is zold lenne, ami MINDIG egyelemu listat ad.
  */
  it("a nem nullas 13 jegyu alaknak nincs masik irasmodja", () => {
    assert.deepEqual(vonalkodAlakjai("5999860770015"), ["5999860770015"]);
  });

  it("a valodi gyartoi cikkszamon a viselkedes valtozatlan", () => {
    assert.deepEqual(vonalkodAlakjai("core7_otherm_bulk"), [
      "core7_otherm_bulk",
    ]);
    assert.deepEqual(vonalkodAlakjai(null), []);
    assert.deepEqual(vonalkodAlakjai("  "), []);
  });
});

/**
 * A BELSO HASZNALATU TARTOMANY A 12 JEGYU ALAKON IS SZAMIT.
 *
 * A `2` szamrendszer-jegy az UPC-A-ban ugyanazt jelenti, mint a `2` elotag az
 * EAN-13-ban: boltonkent szabadon kiosztott kod, ami a boltunkon KIVUL semmit
 * nem azonosit. 2026-09-21-ig a vizsgalat CSAK a 13 jegyu agon futott.
 */
describe("a belso hasznalatu tartomany mind a ket hosszon", () => {
  it("a 12 jegyu, 2-vel kezdodo kod NEM megy ki", () => {
    // 222000000419 -- ervenyes ellenorzo szamjeggyel, belso tartomany
    const kod = "222000000419";
    assert.equal(hasValidCheckDigit(kod), true, "a proba-kod ervenyes legyen");
    assert.equal(decideMedusaBarcode(kod, 1).kind, "none");
  });

  /*
    ISMERT POZITIV KONTROLL: egy RENDES 12 jegyu kod tovabbra is kimegy `upc`
    mezoben. Enelkul egy "minden 12 jegyut eldobunk" valtozat is zold lenne.
  */
  it("a rendes 12 jegyu kod tovabbra is upc mezot kap", () => {
    const kod = "653341191120";
    assert.equal(hasValidCheckDigit(kod), true, "a proba-kod ervenyes legyen");
    const d = decideMedusaBarcode(kod, 1);
    assert.equal(d.kind, "upc");
    assert.equal(d.field, "upc");
  });

  /**
   * ES EZ AZ ALLITAS AZ INDOKOT VEDI, NEM A VISELKEDEST.
   *
   * Kezenfekvo volna a 12 jegyu kodot vezeto nullaval kiegesziteni, es a
   * tartomany-vizsgalatot a kiegeszitett alakra futtatni. EZ MERHETOEN ROSSZ:
   * a `2xxxxxxxxxxx`-bol `02xxxxxxxxxxx` lesz, tehat a szamrendszer-jegy a
   * MASODIK helyre kerul, es az elso-jegy vizsgalat nem fogja meg.
   *
   * A normalizalas itt EPP a megkulonbozteto jelet torolne el. Ez az allitas
   * azert all itt, hogy a kovetkezo olvaso ne "egyszerusitse" oda.
   */
  it("a vezeto nullas alak NEM helyettesiti a nyers vizsgalatot", () => {
    const belso12 = "222000000419";
    const kiegeszitett = `0${belso12}`;

    // A kiegeszitett alak MAR NEM 2-vel kezdodik: a jel eltolodott.
    assert.equal(kiegeszitett.startsWith("2"), false);
    assert.equal(kiegeszitett.startsWith("02"), true);

    // A nyers alakon viszont a dontes helyes marad.
    assert.equal(decideMedusaBarcode(belso12, 1).kind, "none");
  });
});

/**
 * A VONALKOD SORA NEM ALLHAT EGY NEM-TERMEK MELLETT (0c1fb1c2).
 *
 * A `skipped` mondata azt allitja, hogy "a tisztitas helye a forras: ott dol
 * el, melyik terméke a kod". Egy kedvezmeny-tetelnel vagy egy sablon-rekordnal
 * ez HAMIS -- nem az a kerdes, melyikuke, hanem hogy egyikuke sem.
 *
 * A kozzeteteli kapu ezeket `not-a-product` okkal kizarja, de a vonalkod-sor
 * KORABBAN keletkezett, tehat a jelentesbe megis bekerult volna.
 */
describe("vonalkodSorKiirhato", () => {
  /*
    A POZITIV KONTROLL ELOSZOR: egy VALODI termek kihagyasa TOVABBRA IS
    megjelenik. Enelkul egy "soha ne irjunk sort" valtozat is zold lenne -- es
    akkor a tisztitasi lista nemulna el, ami a sor egesz celja.
  */
  it("valódi terméknél a kihagyás sora kimegy", () => {
    assert.equal(
      vonalkodSorKiirhato({ kind: "skipped", publikacioOka: "sellable" }),
      true,
    );
    assert.equal(
      vonalkodSorKiirhato({ kind: "blocked", publikacioOka: "sellable" }),
      true,
    );
  });

  it("nem-terméknél NEM megy ki", () => {
    assert.equal(
      vonalkodSorKiirhato({ kind: "skipped", publikacioOka: "not-a-product" }),
      false,
    );
    assert.equal(
      vonalkodSorKiirhato({ kind: "blocked", publikacioOka: "not-a-product" }),
      false,
    );
  });

  /*
    ES A TOBBI ELUTASITASI OK NEM NEMITJA EL. Egy inaktiv termek vonalkodja
    ugyanugy tisztitando: az a sor VALODI termek, csak most nem megy ki.
    Enelkul a szures csendben minden elutasitott terméket elnyelne.
  */
  it("más elutasítási ok nem némítja el", () => {
    for (const ok of [
      "product-inactive",
      "not-webshop-sellable",
      "no-active-variant",
      "unknown-authority",
    ])
      assert.equal(
        vonalkodSorKiirhato({ kind: "skipped", publikacioOka: ok }),
        true,
        `a(z) ${ok} ok nem némíthat`,
      );
  });

  /*
    A MEGALLT FUTASNAL AZ OK ISMERETLEN, es a sor KIMEGY. Egy ismeretlen
    allapotban elhallgatott jelzes rosszabb, mint egy folosleges: a masodikat
    valaki elolvassa es legyint, az elsot senki nem keresi.
  */
  it("ismeretlen ok mellett kimegy", () => {
    assert.equal(
      vonalkodSorKiirhato({ kind: "skipped", publikacioOka: null }),
      true,
    );
  });

  /*
    ES AMI SOSEM VOLT SOR, AZ EZUTAN SEM LESZ: a `none`, az `ean` es az `upc`
    dontesnek nincs kimeneti sora. Enelkul egy "mindig igazat adunk" valtozat
    is zold lenne a fenti allitasokon.
  */
  it("a sor nélküli döntéseknek továbbra sincs sora", () => {
    for (const kind of ["none", "ean", "upc"] as const)
      assert.equal(
        vonalkodSorKiirhato({ kind, publikacioOka: "sellable" }),
        false,
      );
  });
});

/**
 * A FUTTATO FORRASA -- ES AZ UTVONAL HAROM SZINTET LEP FEL.
 *
 * A forditott spec a `test-dist` alol fut, tehat az `import.meta.url` ODA
 * mutat, es a `.ts` forras NINCS mellette. Az elso alakom ezert `ENOENT`-tel
 * hasalt el -- ugyanaz a csapda, amit a mobil kepernyo-specek fejlece is leir.
 */
const FUTTATO_FORRAS = join(
  new URL("../../../", import.meta.url).pathname,
  "src",
  "integrations",
  "medusa",
  "medusa-projection.runner.ts",
);

/**
 * ES A SORREND A FUTTATOBAN -- MERT A SZABALY ONMAGABAN NEM VED SEMMIT.
 *
 * A `vonalkodSorKiirhato` a kozzeteteli dontes OKAT kapja. Ha a futtato a sort
 * MEGIS a dontes ELOTT irja ki, az okot nem is tudja atadni -- es a fenti ot
 * allitas valtozatlanul zold marad.
 *
 * Ezert olvas ez az allitas FORRAST, es a HELYEKET veti ossze, nem a szoveget.
 */
describe("a vonalkód sora a közzétételi döntés UTÁN kerül ki", () => {
  it("a futtatóban a kiírás a projekció hívása után áll", () => {
    const forras = readFileSync(FUTTATO_FORRAS, "utf8");

    // ISMERT POZITIV KONTROLL: a fajlt tenyleg beolvastuk.
    assert.ok(forras.length > 10000, "gyanúsan rövid futtató-forrás");

    const kod = forras
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

    const dontes = kod.indexOf("decideMedusaBarcode(");
    const vetites = kod.indexOf("service!.project(");
    const kiiras = kod.indexOf("vonalkodSort(");

    // Mind a harom helyet MEG kell talalni: egy -1 csendben kielegitene a
    // lenti osszehasonlitasokat.
    assert.ok(dontes > 0, "nincs decideMedusaBarcode hívás");
    assert.ok(vetites > 0, "nincs service.project hívás");
    assert.ok(kiiras > 0, "nincs vonalkodSort hívás");

    assert.ok(dontes < vetites, "a döntésnek a vetítés ELŐTT kell születnie");
    assert.ok(vetites < kiiras, "a kiírásnak a vetítés UTÁN kell állnia");
  });

  /*
    ES A REGI, KORAI KIIRAS NEM TERHET VISSZA -- ES A KALIBRACIO MEGMUTATTA,
    HOGY EZ A KETTO NEM UGYANAZT MERI.

    Azt vartam, hogy egy visszatett korai kiiras MIND A KET allitast pirosra
    viszi. NEM igy lett: a sorrend-allitas ZOLD maradt, mert az a HELYEKET
    veti ossze (`decideMedusaBarcode` < `service.project` < `vonalkodSort`), es
    egy NEGYEDIK, korai hivas ezeket nem mozditja.

    Vagyis:
      a sorrend-allitas   azt vedi, hogy a LEZARAS a helyen van
      a darabszam         azt, hogy RAJTA KIVUL senki nem ir

    A ketto egyutt fed; kulon-kulon egyik sem.
  */
  it("a kiíró függvényeket csak a lezárás hívja", () => {
    const kod = readFileSync(FUTTATO_FORRAS, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

    const hivasok = [...kod.matchAll(/describe(?:Skipped|Blocked)Barcode\(/g)];
    /*
      KETTO, ES AZ IMPORT-SOR NEM SZAMIT BELE: ott a nev vesszovel all
      (`describeBlockedBarcode,`), a minta viszont NYITO ZAROJELET kovetel.
      Ez a mondat korabban azt allitotta, hogy az import-sor is illeszkedik,
      es a szam megis 2 volt -- vagyis a komment egy MASIK szamot indokolt,
      mint amit az allitas mer. Aki javitani akarta volna, 4-re irja at.
    */
    assert.equal(hivasok.length, 2, "a kiírók csak a lezárásban hívhatók");
  });

  /*
    ES A HARMADIK ALLITAS, MERT A MASIK KETTO EGY HALLGATOLAGOS FELTEVESEN ALL:
    hogy a lezaras a VALODI kozzeteteli okot kapja meg.

    A sorrend-allitas a HELYEKET meri, a darabszam a HIVOK szamat. Egyik sem
    nezi, MIT adunk at. Ha valaki a `outcome.publication.reason` helyere
    `null`-t irna, a kapu CSENDBEN megszunne (a `null` az "ismeretlen ok" ag,
    ami mindig kiir), es mind a ket fenti allitas zold maradna.

    Ez ugyanaz a csalad, mint a szakadas: mind a ket vegpont helyes, csak a
    kettot nem koti ossze semmi.
  */
  it("a lezárás a valódi közzétételi okot kapja", () => {
    const kod = readFileSync(FUTTATO_FORRAS, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

    assert.ok(
      /vonalkodSort\([^)]*outcome\.publication\.reason/s.test(kod),
      "a lezárás hívása nem a közzétételi okot kapja",
    );
  });
});
