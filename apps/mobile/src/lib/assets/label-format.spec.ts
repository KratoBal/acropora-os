import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  LABEL_BAND_MM,
  LABEL_GAP_MM,
  LABEL_LENGTH_MM,
  LABEL_NUMBER_FONT_MM,
  LABEL_PADDING_MM,
  QR_MIN_MODULE_MM,
  QR_MODULES_ACROSS,
  labelLayout,
  labelPageSize,
  mmToPoints,
} from "./label-format";

/**
 * AMIT EZ A FÁJL ŐRIZ.
 *
 * A címke fekvő téglalap, mert a szalag 24 mm széles és folytonos (Balázs,
 * 2026-08-26). A lapméret a BEMENET, a QR mérete abból SZÁMOLÓDIK. Két külön
 * szabad szám (lapméret és QR-méret) azért nem maradhatott, mert az elcsúszásuk
 * néma: a PDF elkészül, a nyomtatás lefut, és csak a helyszíni beolvasás bukik.
 *
 * A modul-méret az egyetlen szám, ami a beolvashatóságról szól. A 0,3 mm-es alsó
 * határ IRODALMI érték, nem a mi mérésünk: küszöb, ami alatt nyomtatni sem
 * érdemes. Az elfogadás feltétele az ELSŐ próbálkozásra sikeres beolvasás.
 */

const SCREEN = "src/app/assets/[id].tsx";
const MODULE = "src/lib/assets/label-format.ts";
const SERVER_QR = "../api/src/service-assets/qr-svg.ts";

describe("mmToPoints", () => {
  it("uses the fixed PDF point, not a setting", () => {
    // 1 hüvelyk = 25,4 mm = 72 pont. Ez nem konfiguráció, hanem a formátum.
    assert.equal(mmToPoints(25.4), 72);
    assert.equal(mmToPoints(0), 0);
  });
});

describe("a lap a szalaghoz igazodik", () => {
  it("is landscape: the tape fixes the height, the length is free", () => {
    const { width, height } = labelPageSize();

    assert.ok(
      width > height,
      `fekvő lapot várunk, kapott: ${width} x ${height} pont`,
    );
    assert.ok(
      Math.abs(height - mmToPoints(LABEL_BAND_MM)) < 0.01,
      "a lap magassága a szalag szélessége",
    );
    assert.ok(
      Math.abs(width - mmToPoints(LABEL_LENGTH_MM)) < 0.01,
      "a lap hossza a szalag irányában szabad, és a bemenetből jön",
    );
  });

  /**
   * A LETTER MÉRET az, ami méret nélkül keletkezne (`expo-print`,
   * `kLetterPaperSize = 612 x 792`). Ez az állítás nem a mi kódunkról szól,
   * hanem arról, hogy a hibát FEL LEHET ISMERNI.
   */
  it("stays far from the page size that caused the earlier bug", () => {
    const { width, height } = labelPageSize();

    assert.ok(width < 612 && height < 792);
  });
});

describe("a QR mérete levezetés, nem beállítás", () => {
  it("gives the code the whole band, minus the margins", () => {
    const layout = labelLayout();

    assert.equal(layout.qrSizeMm, LABEL_BAND_MM - 2 * LABEL_PADDING_MM);
    assert.equal(layout.moduleMm, layout.qrSizeMm / QR_MODULES_ACROSS);
  });

  it("spends the length exactly once", () => {
    const layout = labelLayout();
    const used =
      2 * LABEL_PADDING_MM +
      layout.qrSizeMm +
      LABEL_GAP_MM +
      layout.textWidthMm;

    // Ha ez elcsúszik, a felirat vagy kilóg a szalagról, vagy helyet hagy
    // üresen -- és egyik sem hibaüzenet, hanem egy rosszul kinéző címke.
    assert.ok(
      Math.abs(used - LABEL_LENGTH_MM) < 1e-9,
      `a lap hossza ${LABEL_LENGTH_MM} mm, a felhasznált ${used} mm`,
    );
    assert.ok(layout.textWidthMm > 0, "a feliratnak maradnia kell helye");
  });

  /**
   * A TRIPWIRE. Nem bizonyíték, hogy beolvasható -- azt csak nyomtatás dönti el.
   * Azt viszont megfogja, ha valaki a sávot vagy a margót úgy állítja át, hogy a
   * modul a szokásos alsó határ alá esik.
   */
  it("keeps the module above the size below which printing is pointless", () => {
    const { moduleMm } = labelLayout();

    assert.ok(
      moduleMm >= QR_MIN_MODULE_MM,
      `a modul ${moduleMm.toFixed(3)} mm, a küszöb ${QR_MIN_MODULE_MM} mm`,
    );
  });

  /**
   * A KONTROLL: a modul fájlját tényleg elolvassuk. Enélkül a következő állítás
   * üres szövegen menne végig, és zölden mondaná, hogy nincs második konstans.
   */
  it("reads the module it claims to read", () => {
    const source = readFileSync(MODULE, "utf8");

    assert.ok(source.length > 1000);
    assert.match(source, /export function labelLayout/);
  });

  it("never keeps a second, freely settable QR size", () => {
    const source = readFileSync(MODULE, "utf8");

    // A régi alak: `LABEL_QR_SIZE_MM = 23` a lapméret MELLETT. Ez az a két szám,
    // aminek az elcsúszása néma volt. A TILTÁS A DEKLARÁCIÓRA szól, nem a névre:
    // a modul fejlécében a régi név említése a történet, nem a hiba.
    assert.doesNotMatch(source, /const LABEL_QR_SIZE_MM/);
    assert.match(
      source,
      /const qrSizeMm = LABEL_BAND_MM - 2 \* LABEL_PADDING_MM;/,
    );
  });
});

describe("a modulszám a szerverrel közös", () => {
  /**
   * A 45 NEM A MI VÁLASZTÁSUNK: a szerver fix Version 5 szimbólumot ad
   * (37 x 37 modul) és 4 modulnyi csendes zónát rajzol köré. Ha a szerver
   * verziót vált, a modul-méret itt változik meg anélkül, hogy bárki hozzányúlna
   * -- ezért ezt a számot ONNAN olvassuk vissza, nem hisszük.
   */
  it("derives the module count from the server source, not from belief", () => {
    const source = readFileSync(SERVER_QR, "utf8");

    assert.match(source, /export function createAssetQrSvg/);

    const version = /^const VERSION = (\d+);$/m.exec(source);
    const border = /const border = (\d+);/.exec(source);
    assert.ok(version, "nem találtam a VERSION konstanst a szerver kódjában");
    assert.ok(border, "nem találtam a csendes zóna szélességét");

    const symbol = Number(version![1]) * 4 + 17;
    const across = symbol + 2 * Number(border![1]);

    assert.equal(
      across,
      QR_MODULES_ACROSS,
      `a szerver ${across} modult rajzol, a címke ${QR_MODULES_ACROSS}-tel számol`,
    );
  });
});

/**
 * AZ ESZKÖZSZÁM 25 KARAKTER (`ESZK-20260826-133525-AB12`), mert a szerver
 * `generateCode` így állítja elő (`apps/api/src/common/code-generator.util.ts`).
 * A címke akkor jó, ha ez EGY SORBAN kifér: a szám a címke azonosító sora, a
 * levágott azonosító pedig rosszabb, mint a hiányzó.
 *
 * A szélességet Helvetica-Bold em-értékekkel becsüljük. A készüléken
 * `-apple-system` fut, ami nem ugyanaz a betűtípus, ezért a becslés TARTALÉKKAL
 * jó: 10 százalék ráhagyást követelünk meg.
 */
const BOLD_EM: Record<string, number> = {
  "-": 0.333,
  A: 0.722,
  B: 0.722,
  C: 0.722,
  D: 0.722,
  E: 0.667,
  F: 0.611,
  G: 0.778,
  H: 0.722,
  I: 0.278,
  J: 0.556,
  K: 0.722,
  L: 0.611,
  M: 0.833,
  N: 0.722,
  O: 0.778,
  P: 0.667,
  Q: 0.778,
  R: 0.722,
  S: 0.667,
  T: 0.611,
  U: 0.722,
  V: 0.667,
  W: 0.944,
  X: 0.667,
  Y: 0.667,
  Z: 0.611,
};
const DIGIT_EM = 0.556;
const FALLBACK_EM = 0.6;

function widthEm(text: string): number {
  let total = 0;
  for (const character of text)
    total +=
      character >= "0" && character <= "9"
        ? DIGIT_EM
        : (BOLD_EM[character] ?? FALLBACK_EM);
  return total;
}

describe("az eszközszám kifér a felirat sávjába", () => {
  const SAMPLE = "ESZK-20260826-133525-AB12";

  it("measures the number the server actually generates", () => {
    const source = readFileSync(
      "../api/src/common/code-generator.util.ts",
      "utf8",
    );

    // A minta alakja onnan jön, ahol a szám készül: előtag, 15 karakteres
    // időbélyeg, négy hexa karakter. Ha ez a szerkezet változik, a hossz is,
    // és akkor ezt a mérést újra kell futtatni.
    assert.match(source, /\.slice\(0, 15\)/);
    assert.match(source, /randomUUID\(\)\.slice\(0, 4\)/);
    assert.equal(SAMPLE.length, 25);
  });

  it("fits on one line, with room for a font that is not Helvetica", () => {
    const { textWidthMm } = labelLayout();
    const needed = widthEm(SAMPLE) * LABEL_NUMBER_FONT_MM;

    assert.ok(
      needed * 1.1 <= textWidthMm,
      `a szám ${needed.toFixed(1)} mm-t kér ${LABEL_NUMBER_FONT_MM} mm-es betűvel, ` +
        `a sáv ${textWidthMm} mm -- 10 százalék ráhagyással nem fér ki`,
    );
  });
});

describe("a képernyő ugyanabból a levezetésből dolgozik", () => {
  /**
   * A KONTROLL: a képernyő fájlját tényleg elolvassuk.
   */
  it("reads the screen it claims to read", () => {
    const source = readFileSync(SCREEN, "utf8");

    assert.ok(source.length > 1000);
    assert.match(source, /labelHtml/);
    assert.match(source, /labelPageSize\(\)/);
    assert.match(source, /labelLayout\(\)/);
  });

  it("never writes the millimetres into the style by hand", () => {
    const source = readFileSync(SCREEN, "utf8");
    const styleBlock = /@page \{ size: ([^;]+); margin: 0; \}/.exec(source);

    assert.ok(styleBlock, "nem találtam a @page szabályt a címke stílusában");
    // A stílusban a méret HELYE behelyettesítés, nem szám. Ha valaki visszaír
    // egy konkrét millimétert, ez pirosra vált -- és pont az a hiba, amitől a
    // hívás és a stílus elválhat.
    assert.match(styleBlock![1]!, /\$\{pageWidthMm\}mm \$\{pageHeightMm\}mm/);
  });

  it("puts the text beside the code, not under it", () => {
    const source = readFileSync(SCREEN, "utf8");

    // Fekvő elrendezésben a kód megkapja a teljes magasságot. Ha a szöveg alá
    // kerül vissza, a szövegsáv a modul-méretből venne el.
    assert.match(source, /display: flex; align-items: center/);
    assert.match(source, /width: \$\{qrSizeMm\}mm; height: \$\{qrSizeMm\}mm/);
    assert.match(source, /\.text \{ flex: none; width: \$\{textWidthMm\}mm/);
  });
});
