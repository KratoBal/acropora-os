import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A TETEL OFFLINE UTJA A KEPERNYON -- FORRAS-SZINTEN MERVE.
 *
 * A munkalap kepernyoje NEM forditható be a teszt-projektbe: `@/` alaku
 * importokat hasznal, es azokon at behuzna az Expo futasidot. A dontesek ezert
 * tiszta modulokban allnak (`offline/save-or-queue.ts`,
 * `worksheets/worksheet-line.ts`), es AZOK merve vannak.
 *
 * Ami viszont CSAK a kepernyon dol el: hogy a kettot tenyleg OSSZEKOTOTTE-E
 * valaki. Ez a fajl azt a nehany varratot koti le, aminek az elcsuszasa NEMA:
 * a felvitel latszolag sikerul, es a tetel sehol nem lesz. Gyengebb egy
 * komponens-tesztnel, de nem nulla -- pontosan azt a hibat fogja meg, ami a
 * leggyakoribb: valaki atirja a kepernyot, es semmi nem szol.
 */

const SCREEN = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "app",
  "worksheets",
  "[id].tsx",
);

function olvas(): string {
  try {
    return readFileSync(SCREEN, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${SCREEN}. Ez a KERESES hibaja, nem a lefedettsege -- a lenti allitasok addig semmit nem mondanak.`,
    );
  }
}

const forras = olvas();

describe("a munkalap képernyője és az offline sor", () => {
  it("a forrás betöltődött, és tényleg a tétel-felvitelt tartalmazó fájl", () => {
    /*
      ISMERT POZITIV KONTROLL. Egy ures vagy MASIK fajl a lenti allitasok
      tobbsegen (`doesNotMatch`) atmenne, es a zold semmit nem mondana.
    */
    assert.equal(forras.length > 2000, true);
    assert.match(forras, /buildWorksheetLinePayload/);
    assert.match(forras, /current\.lines\.map/);
  });

  it("a mentés a KÖZÖS döntésen megy át, nem közvetlenül a szervernek", () => {
    /*
      MI PIROSIT: ha a mutation visszaterne a puszta `addWorksheetLine(...)`
      hivasra. Az terero mellett MUKODIK, tehat a fejlesztoi gepen semmi nem
      szolna -- a pinceben viszont a tetel egyszeruen elveszne, es a szerelo
      csak egy hibauzenetet latna.
    */
    assert.match(forras, /saveOrQueue\(\{/);
    assert.match(forras, /enqueue: \(\) =>\s*\n?\s*enqueueWorksheetLine\(\{/);
  });

  it("EGY azonosító megy mind a két úton", () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN.

      A szerver a tetel `id` mezojere IDEMPOTENS: egy megszakadt kuldes
      ujrakuldese a MEGLEVO tetelt talalja meg. Ez CSAK akkor all, ha a sor
      kulcsa es a szervernek kuldott azonosito UGYANAZ. Ket kulon generalas
      mellett az ujrakuldes MASODIK tetelt hozna letre ugyanarrol a munkarol --
      es ez a hiba csak elesben, halozat-szakadaskor jonne elo.

      MI PIROSIT: egy masodik `worksheetLineId(...)` hivas a fajlban, vagy ha az
      `enqueue` nem a mar kiszamolt `lineId` erteket adna at.
    */
    const generalasok = [...forras.matchAll(/worksheetLineId\(\{/g)];
    assert.equal(generalasok.length, 1, "az azonosító egyszer születik");
    assert.match(forras, /const lineId = worksheetLineId\(\{/);
    assert.match(forras, /enqueueWorksheetLine\(\{\s*\n\s*id: lineId,/);
  });

  it("a GAZDA lap azonosítója rákerül a sorra", () => {
    /*
      MI PIROSIT: ha a `worksheetId` lemaradna. A sor akkor gazdatlan lenne, a
      kuldes 422-t adna magara, es a tetel elakadna -- a szerelo szemebol
      ok nelkul.
    */
    assert.match(forras, /worksheetId: id,/);
  });

  it("a mezők NEM ürülnek ki, ha a felvitel SEHOL nem létezik", () => {
    /*
      A `lost` kimenetnel a tetel se a szerveren, se a sorban nincs meg: a
      beirt szoveg az EGYETLEN peldany. Kitorolni ugyanaz a nema veszteseg,
      mint elvetni valamit kerdes nelkul -- csak itt meg kerdes sincs.

      MI PIROSIT: ha az `onSuccess` feltetel nelkul urítené a mezoket.
    */
    assert.match(
      forras,
      /outcome\.type === "rejected" \|\| outcome\.type === "lost"/,
    );
  });

  it("a lapon KIMONDJUK, ha van fel nem ment tétel", () => {
    /*
      A mentes utani mondat egyetlen kepernyo-eletre szol. Aki visszalep es ujra
      megnyitja a lapot, a sorban allo tetelbol SEMMIT nem latna: a lista a
      szerver valaszabol jon. Az a nema alak, amiben a szerelo ujra beirja
      ugyanazt.

      MI PIROSIT: ha a szamlalo lekerdezese vagy a mondat kirajzolasa
      kimaradna. A ketto KULON allitas: egy lekerdezes, amit senki nem rajzol
      ki, pontosan az a szakadas, amit ma tobbszor gyujtottunk.
    */
    assert.match(forras, /queuedWorksheetLineCount\(id\)/);
    assert.match(forras, /describeQueuedWorksheetLines\(/);
    assert.match(forras, /\{queuedLinesNotice\}/);
  });

  it("a sorba került tétel üzenete NEM a hiba-dobozban áll", () => {
    /*
      A sorba kerules nem hiba: a tetel megvan, csak meg a telefonon. Piros
      dobozban a szerelo elveszettnek hinne, es ujra beirna -- vagyis a
      megnyugtato mondat epp azt a kart okozna, ami ellen keszult.

      MI PIROSIT: ha a `queued` erteket a `styles.lineError` rajzolna ki.
    */
    assert.doesNotMatch(forras, /styles\.lineError\}>\{queued\}/);
    assert.match(
      forras,
      /\{queued \? <Text style=\{styles\.muted\}>\{queued\}/,
    );
  });
});

/**
 * A KIURITES UTVONALA -- SZINTEN FORRAS-SZINTEN.
 *
 * A `use-queue-drain.ts` hook `@/` alaku importokat hasznal (API-kliensek),
 * tehat a teszt-forditasba nem kerulhet be. Ami itt eldol es SEHOL MASHOL nem
 * merheto: hogy a tetel-sor a SAJAT vegpontjara megy-e. E nelkul a sor
 * atesne a lanc vegen allo ESZKOZ-agra, es a tetel torzsevel hivnank a
 * felviteli vegpontot.
 */
const DRAIN = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "lib",
  "offline",
  "use-queue-drain.ts",
);

const drainForras = (() => {
  try {
    return readFileSync(DRAIN, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${DRAIN}. Ez a KERESES hibaja, nem a lefedettsege.`,
    );
  }
})();

describe("a sor kiürítése és a tétel", () => {
  it("a forrás betöltődött, és tényleg a küldést tartalmazó fájl", () => {
    // ISMERT POZITIV KONTROLL, ugyanabbol az okbol, mint fent.
    assert.equal(drainForras.length > 2000, true);
    assert.match(drainForras, /drainOfflineQueue\(\{/);
  });

  it("a TÉTEL a saját végpontjára megy, nem esik át az eszköz-ágra", () => {
    /*
      A `send` egy IF-LANC, aminek az UTOLSO aga alapertelmezes: ami nem
      fenykep es nem munkalap, azt ESZKOZKENT kuldi el. Ha a tetel aga
      hianyozna, a tetel torzsevel hivnank a felviteli vegpontot -- es a hiba a
      SZERVEREN jelenne meg, ertelmetlen elutasitaskent.

      MI PIROSIT: a tetel-ag torlese vagy a sorrend olyan atirasa, hogy a lanc
      elobb erje el az eszkoz-agat.
    */
    assert.match(
      drainForras,
      /if \(row\.entityType === "worksheet-line"\) return tetelKuld\(row\);/,
    );
    assert.match(
      drainForras,
      /addWorksheetLine\(row\.entityId, \{ id: row\.id/,
    );
  });

  it("a küldés a SOR kulcsát viszi tételazonosítóként, nem a payloadét", () => {
    /*
      A szerver EPP ERRE idempotens: ugyanaz a kulcs ujrakuldve a MEGLEVO
      tetelt talalja meg. A payload SZANDEKOSAN nem hordoz azonositot (lasd
      `readQueuedWorksheetLine`), tehat ha valaki innen venne, `undefined`
      menne fel -- es a szerver minden ujrakuldesnel UJ tetelt hozna letre.

      MI PIROSIT: `id: payload.id` vagy a mezo elhagyasa.
    */
    assert.doesNotMatch(drainForras, /id: payload\.id/);
  });
});
