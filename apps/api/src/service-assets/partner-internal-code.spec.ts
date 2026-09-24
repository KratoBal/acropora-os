import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  nextFreePartnerInternalCodeSerial,
  partnerInternalCodePrefix,
} from "./partner-internal-code.js";

describe("partnerInternalCodePrefix", () => {
  /**
   * BALÁZS JÓVÁHAGYÁSA, 2026-09-24 11:33, SZÓ SZERINT: "ahogy a BIO alatti
   * eszközöknél az első tag legyen BIO a FAN alattinál a FAN stb stb pl
   * FAN-A11-HSZ-01" -- a FAN/AKV/A11 fában a KÖZBÜLSŐ (AKV) szint KIMARAD.
   */
  it("gyökér eszköznél a fa GYÖKERÉNEK és a SAJÁT helyszínnek a kódját fűzi össze -- a közbülső szint kimarad", () => {
    assert.equal(
      partnerInternalCodePrefix({
        isBuiltIn: false,
        parentPartnerInternalCode: null,
        rootLocationCode: "FAN",
        ownLocationCode: "A11",
        ownIsRootLocation: false,
        categoryCode: "HSZ",
      }),
      "FAN-A11-HSZ",
    );
  });

  /**
   * HA AZ ESZKÖZ KÖZVETLENÜL A LEGFELSŐ SZINTEN ÁLL, a gyökér kódja NEM
   * ismétlődik kétszer (nem "CAP-CAP-HSZ").
   */
  it("gyökér eszköznél, ha az eszköz KÖZVETLENÜL a legfelső szinten áll, a gyökér kódja nem ismétlődik", () => {
    assert.equal(
      partnerInternalCodePrefix({
        isBuiltIn: false,
        parentPartnerInternalCode: null,
        rootLocationCode: "CAP",
        ownLocationCode: "CAP",
        ownIsRootLocation: true,
        categoryCode: "HSZ",
      }),
      "CAP-HSZ",
    );
  });

  /**
   * A DÖNTÉS A `ownIsRootLocation` JELZŐN MÚLIK, NEM A KÉT KÓD ÉRTÉKÉNEK
   * EGYEZÉSÉN. A helyszín kódja csak testvérek között egyedi, tehát egy
   * MÁSIK ágon lévő helyszín kódja véletlenül megegyezhetne a gyökér
   * kódjával -- ha a fenti teszt kódegyezésen dőlne el, ez az eset hamisan
   * ugyanoda futna. Itt a kódok SZÁNDÉKOSAN egyeznek, DE `ownIsRootLocation`
   * hamis, tehát a teljes háromtagú alaknak kell kijönnie.
   */
  it("TESTVÉR-KONTROLL: kódegyezés önmagában NEM dedupol, csak a ownIsRootLocation jelző", () => {
    assert.equal(
      partnerInternalCodePrefix({
        isBuiltIn: false,
        parentPartnerInternalCode: null,
        rootLocationCode: "FAN",
        ownLocationCode: "FAN",
        ownIsRootLocation: false,
        categoryCode: "HSZ",
      }),
      "FAN-FAN-HSZ",
    );
  });

  it("beépített eszköznél a SZÜLŐ TELJES kódját használja, nem a helyszínt", () => {
    assert.equal(
      partnerInternalCodePrefix({
        isBuiltIn: true,
        parentPartnerInternalCode: "FAN-A11-HSZ-05",
        rootLocationCode: "FAN",
        ownLocationCode: "A11",
        ownIsRootLocation: false,
        categoryCode: "VAL",
      }),
      "FAN-A11-HSZ-05-VAL",
    );
  });

  /**
   * BALÁZS KIFEJEZETT KÉRÉSE: HA A SZÜLŐNEK NINCS KÓDJA, NE GENERÁLJUNK.
   * A helyszín-kódok jelenléte itt NEM mentő körülmény -- a hívó ilyenkor
   * `null`-t kap, és a repository nem ír kódot. `isBuiltIn: true` és
   * `parentPartnerInternalCode: null` EGYÜTT jelenti "van szülő, de annak
   * nincs kódja" -- ezt kell megkülönböztetni a gyökér-esettől (fenti
   * tesztek), ahol a `parentPartnerInternalCode` szintén `null`, de a helyes
   * eset, mert nincs is szülő.
   */
  it("beépített eszköznél, szülő-kód nélkül, null-t ad -- a helyszín kódja nem pótolja", () => {
    assert.equal(
      partnerInternalCodePrefix({
        isBuiltIn: true,
        parentPartnerInternalCode: null,
        rootLocationCode: "FAN",
        ownLocationCode: "A11",
        ownIsRootLocation: false,
        categoryCode: "VAL",
      }),
      null,
    );
  });

  it("gyökér eszköznél, ha a gyökér helyszínnek nincs kódja, null-t ad", () => {
    assert.equal(
      partnerInternalCodePrefix({
        isBuiltIn: false,
        parentPartnerInternalCode: null,
        rootLocationCode: null,
        ownLocationCode: "A11",
        ownIsRootLocation: false,
        categoryCode: "HSZ",
      }),
      null,
    );
  });
});

describe("nextFreePartnerInternalCodeSerial", () => {
  it("üres halmazon az első sorszámot adja, két számjeggyel", () => {
    assert.equal(
      nextFreePartnerInternalCodeSerial("A11-HSZ", []),
      "A11-HSZ-01",
    );
  });

  it("a következő szabad sorszámot adja, nem a darabszámot", () => {
    assert.equal(
      nextFreePartnerInternalCodeSerial("A11-HSZ", [
        "A11-HSZ-01",
        "A11-HSZ-02",
      ]),
      "A11-HSZ-03",
    );
  });

  /**
   * KALIBRÁCIÓ: A LYUKAS SORSZÁM A MEGKERESETT HELYEN ÁLL, NEM A VÉGÉN.
   * Ha a függvény "darabszám + 1"-et adna (2 db -> "03"), ez az állítás
   * pirosra váltana ("A11-HSZ-03" jönne "A11-HSZ-02" helyett).
   */
  it("egy lyukat a helyén tölt ki, nem a legmagasabb szám mögé ragaszt", () => {
    assert.equal(
      nextFreePartnerInternalCodeSerial("A11-HSZ", [
        "A11-HSZ-01",
        "A11-HSZ-03",
      ]),
      "A11-HSZ-02",
    );
  });

  it("más előtagú kódot figyelmen kívül hagy", () => {
    assert.equal(
      nextFreePartnerInternalCodeSerial("A11-HSZ", [
        "TEK-HSZ-01",
        "A11-VPU-01",
      ]),
      "A11-HSZ-01",
    );
  });

  /**
   * A KÉZZEL BEÍRT, NEM KÉTJEGYŰ ALAK IS FOGLAL. "A11-HSZ-1" ugyanazt a
   * sorszámot jelenti egy embernek, mint a generált "A11-HSZ-01" -- ha a
   * függvény csak a kétjegyű alakot ismerné fel, itt hamisan "A11-HSZ-01"-et
   * adna vissza, pedig az már (más írásmóddal) foglalt.
   */
  it("egy nem kétjegyű, kézzel beírt sorszámot is foglaltnak vesz", () => {
    assert.equal(
      nextFreePartnerInternalCodeSerial("A11-HSZ", ["A11-HSZ-1"]),
      "A11-HSZ-02",
    );
  });

  /**
   * A MINTÁN LÁTOTT, ELTÉRŐ ALAKÚ KÉZI KÓDOK (pl. "EBB-FOS", "LSS07-HSZ")
   * NEM ILLESZKEDNEK a mintára, tehát nem foglalnak semmit -- ez a
   * TESTVÉR-KONTROLL a fenti "más előtagú kódot figyelmen kívül hagy"
   * mellett: itt a kód ugyanazzal az előtaggal KEZDŐDIK, mégsem számít
   * foglaltnak, mert az alakja nem `<előtag>-<szám>`.
   */
  it("az előtaggal kezdődő, de más alakú kézi kódot sem veszi foglaltnak", () => {
    assert.equal(
      nextFreePartnerInternalCodeSerial("EBB-FOS", [
        "EBB-FOS",
        "EBB-FOS-VAL-05",
      ]),
      "EBB-FOS-01",
    );
  });
});
