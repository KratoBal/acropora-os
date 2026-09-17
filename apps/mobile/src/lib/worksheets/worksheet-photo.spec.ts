import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { WORKSHEET_PHOTO_NOTICE } from "./worksheet-photo";

/**
 * A FORRÁSFÁT OLVASSA, NEM A LEFORDÍTOTT KIMENETET.
 *
 * A `__dirname` futásidőben a `test-dist/lib/worksheets` mappa, tehát HÁROM
 * szintet kell fölfelé lépni a csomag gyökeréig, és onnan a `src` alá. A
 * `test-dist`-ben `.tsx` fájl nincs is.
 */
const KEPERNYO = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "app",
  "worksheets",
  "[id].tsx",
);

function kepernyo(): string {
  try {
    return readFileSync(KEPERNYO, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${KEPERNYO}. Ez a KERESÉS hibája, nem a lefedettségé -- az alábbi állítások addig semmit nem mondanak.`,
    );
  }
}

describe("a mentett másolat kimondja, mi nem megy", () => {
  it("POZITÍV KONTROLL: a képernyő olvasható és nem üres", () => {
    assert.ok(kepernyo().length > 2000, "a képernyő üres vagy gyanúsan rövid");
  });

  /**
   * A SZAKASZ NEM A MÁSOLAT-ÁLLAPOTRA VAN KAPUZVA, csak a gombok tiltva.
   * Ez a hiba KONKRÉT alakja volt a hibajegy lapján: a `!masolatbol` feltétel
   * mögött az egész szakasz eltűnt, egyetlen szó nélkül.
   */
  it("a képernyő kimondja, miért nem megy a feltöltés másolatból", () => {
    assert.match(
      kepernyo(),
      /WORKSHEET_PHOTO_NOTICE\.offlineCopy/,
      "a képernyő nem használja a mondatot: a kieső feltöltés némán tűnne el",
    );
  });

  it("a fénykép-szakasz nem esik ki a másolat miatt", () => {
    assert.doesNotMatch(
      kepernyo(),
      /worksheetsManage\s*&&\s*!fromCache/,
      "a fénykép-szakasz a másolat-állapotra van kapuzva: némán tűnne el",
    );
  });

  /**
   * EZ AZ ÁLLÍTÁS ÁT VAN ÍRVA (2026-09-17), ÉS A RÉGI PIROSA BIZONYÍTÉK VOLT.
   *
   * Korábban azt kötötte ki, hogy a mondat azt mondja: a fénykép „most nem"
   * megy, és „térerőnél" fog. A sorba tétel elkészültével ez a KIKÖTÉS vált
   * hamissá: a kép mostantól térerő NÉLKÜL is felvehető, csak a telefonon vár.
   *
   * A régi állítás tehát épp a helyes mondatot utasította volna el. Nem
   * vettem ki: MÁSIK szabályra állítottam át, ami ugyanazt védi -- a mondat a
   * JELEN állapotról szóljon, ne általános tiltásról, ÉS mondja meg a
   * teendőt (itt: hogy magától felmegy, tehát nincs teendő).
   */
  it("a mondat a mentett másolatra hivatkozik, nem általános tiltásra", () => {
    for (const szoveg of Object.values(WORKSHEET_PHOTO_NOTICE)) {
      assert.match(szoveg, /Mentett másolatot nézel/);
      // ÁLTALÁNOS TILTÁST NE ÁLLÍTSON: az elavulna egy új képességgel.
      assert.doesNotMatch(szoveg, /nem lehet|soha|egyáltalán|nem tölthető/);
      // ÉS MONDJA MEG, MI TÖRTÉNIK A KÉPPEL -- enélkül a szerelő azt hinné,
      // hogy neki kell újra megnyomnia, és a második nyomás egy második sort
      // adna.
      assert.match(szoveg, /magától felmegy/);
    }
  });

  /**
   * A KIVÁLASZTOTT, DE MÉG FEL NEM TÖLTÖTT KÉP AZ, AMIRŐL HALLGATNI A
   * LEGDRÁGÁBB: a szerelő elmenne a helyszínről abban a hitben, hogy a kép a
   * lapon van.
   */
  it("a képernyő kimondja, hogy a kiválasztott kép még nincs a lapon", () => {
    assert.match(kepernyo(), /Még egyik sincs a/);
  });

  /**
   * A PICKER-FÉL A KÖZÖS HOROGBÓL JÖN, nem egy ötödik másolatból. Ha valaki
   * visszaírja ide az `ImagePicker` közvetlen hívását, ez pirosra vált.
   */
  it("a képernyő a közös fénykép-horgot használja, nem saját másolatot", () => {
    const forras = kepernyo();
    /**
     * A HIVAS ALAKJARA, NEM A NEVRE -- es ezt egy SOPRES talalta meg, nem a
     * kalibracio (2026-09-17).
     *
     * A puszta nev KETSZER all a kepernyon: az `import` sorban ES a hivasban.
     * Vagyis ha valaki a hivast kivenné es sajat valaszto-menetet irna, az
     * import ITT TARTANA ZOLDEN az allitast -- pontosan az a diszlet, amit ez
     * a teszt meg akar elozni.
     */
    assert.match(forras, /\} = usePhotoAttachments\(\)/);
    assert.doesNotMatch(
      forras,
      /ImagePicker\.(launchCamera|launchImageLibrary|requestCamera|requestMediaLibrary)/,
      "a képernyő megint saját választó-menetet ír a közös horog helyett",
    );
  });
});
