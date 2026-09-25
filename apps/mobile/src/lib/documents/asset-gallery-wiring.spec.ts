import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * AZ ESZKOZ-ADATLAP CSATOLMANY-SZAKASZA ES A MATRICAKODJA.
 *
 * Ebben a csomagban nincs komponens-teszt, ezert ezek az allitasok a kepernyo
 * FORRASAT olvassak. A HATARA kimondva: azt merik, hogy a kepernyo a helyes
 * hivasokat irja le, nem azt, hogy a szerelo LATJA a kepet.
 *
 * ES EGY HATAR A MEROESZKOZRE: ez a spec KET fajlt olvas (a kepernyot es a
 * klienst), a `minta-egyedi.py --spec` agа viszont EGY celfajlt vesz. Aki azzal
 * meri, a masik fajlra szolo mintakra HAMIS "0 talalat" gyanut fog kapni --
 * ugyanaz a "tobb celfajlos spec" eset, amit a sopres meretlennek jelol.
 */
const KEPERNYO = "src/app/assets/[id].tsx";
const KLIENS = "src/lib/api/assets.ts";

const olvas = (ut: string) => readFileSync(ut, "utf8");

describe("az eszkoz-adatlap csatolmany-szakasza", () => {
  it("POZITÍV KONTROLL: a két fájl olvasható és nem üres", () => {
    for (const ut of [KEPERNYO, KLIENS])
      assert.ok(olvas(ut).length > 2000, `${ut}: üres vagy gyanúsan rövid`);
  });

  /**
   * A LISTA A MAR LEKERT VALASZBOL JON, NEM MASODIK HIVASBOL.
   *
   * Az `AssetDetail` hordozza a `documents` mezot, es a kepernyo azt a valaszt
   * ugyis lekeri. Egy kulon `listAssetDocuments` hivas MASODIK kort jelentene
   * ugyanazert az adatert -- a #781-ben keszult vegpont a WEBES oldalnak kell.
   */
  it("a csatolmányok a meglévő válaszból jönnek, nem külön hívásból", () => {
    assert.match(olvas(KEPERNYO), /asset\?\.documents \?\? \[\]/);
    assert.doesNotMatch(
      olvas(KEPERNYO),
      /listAssetDocuments/,
      "külön lista-hívás került be: az adat már a detail válaszban benne van",
    );
  });

  /**
   * ES A TIPUS-MASOLAT IS TUDJA. A mobil SZANDEKOSAN sajat masolatot tart, tehat
   * a mezo NEV NELKUL is atjonne -- es pontosan ezert allt itt nulla kep egy
   * olyan valaszban, ami a listat vegig tartalmazta.
   */
  it("a mobil típus-másolata ismeri a documents mezőt", () => {
    assert.match(olvas(KLIENS), /^ {2}documents: AssetDocumentSummary\[\];$/m);
  });

  /**
   * A SZAKASZ A `manage` KAPUN KIVUL ALL. A megnezes `assetsView` ala tartozik
   * (a lap maga is azon all), a feltoltes `assetsManage` ala. Behuzva a kapu
   * moge a nezo epp azt nem latna, amiert a kepek felkerultek.
   */
  it("a csatolmány-szakasz nem a szerkesztési jogra van kapuzva", () => {
    /*
      A SZAKASZ SAJAT FELTETELET MERJUK, NEM A SORRENDET.

      Az elso alakom `indexOf`-fal a szakasz es a kapu SORRENDJET nezte -- es
      elbukott, MERT AZ ALLITAS VOLT ROSSZ, nem a kod: ezen a kepernyon a
      `assetsManage && !fromCache` kapu KETSZER all (Szerkesztes, Fenykepek), es
      az `indexOf` az elsot talalta meg. A galeria mind a kettonel kintebb van.

      A szakasz sajat feltetele viszont EGYERTELMU: ha abban `capabilities`
      szerepelne, a nezo nem latna a kepeket. Ez a dontes, es ezt merjuk.
    */
    const s = olvas(KEPERNYO);
    const szakasz = s.indexOf("<Section title={`Csatolmányok (");
    assert.ok(szakasz !== -1, "nem találom a csatolmány-szakaszt");

    const elotte = s.slice(0, szakasz);
    const feltetel = elotte.slice(elotte.lastIndexOf("{"));
    assert.doesNotMatch(
      feltetel,
      /capabilities/,
      `a csatolmány-szakaszt jogosultsági kapu zárja: ${feltetel.trim().slice(0, 90)}`,
    );
  });

  /**
   * AZ UTVONAL A KLIENS SAJAT `BASE`-EVEL EGYEZIK, NEM A MAPPA NEVEVEL. A
   * hibajegynel ezt elrontottam, es a hiba NEMA lett volna: a csempek
   * megjelennek, es minden kep "nem tolthető be" felirattal all.
   */
  it("a kép-forrás a kliens BASE útvonalával egyezik", () => {
    const base = olvas(KLIENS).match(/^const BASE = "([^"]+)";/m);
    assert.ok(base, "nem találom a kliens BASE értékét");
    assert.ok(
      olvas(KEPERNYO).includes(`\`${base[1]}/\${encodeURIComponent(id)}\``),
      `a kép-forrás útvonala nem a kliens BASE-ét (${base[1]}) használja`,
    );
  });

  /**
   * A KEP KET HELYEN JELENIK MEG: a csempen es a nagy ratetben. DARABSZAMOT
   * merunk, nem jelenletet -- egy nem egyedi minta mellett az egyik elvesztese
   * zolden atmenne, mert a masik tartana eletben. (Ezt a sajat mereseszkozom
   * mutatta meg a hibajegy-specen, ugyanezzel a mintaval.)
   */
  it("a kép a hitelesített forrásból jön, mind a két helyen", () => {
    const s = olvas(KEPERNYO);
    /*
      A MECHANIZMUS 2026-09-21-EN MEGVALTOZOTT, ES AZ ALLITAS UGYANAZT MERI.

      A hitelesitett kerest eddig a natív betolto vegezte (`source={forras}`, a
      tokennel a fejlecben). Androidon az a fejlec NEM ert celba: Balazs eles
      hibaja, 2026-09-21, es a meroeszkozom 401-et hozott vissza a keszulekrol.
      A bajtokat innentol a `DocumentImage` keri le, es helyi fajlba irja.

      A DARABSZAM MERESE VALTOZATLANUL KELL, pontosan azert, amiert eddig: egy
      jelenletre illeszto allitas ZOLDEN atengedne, ha az egyik nezet lemaradna
      -- a masik tartana eletben --, es a hiba NEMA lenne.
    */
    const db = s.split("<DocumentImage").length - 1;
    assert.equal(
      db,
      2,
      `a hitelesített kép ${db} helyen áll; a csempe ÉS a nagy kép rátéte kell, különben az egyik nézet üresen maradna`,
    );
    /* ES MIND A KETTO A GAZDA-UTVONALAT KAPJA, nem egy beirt cimet. */
    assert.equal(s.split("ownerPath={gazdaUtvonal}").length - 1, 2);
  });

  /**
   * A KET HIVOHELY KET KULONBOZO VALTOZATOT KER -- ACROBOT DONTESE
   * (2026-09-18), es a fontosabb fele a MASODIK sor.
   *
   * A csempe gyorsulasa LATSZIK; a nagy kep elmosodasa NEM. Egy elmosodott
   * szerviz-fenykepet senki nem jelent be hibakent, csak egyszer csak nem
   * lehet elolvasni rola a tipustablat.
   *
   * DARABSZAMOT MERUNK, NEM JELENLETET: egy nem egyedi minta mellett az egyik
   * hivohely elvesztese zolden atmenne, mert a masik tartana eletben.
   */
  it("a csempe belyegkepet ker, a nagy kep az EREDETIT", () => {
    const s = olvas(KEPERNYO);
    /*
      A KET NEVESITETT FUGGVENY HELYETT MOSTANTOL EGY NEVESITETT PROP all
      (`variant`), de a MERT ALLITAS ugyanaz: a ket hivohely KET KULONBOZO
      valtozatot ker, es a darabszam mondja meg, hogy egyik sem maradt le.
    */
    assert.equal(
      s.split('variant="thumbnail"').length - 1,
      1,
      "a csempe nem a belyegkep-valtozatot keri",
    );
    assert.equal(
      s.split('variant="original"').length - 1,
      1,
      "a nagy kep nem az eredeti valtozatot keri",
    );
  });

  it("a nagy kép rátét, nem Modal", () => {
    const s = olvas(KEPERNYO);
    assert.doesNotMatch(s, /<Modal/);
    /*
      A STÍLUS-OBJEKTUM NEVÉRE NEM KÖTÜNK KI, CSAK A KULCSRA: 2026-09-25-től
      a rátét saját, téma-független `overlayStyles`-ből él (lásd a fájl
      fejlécét, miért), a témás `styles`-től külön -- a minta ezért bármelyik
      objektumnéven illeszkedik, amíg a `nagyRatet` kulcs létezik és
      alkalmazva van.
    */
    assert.match(s, /\.nagyRatet\b/);
  });

  it("a nem megnézhető csatolmány neve kiíródik", () => {
    assert.match(olvas(KEPERNYO), /describeUnviewableDocument\(doc\)/);
  });
});

describe("az eszköz matricakódja a telefonon", () => {
  /**
   * A BEGEPELT AZONOSITOK KOZE VALO, NEM A QR MELLE -- es ez a sorrend maga a
   * dontes. A matricakod az, amit a szerelo a matricarol leolvas; a QR-token a
   * kirajzolt kod sajat azonositoja. Egy panelbe teve osszemosodnanak.
   */
  it("a sorozatszám és a partner-azonosító mellett áll", () => {
    const s = olvas(KEPERNYO);
    const sorozat = s.indexOf(
      '<Info label="Sorozatszám" value={asset.serialNumber} />',
    );
    const matrica = s.indexOf(
      '<Info label="Matricakód" value={asset.labelCode} />',
    );
    assert.ok(sorozat !== -1, "nem találom a sorozatszám sorát");
    assert.ok(matrica !== -1, "a matricakód nem áll a lapon");
    assert.ok(
      matrica > sorozat && matrica - sorozat < 1200,
      "a matricakód elszakadt a begépelt azonosítóktól",
    );
  });

  /**
   * ES CSAK AZ ELO AGON. A mentett masolat `cachedSummary` tipusa
   * `AssetListItem`, ami a `labelCode`-ot NEM hordozza -- ott `undefined` lenne
   * belole, hibauzenet nelkul.
   */
  it("a mentett másolat ágán nem áll matricakód", () => {
    assert.doesNotMatch(
      olvas(KEPERNYO),
      /value=\{cachedSummary\.labelCode\}/,
      "a mentett másolat típusa nem hordozza a labelCode-ot: undefined lenne",
    );
  });
  /**
   * A FELIRAT: A TUKOR, A MEGJELENITES ES A SZERKESZTES -- HAROM KULON ALLITAS.
   *
   * MIERT NEM EGY: a harom KULON tud elromlani, es a hianyuk MAS alaku. A mezo
   * nelkul a felirat `undefined` lenne; a megjelenites nelkul a szerver ertekе
   * megjon es senki nem latja; a szerkesztes nelkul csak a webrol lehetne
   * feliratozni. Egy kozos allitas a harmat egy pirosba mosna.
   *
   * A HATAR UGYANAZ, MINT A FENTIEKNEL: ez a FORRAST olvassa, nem a kepernyot
   * rendereli. Azt meri, hogy a kepernyo a helyes hivast irja le.
   */
  it("a mobil típus-másolata ismeri a caption mezőt", () => {
    /*
      A `string | null` ALAK SZAMIT, nem csak a nev. A kozos tipus is igy all,
      es az indok ott all kiirva: egy elhagyhato mezo mellett a "nincs felirat"
      es a "szandekosan ures felirat" megkulonboztethetetlen lenne.
    */
    /*
      A MINTA A SZOMSZED SORT IS VISZI, ES EZ NEM OVATOSSAG. A
      `caption: string | null;` a fajlban KETSZER all: a tukorben ES a
      keres-torzs tipusaban (`SetAssetDocumentCaptionInput`). Az elso alakom
      csak a mezot nezte, es a kalibracio megmutatta, hogy NULLA pirosat ad:
      a tukorbol kivett mezo mellett is illeszkedett a masik elofordulasra.
      Egy allitas, ami barhol illeszkedhet, nem azt orzi, amit a neve mond.
    */
    assert.match(
      olvas(KLIENS),
      /^ {2}caption: string \| null;\n {2}uploadedBy\?: \{ id: string; displayName: string \};$/m,
    );
  });

  it("a felirat MEGJELENIK a csempén, és csak ha van", () => {
    /*
      A FELTETELES ALAK A LENYEG. Felirat nelkul a sor SEM all ott: egy ures
      `Text` helyet foglalna a 104 pontos csempen, es ugy nezne ki, mintha
      betoltodne valami.
    */
    assert.match(olvas(KEPERNYO), /\{kep\.caption \? \(/);
  });

  it("a felirat SZERKESZTHETO, és a mező a manage jogon ÁLL", () => {
    const kepernyo = olvas(KEPERNYO);
    /*
      A HIVASRA ILLESZTUNK, NEM A NEVRE. A `setAssetDocumentCaption` a fajlban
      KETSZER all -- az importban es a hivasban --, tehat a puszta nev nem a
      bekotest orzi. A `minta-egyedi.py` ezt `GYANU 2x` alakban jelezte.
    */
    assert.match(kepernyo, /await setAssetDocumentCaption\(/);
    /*
      A KAPU A JOGON ES A HALOZATON EGYUTT ALL. Offline (`fromCache`) a mentes
      nem menne at, es egy letiltott gomb azt igerne, hogy van mit megnyomni.
      A webes minta ugyanez: ott a fuggvenyt NEM adjak at, nem gombot tiltanak.
    */
    assert.match(
      kepernyo,
      /capabilities\?\.assetsManage && !fromCache && nagyKepSor \? \(/,
    );
  });

  it("az ÜRES mező TÖRLÉST jelent: `null` megy le, nem üres szöveg", () => {
    /*
      MI PIROSIT: ha valaki `felirat.trim()`-et ad at feltetel nelkul. Akkor a
      torles ures stringkent menne le, es a szerver ket kulonbozo allapotot
      kapna ugyanarra a szandekra.
    */
    assert.match(
      olvas(KEPERNYO),
      /felirat\.trim\(\) \? felirat\.trim\(\) : null/,
    );
  });

  it("a nagyban nyitott kép piszkozata a SZERVER értékéből indul", () => {
    /*
      MI PIROSIT: ha a megnyitas nem allitja a piszkozatot. Akkor az elozo kep
      felirata atlatszana a kovetkezore, es a szerelo azt irna felul, amit lat
      -- a hiba NEMA lenne, mert a mezoben all szoveg.
    */
    assert.match(olvas(KEPERNYO), /setFelirat\(kep\.caption \?\? ""\)/);
  });
});
