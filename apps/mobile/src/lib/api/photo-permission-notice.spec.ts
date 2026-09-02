import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { photoPermissionDeniedNotice } from "./photo-permission-notice";

describe("mit mond a felület megtagadott jogosultságnál", () => {
  /**
   * A MEGTAGADOTT KAMERA NEM ZSÁKUTCA, ÉS EZ AZ EGÉSZ FÜGGVÉNY OKA.
   *
   * A kamera az elsődleges út. Ha a szerelő egyszer rányomott a "Ne engedd"
   * gombra, egy puszta hibaüzenet azt hagyná hátra, hogy egyáltalán nem tud
   * képet feltölteni - holott a galéria nyitva áll.
   */
  it("a kamera megtagadásánál felkínálja a galériát", () => {
    const notice = photoPermissionDeniedNotice("camera");

    assert.match(notice, /beállításai/);
    // A MINTA A SZÓTŐRE MEGY, NEM A SZÓTÁRI ALAKRA. Az első változatom
    // "galéria" volt, és elbukott: a szövegben "galériából" áll, ahol a
    // hetedik betű "á", nem "a". A magyar toldalék a tövet is átírja - egy
    // szótári alakra épülő keresés itt csendben nem talál.
    assert.match(notice, /galéri/i);
  });

  /**
   * A GALÉRIÁNÁL NINCS MIT FELKÍNÁLNI, és a kamerát felajánlani félrevezető
   * volna: aki a galériát nyitja, épp egy KORÁBBI képet keres.
   */
  it("a galéria megtagadásánál nem ajánlja a kamerát", () => {
    const notice = photoPermissionDeniedNotice("library");

    assert.match(notice, /beállításai/);
    // POZITÍV KONTROLL A TAGADÁSHOZ: a "kamera" szó ott van a másik
    // üzenetben (az első állítás méri), tehát ez a keresés MEG TUDNÁ
    // találni, ha a szöveg tartalmazná.
    assert.doesNotMatch(notice, /kamer/i);
  });
});
