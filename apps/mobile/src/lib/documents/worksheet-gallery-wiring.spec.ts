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
    assert.match(
      olvas(KLIENS),
      /\$\{BASE\}\/\$\{encodeURIComponent\(id\)\}\/documents/,
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
   * A KÉP HITELESÍTETT FORRÁSBÓL JÖN. Egy csupasz `uri` a végponton 401-et
   * kapna, a képernyőn pedig ÜRES CSEMPEKÉNT jelenne meg -- vagyis pontosan
   * úgy, mint a mai hiány.
   */
  it("a kép a hitelesített forrásból jön, nem csupasz címről", () => {
    const s = olvas(KEPERNYO);
    assert.match(s, /useDocumentImageSource\(/);
    assert.match(s, /source=\{forras\}/);
  });

  /**
   * A FELTÖLTÉS UTÁN A GALÉRIA IS FRISSÜL. Enélkül a most feltöltött kép nem
   * jelenne meg -- a szerelő ugyanazt látná, amit a mai hiánynál: feltöltötte,
   * és nincs sehol.
   */
  it("a feltöltés a csatolmány-listát is érvényteleníti", () => {
    assert.match(
      olvas(KEPERNYO),
      /queryKey: \["worksheet-documents", id\]/,
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
