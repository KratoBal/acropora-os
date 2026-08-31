import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  LABEL_BAND_MM,
  LABEL_GAP_MM,
  LABEL_LENGTH_MM,
  LABEL_NUMBER_FONT_MM,
  LABEL_PADDING_MM,
  LABEL_ROUNDING_ALLOWANCE_MM,
  MODULE_GRID_MM,
  QR_MIN_MODULE_MM,
  QR_MODULES_ACROSS,
  labelAssetNumber,
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
  it("gives the code the largest size that sits on the printer grid", () => {
    const layout = labelLayout();
    const availableMm =
      LABEL_BAND_MM - 2 * LABEL_PADDING_MM - LABEL_ROUNDING_ALLOWANCE_MM;

    // A KÓD MÁR NEM KAPJA MEG A TELJES SÁVOT, és ez szándékos: a maradék
    // nélküli osztás olyan modult adott, ami egyik felbontáson sem volt egész
    // pont. Amit a méretből feladunk, azt a modul-háló egyenletességéért
    // kapjuk vissza.
    assert.ok(layout.qrSizeMm <= availableMm);
    assert.equal(layout.moduleMm, layout.qrSizeMm / QR_MODULES_ACROSS);

    // A modul a rács egész számú többszöröse, és a KÖVETKEZŐ lépés már nem
    // férne bele -- vagyis tényleg a legnagyobb, nem csak egy biztonságos.
    const steps = layout.moduleMm / MODULE_GRID_MM;
    assert.equal(steps, Math.round(steps));
    assert.ok((steps + 1) * MODULE_GRID_MM * QR_MODULES_ACROSS > availableMm);
  });

  /**
   * A LÉNYEGI ÁLLÍTÁS, ÉS EZÉRT VAN AZ EGÉSZ VÁLTOZTATÁS: a modul EGÉSZ SZÁMÚ
   * nyomtatási pont mindhárom szóba jövő felbontáson. A régi levezetés
   * 3,27 / 5,44 / 6,53 pontot adott, tehát a raszterizálás egyes modulokat
   * szélesebbre kerekített a szomszédjuknál.
   *
   * Ez azért erős, mert NEM KELL TUDNUNK a nyomtató felbontását -- a gyártói
   * lapból nem is sikerült igazolni.
   */
  it("is a whole number of printer dots at 180, 300 and 360 dpi", () => {
    const { moduleMm } = labelLayout();

    for (const dpi of [180, 300, 360]) {
      const dots = moduleMm / (25.4 / dpi);

      // A TŰRÉS A LEBEGŐPONTOSSÁGÉ, NEM A GEOMETRIÁÉ. Az 1/60 hüvelyk 300
      // dpi-n PONTOSAN 5 pont; a kettes számrendszerben viszont
      // 4,999999999999999 jön ki. A határ ezért szűk: nagyságrendekkel
      // kisebb, mint a legkisebb valódi eltérés, ami egyáltalán számítana.
      assert.ok(
        Math.abs(dots - Math.round(dots)) < 1e-9,
        `${dpi} dpi-n a modul ${dots} pont, tehát nem egész`,
      );
    }
  });

  /**
   * ÉS AMIT A RÁCS NEM AD MEG. Az egyenletes modul-háló nem beolvashatóság: azt
   * a modul MÉRETE dönti el. A kettő külön kérdés, és ez a sor őrzi, hogy a
   * kisebb kód se essen az irodalmi küszöb alá.
   */
  it("stays above the module size a phone camera can read", () => {
    assert.ok(labelLayout().moduleMm >= QR_MIN_MODULE_MM);
  });

  it("accounts for the whole length, and leaves the slack it planned", () => {
    const layout = labelLayout();
    const used =
      2 * LABEL_PADDING_MM +
      layout.qrSizeMm +
      LABEL_GAP_MM +
      layout.textWidthMm;

    // A lap minden milliméterének helye van: ami nincs felhasználva, az a
    // tartalék. Ha ez elcsúszik, a felirat vagy kilóg a szalagról, vagy helyet
    // hagy üresen -- és egyik sem hibaüzenet, hanem egy rosszul kinéző címke.
    assert.ok(
      Math.abs(used + layout.widthSlackMm - LABEL_LENGTH_MM) < 1e-9,
      `a lap hossza ${LABEL_LENGTH_MM} mm, a felhasznált ${used} mm`,
    );
    assert.ok(layout.textWidthMm > 0, "a feliratnak maradnia kell helye");
  });

  /**
   * A MÉRT HIBA, AMIT EZ ŐRIZ (2026-08-26 este). A kinyomtatott PDF KÉT oldalas
   * lett, a második teljesen üres, és a nyomtató alkalmazása nem fogadta el.
   * Mindkét oldal 48 x 24 mm volt, tehát a lapméret jó volt: a tartalom volt
   * PONTOSAN akkora, mint a lap, mindkét irányban, nulla tartalékkal.
   *
   * Az elrendezés képpontban számol, és a 21 mm nem egész számú képpont. Egy
   * felfelé kerekítés így új oldalt nyitott.
   *
   * EZ AZ ÁLLÍTÁS SZÁNDÉKOSAN NEM SZÁMRA SZÓL. Egy „a QR 20,7 mm" alakú teszt a
   * következő méretváltoztatásnál újra nullára futna, és megint zöld lenne.
   */
  it("leaves room for a rounding up, in both directions", () => {
    const layout = labelLayout();

    assert.ok(
      layout.heightSlackMm > 0,
      `a magasságban nem maradt tartalék: ${layout.heightSlackMm} mm`,
    );
    assert.ok(
      layout.widthSlackMm > 0,
      `a hosszban nem maradt tartalék: ${layout.widthSlackMm} mm`,
    );
  });

  it("sizes that room by the mechanism, not by taste", () => {
    // A CSS képpont a formátum szerint 1/96 hüvelyk. Ennyi a legnagyobb ár,
    // amit egy felfelé kerekítés kérhet, tehát ennyi a tartalék mértéke is.
    assert.equal(LABEL_ROUNDING_ALLOWANCE_MM, 25.4 / 96);

    const layout = labelLayout();

    // A HOSSZ irányában a tartalék változatlanul PONTOSAN ennyi: ott a felirat
    // tölti ki a maradékot, tehát egy képpontnyi hely a teljes ráhagyás.
    assert.ok(
      Math.abs(layout.widthSlackMm - LABEL_ROUNDING_ALLOWANCE_MM) < 1e-9,
    );

    // A MAGASSÁG irányában viszont már TÖBB marad, és ez nem elcsúszás: a
    // modul a nyomtató rácsára ül, tehát a sávból annyi marad ki, amennyi egy
    // újabb rács-lépéshez már kevés. A tartalék tehát legalább a kerekítésé,
    // de kevesebb, mint egy teljes modulnyi lépés.
    assert.ok(layout.heightSlackMm >= LABEL_ROUNDING_ALLOWANCE_MM);
    assert.ok(
      layout.heightSlackMm <
        LABEL_ROUNDING_ALLOWANCE_MM + MODULE_GRID_MM * QR_MODULES_ACROSS,
    );
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
    // A méret továbbra is SZÁMOLT: a modul a rácsból jön, a kód mérete pedig a
    // modulból. Ha valaha újra egy szabadon állítható szám kerül ide, ez a sor
    // vált pirosra.
    assert.match(source, /const moduleMm = gridSteps \* MODULE_GRID_MM;/);
    assert.match(source, /const qrSizeMm = moduleMm \* QR_MODULES_ACROSS;/);
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
  /**
   * A MINTA MOSTANTÓL A JELÖLT ALAK, mert az kerül az ÚJ címkékre: az
   * eszközszám bélyege helyi idő szerint áll, és az időpont-blokk végén egy
   * `h` jelöli a váltást (l. `code-generator.util.ts`). A régi, jelöletlen
   * eszközök száma változatlan marad, tehát a szélesebb, ÚJ alakra kell
   * méretezni -- ha az kifér, a régi is.
   */
  const SAMPLE = "ESZK-20260826-133525h-AB12";

  it("measures the number the server actually generates", () => {
    const source = readFileSync(
      "../api/src/common/code-generator.util.ts",
      "utf8",
    );

    // A minta alakja onnan jön, ahol a szám készül: előtag, dátum, időpont a
    // jelöléssel, és négy hexa karakter. Ha ez a szerkezet változik, a hossz
    // is, és akkor ezt a mérést újra kell futtatni.
    assert.match(source, /randomUUID\(\)\.slice\(0, 4\)/);
    assert.match(source, /return `\$\{date\}-\$\{time\}h`;/);
    assert.equal(SAMPLE.length, 26);
  });

  it("fits on one line, with room for a font that is not Helvetica", () => {
    const { textWidthMm } = labelLayout();
    // A CÍMKÉRE A RÖVIDÍTETT ALAK KERÜL, tehát azt kell mérni. A teljes szám
    // 72 mm-es címkét kért; ez a sor őrzi, hogy a rövidebb címke a rövidebb
    // szöveghez tartozik, és nem attól lett rövidebb, hogy valaki lejjebb vette
    // a betűméretet.
    // ÉS A LEGSZÉLESEBB LEHETSÉGES AZONOSÍTÓRA, nem a mintára: a véletlen rész
    // hexa, az `A`-tól `D`-ig tartó betűk pedig szélesebbek a számjegyeknél. Egy
    // mintával mérve a címke csak azoknál az eszközöknél lógna ki, amelyek
    // véletlenül csupa betűs véget kaptak.
    const widest = labelAssetNumber("ESZK-20260826-000000h-AAAA");
    assert.equal(widest.length, labelAssetNumber(SAMPLE).length);
    const needed = widthEm(widest) * LABEL_NUMBER_FONT_MM;

    assert.ok(
      needed * 1.1 <= textWidthMm,
      `a szám ${needed.toFixed(1)} mm-t kér ${LABEL_NUMBER_FONT_MM} mm-es betűvel, ` +
        `a sáv ${textWidthMm} mm -- 10 százalék ráhagyással nem fér ki`,
    );
  });

  it("would not fit if the whole number were printed", () => {
    const { textWidthMm } = labelLayout();
    const whole = widthEm(SAMPLE) * LABEL_NUMBER_FONT_MM;

    // A KONTROLL a rövidítéshez: ez a címke a TELJES számnak már nem elég. Ha
    // valaha zöld lesz, akkor vagy a címke nőtt meg, vagy a betű zsugorodott --
    // és mindkettő olyan változás, amit észre kell venni.
    assert.ok(whole > textWidthMm);
  });
});

/**
 * A RÖVIDÍTÉS MÉRTÉKE NEM ÍZLÉS, HANEM EGYEDISÉG.
 *
 * A négyjegyű véletlen rész önmagában 65 536 értéket vehet fel, ami 302
 * eszköznél már 50 százalék eséllyel ad két egyforma címkét. Az időponttal
 * együtt a tér 86 400-szor nagyobb. Ezért két blokk kerül a címkére, nem egy.
 */
describe("labelAssetNumber", () => {
  const SAMPLE = "ESZK-20260826-133525h-AB12";

  it("keeps the two blocks that carry the identity", () => {
    // A JELÖLÉS IS A CÍMKÉRE KERÜL, és ez a lényege: a `h` az utolsó előtti
    // blokk végén áll, tehát azon az ábrán van, amit az ember leolvas. A
    // dátum-blokkba tett jelölő pontosan neki lenne láthatatlan.
    assert.equal(labelAssetNumber(SAMPLE), "133525h-AB12");
  });

  it("keeps the time block, not only the random one", () => {
    // EZ A TESZT AZ EGYEDISÉGRŐL SZÓL. Ha valaha csak az utolsó blokk maradna,
    // ez pirosra vált -- és pont az a változás, ami 302 eszköznél ütközik.
    assert.match(labelAssetNumber(SAMPLE), /^\d{6}h?-/);
    assert.ok(labelAssetNumber(SAMPLE).length > 4);
  });

  /**
   * A RÉGI, JELÖLETLEN SZÁMOK VÁLTOZATLANUL MŰKÖDNEK. Visszamenőleg semmi nem
   * íródik át, tehát a címke-rövidítésnek mindkét alakot vinnie kell -- és a
   * két alak KÜLÖNBÖZIK, ami épp a jelölés célja.
   */
  it("still shortens a number minted before the marking", () => {
    assert.equal(labelAssetNumber("ESZK-20260826-133525-AB12"), "133525-AB12");
  });

  it("stays a suffix of the full number, so search still finds it", () => {
    // Az eszközkereső `contains` illesztést használ (service-assets
    // repository). Ez CSAK akkor működik, ha a rövid alak a teljes szám
    // összefüggő részlete. Ha valaha átrendezné a blokkokat, a visszakeresés
    // némán szűnne meg.
    assert.ok(SAMPLE.endsWith(labelAssetNumber(SAMPLE)));
  });

  it("separates two assets born in the same second", () => {
    const first = labelAssetNumber("ESZK-20260826-133525-AB12");
    const second = labelAssetNumber("ESZK-20260826-133525-99F0");

    // A maradék eset, amit ez NEM fed le, és ami tudatosan vállalt: két eszköz
    // KÜLÖNBÖZŐ NAPON, ugyanabban a másodpercben, ugyanazzal a véletlen véggel.
    assert.notEqual(first, second);
  });

  it("leaves an unexpected shape alone", () => {
    // Rossz azonosító rosszabb, mint egy hosszú címke.
    assert.equal(labelAssetNumber("ESZK-123"), "ESZK-123");
    assert.equal(labelAssetNumber("BARMI"), "BARMI");
    assert.equal(labelAssetNumber(""), "");
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
    // A képernyő a RÖVIDÍTETT alakot írja ki. Ha valaha visszaírná a teljes
    // számot, a címke kilógna a szalagról, és ezt semmi más nem jelezné.
    assert.match(source, /labelAssetNumber\(assetNumber\)/);
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
