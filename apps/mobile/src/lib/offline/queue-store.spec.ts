import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * AZ SQLITE REteg NEM UNIT-TESZTELHETO: az `expo-sqlite` natív runtime-ot
 * igenyel. Amit MEG LEHET merni, az a FORRASA -- es epp az a nehany
 * tulajdonsag, amin a felvitel megmaradasa all.
 */

const FORRAS_UT = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "lib",
  "offline",
  "queue-store.ts",
);

function olvas(): string {
  try {
    return readFileSync(FORRAS_UT, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${FORRAS_UT}. Ez a KERESES hibaja, nem a lefedettsege -- a lenti allitasok addig semmit nem mondanak.`,
    );
  }
}

const forras = olvas();

describe("a sor tárolójának szerkezete", () => {
  it("a forrás betöltődött", () => {
    // ISMERT POZITIV KONTROLL: egy ures fajl minden lenti allitast teljesitene.
    assert.equal(forras.length > 1500, true);
    assert.match(forras, /sync_queue/);
  });

  it("az enqueue VISSZAADJA a hibát, nem nyeli el", () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN.

      Az `asset-cache.ts` szandekosan ELNYELI az iras hibajat: ott a masolat
      kenyelem. ITT a sor a felvitel EGYETLEN letezo peldanya -- ha a beszuras
      elbukik es elnyeljuk, a kollega "elmentve" uzenetet lat, es a rogzites
      SEHOL nem letezik.

      MI PIROSIT: egy ures `catch {}` blokk, vagy barmi, ami nem adja tovabb a
      hibat.
    */
    assert.match(forras, /return\s*\{\s*\n?\s*ok:\s*false/);
    // ES NINCS BENNE URES CATCH. Az `asset-cache.ts` mintaja itt HIBA lenne.
    assert.doesNotMatch(forras, /catch\s*\{\s*\/\/[^\n]*\n\s*\}/);
  });

  it("a törlés CSAK azonosító szerint megy", () => {
    /*
      MI PIROSIT: egy `DELETE FROM sync_queue` feltetel nelkul, vagy allapot
      szerinti torles. Egy ilyen sor a NEM nyugtazott felviteleket is elvinne --
      es azok utan semmi nem maradna.
    */
    const torlesek = [...forras.matchAll(/DELETE FROM sync_queue[^`]*/g)].map(
      (m) => m[0].trim(),
    );
    assert.deepEqual(torlesek, ["DELETE FROM sync_queue WHERE id = ?"]);
  });

  it("a küldhető sorok listája ÁLLAPOT szerint szűr", () => {
    // Egy szures nelkuli lekerdezes a `conflict` sorokat is ujrakuldene --
    // azokat, amik emberre varnak.
    assert.match(forras, /WHERE state IN/);
    assert.match(forras, /KULDHETO/);
  });
});

describe("a fénykép sora", () => {
  it("a művelet nevét OLVASSUK, nem állítjuk", () => {
    /*
      A beolvasas eddig `operation: "create"`-et irt minden sorra -- amig
      egyfele sor volt, ez igaz is volt. Egy `upload-photo` sor viszont igy
      rogzitesnek latszana, es a szinkron egy KEP payloadjaval hivna a felviteli
      vegpontot: a hiba a SZERVEREN jelenne meg, ertelmetlen elutasitaskent.

      MI PIROSIT: a literal visszairasa a lekepezesbe.
    */
    assert.match(
      forras,
      /operation: r\.operation as SyncQueueRow\["operation"\]/,
    );
  });

  it("csak ISMERT sort küldünk el, és az ismeretlent nem dobjuk el", () => {
    // Egy ismeretlen muveletet vagy entitast egy UJABB valtozat irhatott a
    // sorba. Nem talalgatjuk (az a szerverig menne), es nem is toroljuk (az a
    // felvitel egyetlen peldanya lehet): a sorban marad, csak nem indul el.
    assert.match(forras, /ismertSor/);
    assert.doesNotMatch(forras, /DELETE FROM sync_queue WHERE operation/);
  });

  it("az ENTITÁST is OLVASSUK, nem állítjuk", () => {
    /*
      A beolvasas eddig minden sorra `"asset"`-et irt. Amig egyfele entitas
      volt, ez igaz is volt. Egy MUNKALAP sor viszont igy eszkoznek latszana,
      es a szinkron a munkalap payloadjaval hivna az ESZKOZ vegpontjat.

      MI PIROSIT: a literal visszairasa a lekepezesbe.
    */
    assert.match(
      forras,
      /entityType: r\.entity_type as SyncQueueRow\["entityType"\]/,
    );
  });

  it("MINDHÁROM sorfajta IDEMPOTENS beszúrással megy be", () => {
    /*
      MI PIROSIT: egyetlen sima `INSERT` barmelyik agban. Akkor a ketszer
      megnyomott gomb ket sort tenne a sorba, es ugyanaz a felvitel KETSZER
      menne fel.

      A HARMAS SZAM MAGA IS ALLITAS: eszkoz, munkalap, fenykep. Ha egy negyedik
      sorfajta jon, ez a sor pirosra valt, es akkor kell eldonteni, hogy az uj
      ag is idempotens-e.
    */
    const beszurasok = [
      ...forras.matchAll(/INSERT( OR IGNORE)? INTO sync_queue/g),
    ].map((m) => m[0]);
    assert.deepEqual(beszurasok, [
      "INSERT OR IGNORE INTO sync_queue",
      "INSERT OR IGNORE INTO sync_queue",
      "INSERT OR IGNORE INTO sync_queue",
    ]);
  });

  it("a MUNKALAP sora munkalap entitással megy be", () => {
    // MI PIROSIT: ha a munkalap `'asset'` entitassal kerulne a sorba. A
    // kuldes az entitasbol dont, tehat a lap az ESZKOZ vegpontjara menne.
    assert.match(forras, /VALUES \(\?, 'create', 'worksheet', NULL/);
  });

  it("a párosítás CSAK a címzetlen fotó-sorokat érinti", () => {
    /*
      MI PIROSIT: ha a lekerdezes elhagyna az `entity_id IS NULL` feltetelt vagy
      a muvelet szurest. Az elso egy MASIK eszkozhoz mar hozzarendelt kepre irna
      ra egy ujabb azonositot; a masodik a rogzites sorat modositana.
    */
    assert.match(
      forras,
      /WHERE operation = 'upload-photo' AND entity_id IS NULL/,
    );
    assert.match(forras, /UPDATE sync_queue SET entity_id = \? WHERE id = \?/);
  });
});

describe("a hátralék számai", () => {
  it("a számlálás MŰVELET szerint is bont", () => {
    /*
      Egy csak allapot szerinti csoportositas EGY szamot adna, es abbol nem
      derulne ki, hogy a sorban mar CSAK kepek allnak -- pontosan az az
      allapot, ami "sikeres szinkronnak" latszik.

      MI PIROSIT: a `operation` kivetele a csoportositasbol.
    */
    assert.match(forras, /GROUP BY state, operation/);
    assert.match(forras, /recordings: szam\(varakozo, "create"\)/);
    assert.match(forras, /photos: szam\(varakozo, "upload-photo"\)/);
  });
});

describe("az ismételten elbukó sorok", () => {
  it("a KÜSZÖB fölötti VÁRAKOZÓ sorokat kérdezi le", () => {
    /*
      A `conflict` sorok KIMARADNAK: azoknak mar van sajat mondatuk (a szerver
      elutasitotta, ember kell hozza). Ket mondat ugyanarrol a sorrol azt
      sugallna, hogy ket kulon baj van.

      MI PIROSIT: a `state` szures elhagyasa, vagy a kuszob-osszehasonlitas
      kivetele -- utobbitol MINDEN varakozo sor "ismetelten elbukonak"
      latszana, mar az elso probalkozas elott.
    */
    assert.match(
      forras,
      /WHERE state IN \('pending', 'failed', 'syncing'\) AND attempt_count >= \?/,
    );
  });

  it("a LEGTÖBBSZÖR próbált sor hibáját adja vissza", () => {
    // A sorrend maga az allitas: a szam es a hibaszoveg UGYANARROL a sorrol
    // valo legyen. Kulonben a mondat egy sor kiserletszamat egy masik sor
    // hibajaval parositana.
    assert.match(forras, /ORDER BY attempt_count DESC/);
  });

  it("a küszöb HÁROM, és a szám mellé oda van írva, miért", () => {
    /*
      A hatar nem ido, hanem esemeny: egy kiserlet nagyjabol egy app-indulas
      vagy egy offline-online atmenet. Harom kiserlet tehat harom KULON
      alkalom, amikor volt halozat es megsem ment fel.

      MI PIROSIT: a szam nemá atirasa. A specnek nem az a dolga, hogy a
      hatart vedje, hanem hogy egy VALTOZAS dontes legyen, ne mellekhatas.
    */
    assert.match(forras, /ISMETLODO_HIBA_HATAR = 3/);
    assert.match(forras, /A HATAR NEM IDO, HANEM ESEMENY/);
  });
});
