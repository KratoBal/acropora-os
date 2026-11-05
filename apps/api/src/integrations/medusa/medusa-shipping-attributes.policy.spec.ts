import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeShippingFlags,
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
