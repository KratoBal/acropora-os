import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { TILE_ENTRY, type TileCode } from "./tile-visibility";

/**
 * A SZERVIZES SORRENDJE BALÁZS KÉRÉSE, ÉS MA SEMMI NEM MÉRTE.
 *
 * Szó szerint (2026-09-16, Discord): "A sorrend ugy legyen szervizes
 * jogosultsaggal, hogy Hibajegyek, Munkalapok, Eszkozok, Partnerek".
 *
 * === MIÉRT NEM SZEREPKÖRÖNKÉNTI SORREND, ÉS MIT KELL EZÉRT MÉRNI ===
 *
 * A csempék sora RÖGZÍTETT; a szervizes azért kapja a kért sorrendet, mert csak
 * ezt a négyet LÁTJA. Ez az állítás tehát két dolog EGYÜTTESÉN áll: a képernyőn
 * álló sorrenden, és azon, hogy a szervizes mit lát. Ha bármelyik elmozdul --
 * valaki beszúr egy csempét a Hibajegyek elé, vagy a szervizes egyszer meglátja
 * a Rendeléseket --, a kért sorrend CSENDBEN elromlik.
 *
 * === MIÉRT A FORRÁS SZÖVEGÉBŐL ===
 *
 * Ebben a csomagban nincs komponens-teszt eszköz, tehát a kezdőképernyőt nem
 * lehet renderelni. Amit meg lehet mérni: a `code="XX"` sorok SORRENDJE a
 * forrásban. A határa kimondva: azt állítja, hogy a JSX ebben a sorrendben
 * sorolja fel a csempéket, nem azt, hogy a felhasználó így LÁTJA őket -- egy
 * `flexDirection: "row-reverse"` például átfordítaná, és ezt nem venné észre.
 */
const GYOKER = join(__dirname, "..", "..", "..", "src");

function olvas(ut: string): string {
  const teljes = join(GYOKER, ut);
  try {
    return readFileSync(teljes, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${teljes}. Ez a KERESÉS hibája, nem a lefedettségé.`,
    );
  }
}

/** A csempék kódja abban a sorrendben, ahogy a kezdőképernyő felsorolja őket. */
function kepernyoSorrend(): TileCode[] {
  const forras = olvas(join("app", "index.tsx"));
  return [...forras.matchAll(/code="([A-Z]+)"/g)].map(
    (talalat) => talalat[1] as TileCode,
  );
}

/** Egy csempe akkor látszik, ha a menütétele a mobilra szól és a szerep látja. */
function lathato(kod: TileCode, ertekek: readonly string[]): boolean {
  return ertekek.includes(TILE_ENTRY[kod]);
}

describe("a csempék sorrendje", () => {
  it("POZITÍV KONTROLL: a képernyőről tényleg kiolvashatók a csempék", () => {
    const sorrend = kepernyoSorrend();
    // Enélkül minden alábbi állítás ÜRES listán menne végig, és zölden mondaná,
    // hogy a sorrend rendben van.
    assert.ok(
      sorrend.length >= 8,
      `gyanúsan kevés csempét találtam: ${sorrend.join(", ")}`,
    );
    assert.deepEqual(
      [...new Set(sorrend)],
      sorrend,
      "ugyanaz a csempe kétszer szerepel a képernyőn",
    );
  });

  it("a szervizes ezt a négyet látja, EBBEN a sorrendben", () => {
    /**
     * A SZERVIZES MENÜJE, MÉRVE (nem feltételezve): a `service-jobs`,
     * `service-assets`, `worksheets` és `partners` tételek azok, amiket a
     * SERVICE szerep mobil felületen lát -- Balázs kérése, 2026-09-16, KIZÁRÓLAG
     * erre a négyre szólt, tehát az állítás is csak ezt méri.
     *
     * A `material-requests-pending` NEM KERÜL EBBE A LISTÁBA, holott a
     * SERVICE szerep 2026-09-23 óta AZT IS látja (a `SERVICE_MANAGE` jogon,
     * lásd `packages/types/src/navigation.ts`). Ez a lista Balázs KIMONDOTT
     * kérését méri, nem a szervizes TELJES menüjét -- azt a lenti "a teljes
     * sorrend rögzített" állítás fedi, minden szerepre együtt.
     */
    const szervizesMenu = [
      "service-jobs",
      "service-assets",
      "worksheets",
      "partners",
    ];

    const latott = kepernyoSorrend().filter((kod) =>
      lathato(kod, szervizesMenu),
    );

    assert.deepEqual(
      latott,
      ["HJ", "MU", "ES", "PA"],
      "Balázs kérése: Hibajegyek, Munkalapok, Eszközök, Partnerek",
    );
  });

  /**
   * TESTVÉR-KONTROLL: A TÖBBI SZEREP KÉPERNYŐJE SEM ESIK SZÉT.
   *
   * A fenti állítás akkor is zöld maradna, ha valaki a négy szervizes csempét
   * a lista elejére emelné, a többit pedig összekeverné. A tulajdonos kilenc
   * csempét lát, és azok sorrendje is számít -- csak nem Balázs kérése köti,
   * hanem az, hogy ne mozduljon el szó nélkül.
   *
   * 2026-09-23: hétről kilencre nőtt a `material-requests-pending` mobil
   * felülettel ("AI"), a Munkalapok és az Eszközök közé beszúrva. Ez az
   * állítás ELSÜLT, és ez a helyes viselkedés -- ugyanaz a minta, mint a
   * `HJ` felvételénél (lásd `tile-visibility.spec.ts`).
   */
  it("a teljes sorrend rögzített", () => {
    assert.deepEqual(kepernyoSorrend(), [
      "HJ",
      "MU",
      "AI",
      "ES",
      "RE",
      "BE",
      "TE",
      "NAV",
      "PA",
    ]);
  });
});
