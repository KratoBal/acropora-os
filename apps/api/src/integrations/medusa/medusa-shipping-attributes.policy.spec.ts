import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeShippingFlags,
  flagsWithoutKind,
  rowsCarryingKind,
  shippingFlagsDiffer,
  shippingFlagsFromProfile,
} from "./medusa-shipping-attributes.policy.js";

/**
 * A LEKEPEZES MIND A NEGY MEZOT VISZI, ES A NEVEK NEM CSUSZHATNAK EL.
 *
 * Egy elcsuszott nev-par (peldaul `isHeavy` -> `is_frozen`) NEM hasal el sehol:
 * mind a ketto logikai ertek, a bolt elfogadja, es a hiba a SZALLITASI MODOK
 * kozott jelenne meg -- egy nehez aru fagyasztottkent viselkedne. Ezert az
 * allitas mind a negy part KULON, KULONBOZO ertekekkel meri.
 */
describe("a szállítási zászlók leképezése", () => {
  it("mind a négy mező a saját párjára megy", () => {
    assert.deepEqual(
      shippingFlagsFromProfile({
        pickupOnly: true,
        foxpostForbidden: false,
        isHeavy: true,
        isFrozen: false,
        lockerUnsuitable: true,
      }),
      {
        pickup_only: true,
        foxpost_forbidden: false,
        is_heavy: true,
        is_frozen: false,
        locker_unsuitable: true,
        // V2.6: no kind without a derived one
        livestock_kind: null,
      },
    );
    // ES A FORDITOTT MINTA IS, kulonben ket felcserelt mezo eszrevetlen marad:
    // egyetlen mintaval a `pickupOnly`/`isHeavy` csere nem latszana.
    assert.deepEqual(
      shippingFlagsFromProfile({
        pickupOnly: false,
        foxpostForbidden: true,
        isHeavy: false,
        isFrozen: true,
        // a82ed229 C3: a UNAS-ból számolt profilban nincs, és a hiánya hamis
      }),
      {
        pickup_only: false,
        foxpost_forbidden: true,
        is_heavy: false,
        is_frozen: true,
        locker_unsuitable: false,
        livestock_kind: null,
      },
    );
  });
});

describe("változik-e valami", () => {
  const ALAP = {
    pickup_only: false,
    foxpost_forbidden: false,
    is_heavy: false,
    is_frozen: false,
  };

  it("hiányzó bolti állapot mellett mindig változás", () => {
    assert.equal(shippingFlagsDiffer(null, ALAP), true);
  });

  // a82ed229 C3: a bolt a #677 előtt nem adja vissza a mezőt; ott a hiánya hamis, és csak az igaz változás
  it("a csomagautomata-jelző: a régi bolt hiányzó mezője hamis", () => {
    assert.equal(
      shippingFlagsDiffer(ALAP, { ...ALAP, locker_unsuitable: false }),
      false,
    );
    assert.equal(
      shippingFlagsDiffer(ALAP, { ...ALAP, locker_unsuitable: true }),
      true,
    );
    assert.equal(
      shippingFlagsDiffer({ ...ALAP, locker_unsuitable: true }, ALAP),
      true,
    );
  });

  it("azonos állapotnál nincs változás", () => {
    assert.equal(shippingFlagsDiffer(ALAP, { ...ALAP }), false);
  });

  /**
   * MIND A NEGY MEZOT KULON MERJUK: ha az osszehasonlitas egy mezot kifelejt,
   * az a mezo SOHA nem kerulne ki a boltba, es a jelentes "mar igy allt"-ot
   * mondana ra. Egy egyetlen mezos allitas ezt nem fogna meg.
   */
  it("bármelyik mező eltérése változás", () => {
    for (const kulcs of [
      "pickup_only",
      "foxpost_forbidden",
      "is_heavy",
      "is_frozen",
    ] as const) {
      assert.equal(
        shippingFlagsDiffer(ALAP, { ...ALAP, [kulcs]: true }),
        true,
        `a ${kulcs} eltérése nem számított változásnak`,
      );
    }
  });
});

describe("a zászlók emberi alakja", () => {
  it("megnevezi, ami igaz", () => {
    assert.equal(
      describeShippingFlags({
        pickup_only: true,
        foxpost_forbidden: false,
        is_heavy: true,
        is_frozen: false,
      }),
      "csak bolti átvétel, nehéz áru",
    );
  });

  /**
   * ES AZ URES HALMAZ SZOVEGET AD, NEM URES SORT: egy ures sor a jelentesben
   * ugy nez ki, mintha a meres maradt volna el.
   */
  it("a csomagautomata-jelzőt is megnevezi (a82ed229 C3)", () => {
    assert.equal(
      describeShippingFlags({
        pickup_only: false,
        foxpost_forbidden: false,
        is_heavy: false,
        is_frozen: false,
        locker_unsuitable: true,
      }),
      "csomagautomatába nem fér",
    );
  });

  it("korlátozás nélkül is mond valamit", () => {
    assert.equal(
      describeShippingFlags({
        pickup_only: false,
        foxpost_forbidden: false,
        is_heavy: false,
        is_frozen: false,
      }),
      "nincs korlátozás",
    );
  });
});

/*
  AZ ELO ALLAT FAJTAJA A JELZOK KOZOTT (V2.6). MI PIROSIT: ha a fajta nem jut el a
  kimeno jelzokig; ha a kulonbseg-vizsgalat nem latja (a bolt allapota sosem
  frissulne); ha a "nincs fajta" es a "mar nincs fajta" ugyanannak latszana.
*/
describe("az élő állat fajtája a szállítási jelzők között", () => {
  const PROFIL = {
    pickupOnly: true,
    foxpostForbidden: false,
    isHeavy: false,
    isFrozen: false,
  };
  const ALAP = {
    pickup_only: true,
    foxpost_forbidden: false,
    is_heavy: false,
    is_frozen: false,
    locker_unsuitable: false,
  };

  it("a leképezés viszi a fajtát, és fajta nélkül null", () => {
    assert.equal(
      shippingFlagsFromProfile(PROFIL, "CORAL").livestock_kind,
      "CORAL",
    );
    assert.equal(shippingFlagsFromProfile(PROFIL).livestock_kind, null);
  });

  it("a fajta változása is változás, és a fajta törlése is", () => {
    assert.equal(
      shippingFlagsDiffer(
        { ...ALAP, livestock_kind: "FISH" },
        { ...ALAP, livestock_kind: "CORAL" },
      ),
      true,
    );
    assert.equal(
      shippingFlagsDiffer(
        { ...ALAP, livestock_kind: "FISH" },
        { ...ALAP, livestock_kind: null },
      ),
      true,
    );
    assert.equal(
      shippingFlagsDiffer(
        { ...ALAP, livestock_kind: "FISH" },
        { ...ALAP, livestock_kind: "FISH" },
      ),
      false,
    );
  });

  // a hianyzo mezo (regi bolt) es a null ugyanaz: egyik sem fajta
  it("a hiányzó fajta és a null egyforma", () => {
    assert.equal(
      shippingFlagsDiffer(ALAP, { ...ALAP, livestock_kind: null }),
      false,
    );
  });

  it("a jelentés kimondja a fajtát", () => {
    assert.match(
      describeShippingFlags({ ...ALAP, livestock_kind: "INVERTEBRATE" }),
      /élő állat: gerinctelen/,
    );
    assert.doesNotMatch(describeShippingFlags(ALAP), /élő állat/);
  });
});

/*
  A BOLTBAN MARADT FAJTA (kartya 4b30b373). MI PIROSIT: a szuro a fajta nelkuli (null vagy hianyzo) sort is atengedi; a
  fajtatorles elviszi vagy megforditja a TOBBI zaszlot (a termeknek nincs profil-sora, ezek nem az OS dontesei).
*/
describe("a boltban maradt élő állat fajta", () => {
  it("csak a fajtát viselő sorokat adja vissza (a null és a hiányzó nem)", () => {
    const sorok = [
      { product_id: "a", livestock_kind: "FISH" as const },
      { product_id: "b", livestock_kind: null },
      { product_id: "c" },
      { product_id: "d", livestock_kind: "CORAL" as const },
    ];
    assert.deepEqual(
      rowsCarryingKind(sorok).map((r) => r.product_id),
      ["a", "d"],
    );
  });

  it("a fajtát null-ra teszi, a többi zászlót változatlanul hagyja (a hiányzó csomagautomata-jelző hamis)", () => {
    assert.deepEqual(
      flagsWithoutKind({
        pickup_only: true,
        foxpost_forbidden: true,
        is_heavy: true,
        is_frozen: true,
        livestock_kind: "FISH",
      }),
      {
        pickup_only: true,
        foxpost_forbidden: true,
        is_heavy: true,
        is_frozen: true,
        locker_unsuitable: false,
        livestock_kind: null,
      },
    );
  });
});
