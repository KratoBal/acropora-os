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
    execFileSync(process.execPath, [KAPU, naplo, vartUt], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return 0;
  } catch (hiba) {
    return (hiba as { status?: number }).status ?? -1;
  }
}

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
});
