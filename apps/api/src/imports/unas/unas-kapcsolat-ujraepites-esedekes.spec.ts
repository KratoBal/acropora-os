import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideUjraepitesDue } from "./unas-kapcsolat-ujraepites-esedekes.js";

/**
 * A DATUMOK HELYI IDOBEN allnak (a `new Date(ev, ho, nap, ora)` alak helyi
 * idot vesz), mert a dontes is HELYI orat es HELYI naptari napot nez. Egy
 * `Z`-vegu alak a telepites zonajatol fuggoen mast jelentene, es a teszt
 * nyaron zold, telen piros lenne -- pont az a billego, amit a lapunk tilt.
 */
function ido(nap: number, ora: number, perc = 0): Date {
  return new Date(2026, 8, nap, ora, perc, 0, 0);
}

const ABLAK = { ablakKezdoOra: 2, ablakZaroOra: 5 };

describe("kapcsolat-újraépítés esedékessége", () => {
  it("az ablakban, ma még futás nélkül esedékes", () => {
    assert.deepEqual(
      decideUjraepitesDue({
        most: ido(17, 3),
        ...ABLAK,
        utolsoFutasKezdete: ido(16, 3),
      }),
      { due: true, ok: "ESEDEKES" },
    );
  });

  /**
   * A KONTROLL AZ ABLAK-ALLITASOKHOZ: ha a nyitó- és záróórát nem a hely
   * szerint olvasnánk, ez a három is ugyanúgy viselkedne, mint a fenti.
   */
  it("az ablak előtt és után nem esedékes", () => {
    for (const ora of [1, 5, 12, 23]) {
      assert.deepEqual(
        decideUjraepitesDue({
          most: ido(17, ora),
          ...ABLAK,
          utolsoFutasKezdete: null,
        }),
        { due: false, ok: "ABLAKON_KIVUL" },
        `${ora} óra`,
      );
    }
  });

  it("a nyitóóra benne van, a záróóra nincs", () => {
    assert.equal(
      decideUjraepitesDue({
        most: ido(17, 2, 0),
        ...ABLAK,
        utolsoFutasKezdete: null,
      }).due,
      true,
    );
    assert.equal(
      decideUjraepitesDue({
        most: ido(17, 5, 0),
        ...ABLAK,
        utolsoFutasKezdete: null,
      }).due,
      false,
    );
  });

  /**
   * EZ AZ ALLITAS VED A TELEPITES-HULLAM ELLEN. Az ablakon belul a masodik
   * ebredes NEM futas -- kulonben tizennegy ujrainditas tizennegy ujraepitest
   * jelentene ugyanabban a ket oraban.
   */
  it("ha ma már futott, nem esedékes újra", () => {
    assert.deepEqual(
      decideUjraepitesDue({
        most: ido(17, 4, 30),
        ...ABLAK,
        utolsoFutasKezdete: ido(17, 2, 5),
      }),
      { due: false, ok: "MA_MAR_FUTOTT" },
    );
  });

  /**
   * ES A NAPHATAR NEM A HUSZONNEGY ORA: egy 23 oraval korabbi futas MAS napon
   * volt, tehat a mai kor jar. Ha a dontes kulonbseget szamolna, ez az allitas
   * pirosodna -- ezert all itt kulon.
   */
  it("a tegnapi futás nem fogja el a mai kört, még ha 23 órája volt is", () => {
    assert.deepEqual(
      decideUjraepitesDue({
        most: ido(17, 2, 0),
        ...ABLAK,
        utolsoFutasKezdete: ido(16, 3, 0),
      }),
      { due: true, ok: "ESEDEKES" },
    );
  });

  it("futás nélkül az első kör esedékes", () => {
    assert.equal(
      decideUjraepitesDue({
        most: ido(17, 2),
        ...ABLAK,
        utolsoFutasKezdete: null,
      }).due,
      true,
    );
  });
});
