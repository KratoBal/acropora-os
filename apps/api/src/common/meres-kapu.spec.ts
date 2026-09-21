import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A MERES-KAPU KALIBRACIOJA, MIND A NEGY KIMENETERE.
 *
 * A kapu (`scripts/meres-kapu.mjs`) egy MEGFORDITOTT verdiktet mond ki: a
 * meres-agakon a ZOLD azt jelenti, hogy a szandekos rontas ELSULT, a PIROS azt,
 * hogy a kor nem mert semmit. Egy ilyen allitas pontosan akkor veszelyes, ha nem
 * tud megbukni -- egy "a bukas a vart eredmeny" alaku kapu barmilyen osszeomlast
 * sikernek olvasna.
 *
 * EZERT A LEGFONTOSABB ESET NEM A ZOLD, HANEM A HARMADIK: egy RENDES, ZOLD futas
 * naploja (ahol semmi nincs elrontva) PIROSAT kell adjon. acrobot kifejezetten
 * ezt kotote ki, es ez az a kalibracio, ami nelkul a kapu diszlet lenne.
 *
 * A FIXTURAK VALODI FUTASOK KIVAGOTT RESZLETEI, nem kitalalt TAP-szovegek -- a
 * futas-azonositokkal egyutt a `meres-kapu-fixturak/OLVASSEL.md`-ben allnak.
 * Az elso kivagasom a ket meres-korbol BETURE AZONOS reszletet adott volna
 * (mindketto ugyanugy kezdodik); a vagas ezert a MEGKULONBOZTETO tartalomra megy.
 */

const KAPU = join(process.cwd(), "..", "..", "scripts", "meres-kapu.mjs");
const FIXTURAK = join(process.cwd(), "src", "common", "meres-kapu-fixturak");

function futtat(naplo: string, vartSorok: string[] | null) {
  const mappa = mkdtempSync(join(tmpdir(), "meres-kapu-"));
  let vartUt = join(mappa, "nincs-ilyen.txt");
  if (vartSorok !== null) {
    vartUt = join(mappa, "meres-vart.txt");
    writeFileSync(vartUt, vartSorok.join("\n"));
  }
  try {
    kimenet = execFileSync(process.execPath, [KAPU, naplo, vartUt], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return 0;
  } catch (hiba) {
    kimenet = String((hiba as { stdout?: string }).stdout ?? "");
    return (hiba as { status?: number }).status ?? -1;
  }
}

/**
 * AZ UTOLSO FUTAS KIMENETE. Modul-szintu, mert a `futtat` a KILEPESI KODOT
 * adja vissza -- az a hat meglevo allitas szerzodese, es azt nem irom at egy
 * hetedik kedveert. A lathatosagi jelzest viszont csak a SZOVEG mutatja.
 */
let kimenet = "";

/** A ket nev, ami a ket meres-kort elvalasztja egymastol. */
const VART = [
  "a suite marka-esemenyei bent maradtak a takaritas utan",
  "a suite lekepezes-sorai bent maradtak a takaritas utan",
];

describe("meres-kapu", () => {
  it("a teljes kor naplojan ZOLD: minden vart nyom megjelent", () => {
    assert.equal(futtat(join(FIXTURAK, "teljes.naplo.txt"), VART), 0);
  });

  /**
   * A HIANYOS KOR PIROS, ES EZ NEM ELMELETI: a 35001520746 futason a brands
   * suite EL SEM INDULT (a lepes `bash -e` hejja megallt az elso bukasnal), tehat
   * hat szamlalo neve hianyzott. A regi alakban ez a kor is csak egy "Run failed"
   * level volt; itt a kapu MEGNEVEZI, mi hianyzik.
   */
  it("a hianyos koron PIROS, mert a vart nyomok egy resze hianyzik", () => {
    assert.equal(futtat(join(FIXTURAK, "hianyos.naplo.txt"), VART), 1);
  });

  /**
   * EZ A KALIBRACIO LELKE (acrobot kikotese): ha a meres-kor NEM ront el semmit,
   * a naplo egy rendes zold futase, es a kapunak PIROSAT kell adnia. Enelkul egy
   * ures kor is "sikeres meresnek" latszana.
   */
  it("egy rendes ZOLD futas naplojan PIROS: az a kor nem mert semmit", () => {
    assert.equal(futtat(join(FIXTURAK, "zold.naplo.txt"), VART), 1);
  });

  it("vart-fajl nelkul MEGALL (2), nem enged at", () => {
    assert.equal(futtat(join(FIXTURAK, "teljes.naplo.txt"), null), 2);
  });

  it("ures vart-fajlnal is MEGALL (2)", () => {
    assert.equal(
      futtat(join(FIXTURAK, "teljes.naplo.txt"), ["# csak megjegyzes", ""]),
      2,
    );
  });

  it("olvashatatlan naplonal sajat kodot ad (3), nem pirosat", () => {
    assert.equal(futtat(join(FIXTURAK, "nincs-ilyen.naplo.txt"), VART), 3);
  });

  /**
   * A KAPU SAJAT VAK FOLTJA, NEV SZERINT -- ES EZ ELES ESETBOL JON.
   *
   * A TAP-ban a bukas jelolese `not ok`, vagyis a SIKERES alak (`ok 1 - X`)
   * SZOVEGRESZE a bukott alaknak (`not ok 1 - X`). Amig a kapu a TELJES
   * naplora hivta a `includes`-t, egy `ok N - ...` alaku varakozas a SAJAT
   * BUKASARA illeszkedett.
   *
   * MERVE 2026-09-21, a 35659262803 futason: a meres-ag ZOLDET kapott ugy,
   * hogy a POZITIV KONTROLLJA elbukott. A naploban `not ok 1 - a torles-sor
   * MEGJELENIK` allt, a vart-fajlban `ok 1 - a torles-sor MEGJELENIK`, es a
   * kapu haromból harom nyomot talalt.
   *
   * EZ NEM EGY AG HIBAJA VOLT: a flotta MINDEN meres-aganak a pozitiv
   * kontrollja szerkezetileg NEM TUDOTT ELBUKNI -- eppen az a fajta orzo,
   * ami ellen a kapu fejlece ervel.
   */
  it("`ok N` varakozast NEM elegit ki a sajat `not ok N` bukasa", () => {
    const mappa = mkdtempSync(join(tmpdir(), "meres-kapu-notok-"));
    const naplo = join(mappa, "naplo.txt");
    writeFileSync(
      naplo,
      [
        "TAP version 13",
        "    not ok 1 - a torles-sor MEGJELENIK",
        "# fail 1",
      ].join("\n"),
    );
    assert.equal(
      futtat(naplo, ["ok 1 - a torles-sor MEGJELENIK"]),
      1,
      "a bukott allitas NEM elegitheti ki a sikert varo sort",
    );
  });

  /**
   * ES A PARJA, MERT KULONBEN A FENTI EGY MINDENT ELUTASITO KAPUVAL IS ZOLD:
   * ugyanaz a naplo, `not ok` alaku varakozassal, ATMEGY. Ez mutatja, hogy a
   * szukites CSAK a kimenetelre szol, nem a sor megtalalasara.
   */
  it("ugyanazon a naplon a `not ok` alaku varakozas ATMEGY", () => {
    const mappa = mkdtempSync(join(tmpdir(), "meres-kapu-notok2-"));
    const naplo = join(mappa, "naplo.txt");
    writeFileSync(
      naplo,
      [
        "TAP version 13",
        "    not ok 1 - a torles-sor MEGJELENIK",
        "# fail 1",
      ].join("\n"),
    );
    assert.equal(futtat(naplo, ["not ok 1 - a torles-sor MEGJELENIK"]), 0);
  });

  /**
   * A TOREDEK-VARAKOZAS VALTOZATLAN: aki nem ir `ok` vagy `not ok` elotagot,
   * NEM NYILATKOZIK a kimenetelrol, es mind a kettore illeszkedik. A meglevo
   * meres-agak tobbsege ilyen, tehat ezt elvenni csendben elvagna oket.
   */
  it("a kimenetelrol nem nyilatkozo toredek tovabbra is illeszkedik", () => {
    const mappa = mkdtempSync(join(tmpdir(), "meres-kapu-toredek-"));
    const naplo = join(mappa, "naplo.txt");
    writeFileSync(naplo, "    not ok 1 - a torles-sor MEGJELENIK");
    assert.equal(futtat(naplo, ["a torles-sor MEGJELENIK"]), 0);
  });

  /**
   * A TOREDEK-VARAKOZAS LATHATOSAGA -- NEM VERDIKT, HANEM JELZES.
   *
   * Egy elotag nelkuli toredek szandekosan illeszkedik a `not ok` sorra is: a
   * hivo nem nyilatkozott a kimenetelrol. A 2026-09-21-i eset gyokere viszont
   * eppen az volt, hogy a szerzo fejeben SIKERT nevezett meg a varakozas.
   *
   * A kapu ezert KIIRJA, ha egy toredek CSAK bukott allitason jelent meg -- es
   * a SORT is, nem csak a tenyt. A verdikt valtozatlan: a varakozas
   * teljesitette, amit kert.
   */
  it("jelzi, ha egy toredek CSAK bukott allitason jelent meg", () => {
    const mappa = mkdtempSync(join(tmpdir(), "meres-kapu-jelzes-"));
    const naplo = join(mappa, "naplo.txt");
    writeFileSync(naplo, "    not ok 3 - a lap MEGJELENIK");

    assert.equal(
      futtat(naplo, ["a lap MEGJELENIK"]),
      0,
      "a verdikt NEM valtozik",
    );
    assert.match(kimenet, /CSAK bukott allitason/);
    assert.match(kimenet, /not ok 3 - a lap MEGJELENIK/);
  });

  /**
   * ES A PARJA: ha a toredek SIKERES allitason is megjelenik, NINCS jelzes.
   * Enelkul egy "mindig szolo" valtozat is atmenne a fenti allitason -- es egy
   * orzo, ami folyamatosan szol, ugyanaz, mint amelyik sosem.
   */
  it("NEM jelez, ha a toredek sikeres allitason is megjelenik", () => {
    const mappa = mkdtempSync(join(tmpdir(), "meres-kapu-jelzes2-"));
    const naplo = join(mappa, "naplo.txt");
    writeFileSync(
      naplo,
      ["    not ok 3 - a lap MEGJELENIK", "    ok 9 - a lap MEGJELENIK"].join(
        "\n",
      ),
    );

    assert.equal(futtat(naplo, ["a lap MEGJELENIK"]), 0);
    assert.doesNotMatch(kimenet, /CSAK bukott allitason/);
  });

  /**
   * ES A HARMADIK: a te sajat fixturaid egyikere SEM sul el. Ezt lemertem,
   * mielott a jelzest megirtam volna: a `teljes.naplo.txt`-ben a ket varakozas
   * a bukas DIAGNOSZTIKAI soraira illeszkedik (`- a suite ...: 8`), nem `not
   * ok` sorra. Ha elsulne, a jelzes minden meres-korben szolna, es akkor
   * ugyanaz lenne, mint amelyik sosem.
   */
  it("a meglevo fixturakon NEM szolal meg", () => {
    assert.equal(futtat(join(FIXTURAK, "teljes.naplo.txt"), VART), 0);
    assert.doesNotMatch(kimenet, /CSAK bukott allitason/);
  });
});
