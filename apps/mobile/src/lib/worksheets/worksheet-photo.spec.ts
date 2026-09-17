import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  describeWorksheetPhotoUpload,
  WORKSHEET_PHOTO_NOTICE,
} from "./worksheet-photo";

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

describe("describeWorksheetPhotoUpload", () => {
  it("says nothing when nothing happened", () => {
    assert.equal(
      describeWorksheetPhotoUpload({ uploaded: 0, skipped: [] }),
      null,
    );
  });

  it("names the count when every picked file went up", () => {
    assert.equal(
      describeWorksheetPhotoUpload({ uploaded: 3, skipped: [] }),
      "3 kép a laphoz került.",
    );
  });

  /**
   * A RÉSZLEGES SIKER AZ EGÉSZ MODUL LÉTOKA. Ha csak a feltöltöttek számát
   * mondanánk, a kihagyott fájl CSENDBEN veszne el -- és épp az a kép, amiről a
   * szerelő azt hiszi, megvan.
   */
  it("names the skipped files even when the rest succeeded", () => {
    const mondat = describeWorksheetPhotoUpload({
      uploaded: 2,
      skipped: ["IMG_0042.HEIC"],
    });
    assert.match(mondat ?? "", /2 kép/);
    assert.match(mondat ?? "", /IMG_0042\.HEIC/);
  });

  /**
   * A TELJES KUDARC MÁS MONDAT, NEM „0 kép a laphoz került". Az utóbbi
   * eredménynek látszana, holott a lapra semmi nem került.
   */
  it("says so when nothing could go up at all", () => {
    const mondat = describeWorksheetPhotoUpload({
      uploaded: 0,
      skipped: ["a.heic", "b.gif"],
    });
    assert.match(mondat ?? "", /Egyik kiválasztott kép sem/);
    assert.match(mondat ?? "", /a\.heic, b\.gif/);
    assert.doesNotMatch(mondat ?? "", /0 kép a laphoz került/);
  });
});

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
   * A MONDAT A JELEN ÁLLAPOTRÓL SZÓL, NEM A VILÁGRÓL. Ha úgy szólna, hogy
   * „térerő nélkül nem lehet fényképet feltölteni", akkor abban a percben
   * HAZUDNI kezdene, amikor a sorba tétel elkészül.
   */
  it("a mondat a mentett másolatra hivatkozik, nem általános tiltásra", () => {
    for (const szoveg of Object.values(WORKSHEET_PHOTO_NOTICE)) {
      assert.match(szoveg, /Mentett másolatot nézel/);
      assert.match(szoveg, /most nem/);
      assert.doesNotMatch(szoveg, /nem lehet|soha|egyáltalán/);
      // A TEENDŐ NÉLKÜL a mondat csak közli a kudarcot.
      assert.match(szoveg, /érerőnél/);
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
    assert.match(forras, /usePhotoAttachments/);
    assert.doesNotMatch(
      forras,
      /ImagePicker\.(launchCamera|launchImageLibrary|requestCamera|requestMediaLibrary)/,
      "a képernyő megint saját választó-menetet ír a közös horog helyett",
    );
  });
});
