import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  LABEL_QR_SIZE_MM,
  LABEL_SIZE_MM,
  labelPageSize,
  mmToPoints,
} from "./label-format";

/**
 * A MÉRT HIBA, amit ez a fájl őriz (2026-08-26).
 *
 * A címke stílusa `@page { size: 30mm 30mm }`-et kért, a PDF mégis teljes lapra
 * készült, és a Brother alkalmazás hibát dobott rá. Az `expo-print` iOS forrása
 * szerint a lapméret a HÍVÁS `width`/`height` értékéből jön (`PrintOptions`,
 * `kLetterPaperSize = 612 x 792` az alapérték), a `@page` CSS-t ez az út nem
 * olvassa. A hívás pedig nem adott méretet.
 *
 * Amit ez a fájl mér: a váltószám helyes, ÉS a méret egyetlen helyen áll -- a
 * képernyő stílusa ugyanabból a számból dolgozik, mint a nyomtatási hívás.
 */

const SCREEN = "src/app/assets/[id].tsx";

describe("mmToPoints", () => {
  it("uses the fixed PDF point, not a setting", () => {
    // 1 hüvelyk = 25,4 mm = 72 pont. Ez nem konfiguráció, hanem a formátum.
    assert.equal(mmToPoints(25.4), 72);
    assert.equal(mmToPoints(0), 0);
  });

  it("turns the label size into the number the print call needs", () => {
    const { width, height } = labelPageSize();

    assert.equal(width, height, "a mai címke négyzet");
    assert.ok(
      Math.abs(width - 85.04) < 0.01,
      `30 mm = 85,04 pont, kapott: ${width}`,
    );
  });

  /**
   * A LETTER MÉRET az, ami méret nélkül keletkezne. Ez az állítás nem a mi
   * kódunkról szól, hanem arról, hogy a hibát FEL LEHET ISMERNI: ha egy PDF
   * 612 x 792 pontos, akkor a hívás nem kapott méretet.
   */
  it("stays far from the page size that caused the bug", () => {
    const { width } = labelPageSize();

    assert.ok(width < 612, "a címke lapja nem lehet Letter szélességű");
  });
});

describe("a címke mérete egyetlen helyen áll", () => {
  /**
   * A KONTROLL: a képernyő fájlját tényleg elolvassuk. Enélkül a következő
   * állítás üres szövegen menne végig, és zölden azt mondaná, hogy nincs
   * beégetett szám.
   */
  it("reads the screen it claims to read", () => {
    const source = readFileSync(SCREEN, "utf8");

    assert.ok(source.length > 1000);
    assert.match(source, /labelHtml/);
    assert.match(source, /labelPageSize\(\)/);
  });

  it("never writes the millimetres into the style by hand", () => {
    const source = readFileSync(SCREEN, "utf8");
    const styleBlock = /@page \{ size: ([^;]+); margin: 0; \}/.exec(source);

    assert.ok(styleBlock, "nem találtam a @page szabályt a címke stílusában");
    // A stílusban a méret HELYE egy behelyettesítés, nem szám. Ha valaki
    // visszaír egy konkrét millimétert, ez pirosra vált -- és pont az a hiba,
    // amitől a hívás és a stílus elválhat.
    assert.match(
      styleBlock![1]!,
      /\$\{LABEL_SIZE_MM\}mm \$\{LABEL_SIZE_MM\}mm/,
    );
  });

  it("keeps the QR smaller than the label it sits on", () => {
    assert.ok(
      LABEL_QR_SIZE_MM < LABEL_SIZE_MM,
      "a kódnak el kell férnie a címkén, a felirat helyét meghagyva",
    );
  });
});
