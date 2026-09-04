import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A MUNKANAPLO KET KEPERNYOJE -- FORRAS-SZINTEN MERVE.
 *
 * A kepernyok `@/` alaku importokat hasznalnak, tehat a teszt-forditasba nem
 * kerulhetnek be. A DONTESEK tiszta modulokban allnak es azok merve vannak; ami
 * viszont CSAK itt dol el: hogy a kettot OSSZEKOTOTTE-e valaki, es hogy a
 * szerkesztes joga a SZERVER valaszabol jon-e, nem a kepernyo sajat
 * szamolasabol.
 */

const dir = (...parts: string[]) =>
  join(__dirname, "..", "..", "..", "src", "app", "worksheets", ...parts);

function olvas(ut: string): string {
  try {
    return readFileSync(ut, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${ut}. Ez a KERESES hibaja, nem a lefedettsege.`,
    );
  }
}

const lap = olvas(dir("[id].tsx"));
const bejegyzes = olvas(dir("entries", "[id].tsx"));

describe("a munkalap képernyője és a napló", () => {
  it("a források betöltődtek, és tényleg azok, aminek mondjuk őket", () => {
    // ISMERT POZITIV KONTROLL: ures vagy masik fajlon a lenti allitasok
    // elbuknanak, es az okot a hianyzo fajlra fognank.
    assert.equal(lap.length > 2000, true);
    assert.equal(bejegyzes.length > 1000, true);
    assert.match(lap, /current\.lines\.map/);
    assert.match(bejegyzes, /Vissza a munkalapra/);
  });

  it("a MEZŐ a gombra nyílik, nem áll ott mindig", () => {
    /*
      Balazs kerese: "legyen rajta egy bejegyzes nevu gomb amire ha rakattint
      akkor szabadszavasan beirhatja". Egy mindig ott allo szovegdoboz minden
      lapon fogadna a szerelot.

      MI PIROSIT: ha a mezo feltetel nelkul rendezodne ki (a `null` kezdoallapot
      elhagyasa).
    */
    assert.match(lap, /useState<string \| null>\(null\)/);
    assert.match(lap, /entryDraft === null \?/);
  });

  it("a sorra koppintva KÜLÖN LAP nyílik, a bejegyzés azonosítójával", () => {
    /*
      MI PIROSIT: ha a lista csak kirajzolna, es nem navigalna -- akkor a
      "kulon lap" resz csendben elmaradna, es a szerkesztes sehol nem lenne
      elerheto.
    */
    assert.match(lap, /pathname: "\/worksheets\/entries\/\[id\]"/);
    assert.match(lap, /entryId: entry\.id/);
  });

  it("a napló KÜLÖN lekérdezés, nem a lap része", () => {
    /*
      A bejegyzesek a laptol fuggetlenul valtoznak (barki irhat rajuk). Egy
      kozos lekerdezesben minden bejegyzes-mentes ujrahuzna a teljes lapot is.
    */
    assert.match(lap, /queryKey: \["worksheet-entries", id\]/);
  });
});

describe("a bejegyzés lapja", () => {
  it("FELÜL van vissza gomb a munkalapra", () => {
    /*
      Balazs kifejezetten ezt kerte, es a telefon sajat visszalepese nem
      helyettesiti: aki melylinkbol vagy ertesitesbol erkezik, annak nincs hova
      visszalepnie.

      MI PIROSIT: a gomb torlese.
    */
    assert.match(bejegyzes, /pathname: "\/worksheets\/\[id\]"/);
  });

  it("a SZERKESZTÉS JOGA a szerver válaszából jön, nem a képernyő számolja", () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN. A szabaly (a lap keszitoje vagy
      a jegy nyitoja szerkeszthet) JOGOSULTSAGI szabaly: a szerver a kerest is
      elutasitja. Ha a keperno ujraszamolna, ket masolat allna ugyanarra, es a
      mobil amugy sem tudja importalni a szerver fuggvenyet.

      MI PIROSIT: barmilyen sajat feltetel a kepernyon (peldaul a bejelentkezett
      felhasznalo osszevetese a lap keszitojevel). Egy ilyen valtozat a
      tobbi allitason atmenne.
    */
    assert.match(bejegyzes, /entry\.canEdit \?/);
    assert.doesNotMatch(bejegyzes, /worksheetCreatedById/);
    assert.doesNotMatch(bejegyzes, /createdById/);
  });

  it("a HIÁNYZÓ gomb MELLETT ott az indoklás, szintén a szervertől", () => {
    /*
      Egy magyarazat nelkul hianyzo gomb ugy nez ki, mint hiba a programban --
      es ket kulon eset van (van kit megkerni, vagy senki nem szerkesztheti).

      MI PIROSIT: az `editRefusal` kirajzolasanak elhagyasa.
    */
    assert.match(bejegyzes, /\{entry\.editRefusal\}/);
  });

  it("a HIÁNYZÓ bejegyzést KIMONDJA, nem üres képernyővel", () => {
    // Ha a lista betoltodott es a sor nincs benne, az ures keperno ugy nezne ki,
    // mintha nem tortent volna semmi.
    assert.match(bejegyzes, /nem találjuk ezen a munkalapon/);
  });
});
