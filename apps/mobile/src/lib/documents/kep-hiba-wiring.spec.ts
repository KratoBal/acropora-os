import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A MÉRŐESZKÖZ BEKÖTÉSE -- FORRÁS SZINTEN.
 *
 * MIÉRT NEM RENDERELÉSSEL: az `apps/mobile` alatt nincs komponens-teszt eszköz
 * (lásd a `new-service-job-screen.spec.ts` fejlécét). Amit itt mérünk: hogy a
 * két kép-hely TÉNYLEG a mérő komponenst hívja, és nem maradt ott egy nyers
 * `Image`, ami hiba esetén csendben üres helyet hagy.
 *
 * MIÉRT ÉR EZ BÁRMIT: ez a szakasz EGY éles hibáról szól, amit a készülék tud
 * megválaszolni. Ha az egyik hely visszacsúszik nyers `Image`-re, a mérés fele
 * elvész -- és pont az a fele, amit Balázs külön kiemelt ("se a kis se ha
 * rakkatintasz a nagy kep").
 */
const KEPERNYO = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "app",
  "service-jobs",
  "[id].tsx",
);

const forras = (() => {
  try {
    return readFileSync(KEPERNYO, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${KEPERNYO}. Ez a KERESÉS hibája, nem a lefedettségé.`,
    );
  }
})();

describe("a kép-hiba mérőeszköz bekötése a hibajegy lapján", () => {
  it("POZITÍV KONTROLL: a képernyő olvasható és nem üres", () => {
    assert.ok(forras.length > 2000, "a képernyő üres vagy gyanúsan rövid");
  });

  /**
   * MIND A KÉT HELY, KÜLÖN ÁLLÍTÁSSAL. Egy közös darabszám-állítás átmenne
   * akkor is, ha ugyanaz a hely szerepelne kétszer.
   */
  it("a csempe a mérő komponenst rajzolja", () => {
    assert.match(
      forras,
      /<DocumentImage\s+source=\{forras\}\s+style=\{styles\.csempeKep\}/,
    );
  });

  it("a teljes nézet is a mérő komponenst rajzolja", () => {
    assert.match(
      forras,
      /<DocumentImage\s+source=\{forras\}\s+style=\{styles\.nagyKep\}/,
    );
  });

  /**
   * ÉS NEM MARADT NYERS `Image` A KÉP-FORRÁSRA. A negatív állítás mellé a két
   * pozitív (fent) adja a kontrollt: azok bizonyítják, hogy a keresés meg
   * tudja találni a kép-helyeket, amikor ott vannak.
   */
  it("nem maradt nyers Image a hitelesített forrásra", () => {
    assert.ok(
      !/<Image\s+source=\{forras\}/.test(forras),
      "egy nyers Image még ott áll a kép-forráson",
    );
  });
});
