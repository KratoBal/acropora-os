import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeLabelScanFailure,
  describeScannedPayload,
  extractAssetLabelCode,
} from "./scanned-payload";

/**
 * A KÉT VALÓDI PAYLOAD, BETŰRE.
 *
 * NEM KITALÁLT PÉLDÁK: Balázs 2026-09-17-én lefényképezte mind a két köteget a
 * telefon saját QR-olvasójával, és a képen ott áll, mit olvas ki belőlük. Ha
 * valaki később szigorítaná a mintát, ezen a kettőn fog elhasalni -- ami
 * helyes, mert ez az ötven matrica MA a gépekre megy.
 */
const REGI_KOTEG = "J3049";
const UJ_KOTEG = "D4204;D4204";

describe("extractAssetLabelCode", () => {
  it("reads the old batch, which carries the bare code", () => {
    assert.deepEqual(extractAssetLabelCode(REGI_KOTEG), {
      kind: "code",
      code: "J3049",
    });
  });

  /**
   * AZ ÚJ KÖTEG A TELJES CSV SORT HORDOZZA. Ez a köteg KI VAN NYOMTATVA, és
   * Balázs döntése, hogy nem nyomtatja újra -- tehát ennek működnie KELL.
   */
  it("reads the new batch, which carries the whole CSV row", () => {
    assert.deepEqual(extractAssetLabelCode(UJ_KOTEG), {
      kind: "code",
      code: "D4204",
    });
  });

  /**
   * A KÉT ELŐFORDULÁS EGYEZÉSÉT A NORMALIZÁLT ALAKON NÉZZÜK. Enélkül egy
   * kisbetűs olvasat két különbözőnek látszana, és egy HELYES matricát
   * utasítanánk el.
   */
  it("treats the two halves as one code even in different case", () => {
    assert.deepEqual(extractAssetLabelCode("d4204;D4204"), {
      kind: "code",
      code: "D4204",
    });
  });

  /**
   * KÉT KÜLÖNBÖZŐ KÓD: NEM VÁLASZTUNK. A rossz választás FIZIKAI
   * következménnyel jár -- másik gépre kerül a címke.
   */
  it("refuses to pick when two different codes are in the payload", () => {
    assert.deepEqual(extractAssetLabelCode("D4204;D4205"), {
      kind: "ambiguous",
      codes: ["D4204", "D4205"],
    });
  });

  it("says there is none when nothing has the code shape", () => {
    assert.deepEqual(extractAssetLabelCode("semmi ilyesmi"), { kind: "none" });
  });

  /**
   * EGY HOSSZABB FUTAM NEM ADJA KI AZ ELSŐ ÖT KARAKTERÉT. E nélkül egy
   * cikkszám vagy egy sorozatszám csendben matricakódnak látszana.
   */
  it("does not cut a code out of a longer run", () => {
    assert.deepEqual(extractAssetLabelCode("X12345"), { kind: "none" });
    assert.deepEqual(extractAssetLabelCode("AB1234"), { kind: "none" });
  });

  /** A kód egy URL-be csomagolva is megvan. */
  it("finds the code inside a wrapped payload", () => {
    assert.deepEqual(extractAssetLabelCode("https://acropora.hu/l/D4204"), {
      kind: "code",
      code: "D4204",
    });
  });

  it("is not fooled by an empty payload", () => {
    assert.deepEqual(extractAssetLabelCode(""), { kind: "none" });
  });
});

describe("describeScannedPayload", () => {
  /**
   * EZ A MONDAT AZ EGÉSZ KÁRTYA LÉNYEGE. Ha 2026-09-17 előtt ott lett volna,
   * Balázsnak nem kellett volna lefényképeznie a matricát.
   */
  it("shows what was read", () => {
    assert.equal(describeScannedPayload(UJ_KOTEG), "D4204;D4204");
  });

  it("names the empty payload instead of showing nothing", () => {
    assert.equal(describeScannedPayload("   "), "(üres)");
  });

  it("collapses newlines so the sentence stays one line", () => {
    assert.equal(describeScannedPayload("a\n\nb"), "a b");
  });

  it("cuts a long payload and says it cut", () => {
    const hosszu = "X".repeat(200);
    const mondat = describeScannedPayload(hosszu);
    assert.ok(mondat.length < 60, `túl hosszú: ${mondat.length}`);
    assert.match(mondat, /\.\.\.$/);
  });
});

describe("describeLabelScanFailure", () => {
  it("says nothing when there is a code", () => {
    assert.equal(
      describeLabelScanFailure(UJ_KOTEG, extractAssetLabelCode(UJ_KOTEG)),
      null,
    );
  });

  /**
   * A KÉT ELUTASÍTÁS KÉT KÜLÖN MONDAT, mert a teendő más: a `none` esetnél a
   * kézi bevitel a kiút, a `ambiguous` esetnél az, hogy megnézi, melyik kód
   * áll a matricán. MIND A KETTŐ kiírja, mit olvasott.
   */
  it("tells the two refusals apart, and both say what was read", () => {
    const nincs = describeLabelScanFailure(
      "semmi",
      extractAssetLabelCode("semmi"),
    );
    const tobb = describeLabelScanFailure(
      "D4204;D4205",
      extractAssetLabelCode("D4204;D4205"),
    );
    assert.notEqual(nincs, tobb);
    assert.match(nincs ?? "", /Beolvasva: semmi/);
    assert.match(tobb ?? "", /Beolvasva: D4204;D4205/);
    // AZ ELUTASÍTÁS NEVEZZE MEG MIND A KÉT KÓDOT.
    assert.match(tobb ?? "", /D4204/);
    assert.match(tobb ?? "", /D4205/);
    // ÉS MONDJA MEG A TEENDŐT, különben csak közli a kudarcot.
    assert.match(nincs ?? "", /kézzel/);
    assert.match(tobb ?? "", /kézzel/);
  });
});
