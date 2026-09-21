import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A MUNKALAP CSATOLMÁNY-SZAKASZÁNAK BEKÖTÉSE.
 *
 * Ebben a csomagban nincs komponens-teszt, ezért ezek az állítások a képernyő
 * FORRÁSÁT olvassák. A HATÁRA kimondva: azt mérik, hogy a képernyő a helyes
 * hívásokat írja le, nem azt, hogy a szerelő LÁTJA a képet.
 *
 * MINDEN MINTA A HÍVÁS ALAKJÁRA ILLESZT, NEM A PUSZTA NÉVRE, és ez mérésből
 * jön: 2026-09-17-én kétszer is előfordult nálam, hogy egy név-alapú állítás
 * ZÖLD MARADT egy valódi rontásra, mert az `import` sor vagy a `const`
 * deklaráció életben tartotta a nevet.
 */
const KEPERNYO = "src/app/worksheets/[id].tsx";
const KLIENS = "src/lib/api/worksheets.ts";

const olvas = (ut: string) => readFileSync(ut, "utf8");

describe("a munkalap csatolmány-szakasza", () => {
  it("POZITÍV KONTROLL: a két fájl olvasható és nem üres", () => {
    for (const ut of [KEPERNYO, KLIENS])
      assert.ok(olvas(ut).length > 2000, `${ut}: üres vagy gyanúsan rövid`);
  });

  it("a kliens lekéri a csatolmányok listáját", () => {
    /**
     * A FÜGGVÉNY NEVÉVEL EGYÜTT, NEM CSAK AZ ÚTVONALLAL.
     *
     * MÉRVE: ugyanaz az útvonal KÉT helyen áll ebben a fájlban, mert a
     * FELTÖLTÉS is oda megy. Egy pusztán útvonalra illesztő állítás tehát zöld
     * maradna akkor is, ha a lekérő függvényt kivennék -- a feltöltés egyedül
     * tartaná életben.
     */
    const s = olvas(KLIENS);
    assert.match(s, /export function listWorksheetDocuments\(id: string\)/);
    assert.match(
      s,
      /listWorksheetDocuments[\s\S]{0,200}\$\{BASE\}\/\$\{encodeURIComponent\(id\)\}\/documents/,
    );
  });

  /**
   * A GALÉRIA A MANAGE-KAPUN KÍVÜL ÁLL.
   *
   * A megnézés `service.view` alatt van, a feltöltés `service.manage` alatt. Ha
   * a szakasz a kapun BELÜL állna, a szerelő-néző épp azt nem látná, amiért a
   * képek felkerültek -- és a hiányzó szakasz ugyanúgy néz ki, mint a mai
   * hiány, amit ez a kör javít.
   */
  it("a csatolmány-szakasz nem a szerkesztési jogra van kapuzva", () => {
    const s = olvas(KEPERNYO);
    const szakasz = s.indexOf("Csatolmányok (");
    const kapu = s.indexOf("{capabilities.worksheetsManage ? (");
    assert.ok(szakasz !== -1, "nem találom a csatolmány-szakaszt");
    assert.ok(kapu !== -1, "nem találom a szerkesztési kaput");
    assert.ok(
      szakasz < kapu,
      "a csatolmány-szakasz a szerkesztési kapu mögé került: aki csak nézhet, nem látná a képeket",
    );
  });

  /**
   * A KÉP HITELESÍTETT FORRÁSBÓL JÖN -- MIND A KÉT NÉZETBEN.
   *
   * Egy csupasz `uri` a végponton 401-et kapna, a képernyőn pedig ÜRES
   * CSEMPEKÉNT jelenne meg -- vagyis pontosan úgy, mint a szakasz előtti hiány.
   *
   * A DARABSZÁM MÉRÉSBŐL KERÜLT IDE, ÉS AZ IKERSPECBŐL. A képernyőn KÉT
   * `<Image>` áll: a listában a CSEMPE (859. sor) és rákoppintásra a NAGY KÉP
   * rátéte (1386.). Egy pusztán jelenlétre illesztő állítás -- ez volt az első
   * alakja -- ZÖLDEN átengedné, ha az egyik csupasz `uri`-ra váltana: a másik
   * előfordulás tartaná életben.
   *
   * A hibajegy ikerspecjében ugyanez a sor állt, és ott 2026-09-17-én javítottuk
   * (#784). Ez a kör a MÁSIK hívóhely: egy mintát nem elég ott javítani, ahol
   * megtaláltuk.
   */
  it("a kép a hitelesített forrásból jön, mind a két nézetben", () => {
    const s = olvas(KEPERNYO);
    /*
      A MECHANIZMUS 2026-09-21-EN MEGVALTOZOTT, ES AZ ALLITAS UGYANAZT MERI.

      A hitelesitett kerest eddig a natív betolto vegezte (`source={forras}`, a
      tokennel a fejlecben). Androidon az a fejlec NEM ert celba: Balazs eles
      hibaja, 2026-09-21, es a meroeszkozom 401-et hozott vissza a keszulekrol.
      A bajtokat innentol a `DocumentImage` keri le, es helyi fajlba irja.

      A DARABSZAM MERESE VALTOZATLANUL KELL: egy jelenletre illeszto allitas
      zolden atengedne, ha az egyik nezet lemaradna, es a hiba NEMA lenne.
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
   * A FELTÖLTÉS UTÁN A GALÉRIA IS FRISSÜL. Enélkül a most feltöltött kép nem
   * jelenne meg -- a szerelő ugyanazt látná, amit a mai hiánynál: feltöltötte,
   * és nincs sehol.
   */
  it("a feltöltés a csatolmány-listát is érvényteleníti", () => {
    /**
     * AZ ÉRVÉNYTELENÍTÉS ALAKJÁRA ÁLL, NEM A KULCSRA -- és ezt a kalibráció
     * tanította meg, harmadszor ugyanabban az alakban.
     *
     * A puszta `queryKey: ["worksheet-documents", id]` minta ZÖLD MARADT,
     * amikor az érvénytelenítést kivettem: ugyanaz a kulcs ott áll a
     * `useQuery` DEFINÍCIÓJÁBAN is. A „hívás alakjára illessz" szabály tehát
     * SZÜKSÉGES, de nem elég -- a mintának EGYEDINEK is kell lennie arra, amit
     * véd. Ezért méri a darabszámot is: kettő kell belőle, a lekérdezés és az
     * érvénytelenítés.
     */
    const s = olvas(KEPERNYO);
    const db = s.split('queryKey: ["worksheet-documents", id]').length - 1;
    assert.equal(
      db,
      2,
      `a kulcs ${db} helyen áll: a lekérdezés ÉS az érvénytelenítés kell, különben a friss kép nem jelenne meg`,
    );
    assert.match(
      s,
      /invalidateQueries\(\{\s*queryKey: \["worksheet-documents", id\],\s*\}\)/,
      "a feltöltés után a galéria nem frissül: a friss kép nem jelenne meg",
    );
  });

  /**
   * NEM VEZETUNK BE `Modal`-t. Ebben az appban ma nulla áll (mérve 2026-09-17,
   * 235 fájlon), és a `label-code-field.tsx` fejléce kimondja, hogy a
   * bevezetése KÜLÖN döntés, mind a három rátéttel egyszerre. Egy félig
   * átállított elhelyezés rosszabb a mainál: két szabály állna egymás mellett,
   * és a másodikat semmi nem mérné.
   */
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
      valtozatot ker. A csempe gyorsulasa LATSZIK, a nagy kep elmosodasa NEM --
      ezert kell mind a kettot kulon szamolni.
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
    assert.match(s, /styles\.nagyRatet/);
  });

  /**
   * A NEM MEGNÉZHETŐ CSATOLMÁNY KI VAN MONDVA. Enélkül a szerelő koppintgatna
   * rajta, és azt hinné, elromlott.
   */
  it("a nem megnézhető csatolmány neve kiíródik", () => {
    assert.match(olvas(KEPERNYO), /describeUnviewableDocument\(doc\)/);
  });
});
