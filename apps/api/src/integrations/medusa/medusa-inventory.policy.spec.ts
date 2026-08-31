import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  decideInventoryProjection,
  MedusaInventoryQuantityError,
  PROJECTED_ALLOW_BACKORDER,
} from "./medusa-inventory.policy.js";

/**
 * A KÉSZLET-SZABÁLY, hálózat nélkül.
 *
 * Amit itt bizonyítunk, az a KÉPLET és a vágás. Hogy a szabályt a vetítés
 * ténylegesen VÉGRE IS HAJTJA (és nem csak kiszámolja), az a szolgáltatás
 * tesztjeinek dolga - és ez a különbség itt nem formaság: a rendelhetőségnél
 * az alapértelmezés a döntés ellentéte, tehát egy szabály, amit senki nem hív
 * meg, pontosan úgy néz ki, mint egy hiányzó szabály.
 */

const decimal = (value: string) => new Prisma.Decimal(value);

describe("Medusa készlet-szabály", () => {
  /** A brief 10. pontjának 1. tesztje. */
  it("pozitív értékesíthető készlet -> ugyanaz a Medusa mennyiség", () => {
    const decision = decideInventoryProjection({
      onHand: decimal("5"),
      reserved: decimal("0"),
    });
    assert.equal(decision.medusaQuantity, 5);
    assert.equal(decision.clamped, false);
  });

  /** A 2. teszt. */
  it("nulla értékesíthető készlet -> 0, és NEM vágás", () => {
    const decision = decideInventoryProjection({
      onHand: decimal("2"),
      reserved: decimal("2"),
    });
    assert.equal(decision.medusaQuantity, 0);
    assert.equal(
      decision.clamped,
      false,
      "a nulla nem vágásból jött, és a jelentés ezt nem is állíthatja",
    );
  });

  /** A 3. teszt. */
  it("negatív értékesíthető készlet -> 0, és a vágás LÁTSZIK", () => {
    const decision = decideInventoryProjection({
      onHand: decimal("3"),
      reserved: decimal("5"),
    });
    assert.equal(decision.medusaQuantity, 0);
    assert.equal(decision.clamped, true);
    assert.equal(
      decision.availableToSell.toString(),
      "-2",
      "az előjeles érték megmarad a jelentésnek: enélkül a nulla üres raktárnak olvasódna",
    );
  });

  /** A 4. teszt. */
  it("a foglalás csökkenti a mennyiséget", () => {
    const withoutReservation = decideInventoryProjection({
      onHand: decimal("5"),
      reserved: decimal("0"),
    });
    const withReservation = decideInventoryProjection({
      onHand: decimal("5"),
      reserved: decimal("2"),
    });
    assert.equal(withoutReservation.medusaQuantity, 5);
    assert.equal(withReservation.medusaQuantity, 3);
  });

  /** Az 5. teszt: `onHand` ÖNMAGÁBAN nem kerül ki. */
  it("foglalás mellett nem az onHand megy ki", () => {
    const decision = decideInventoryProjection({
      onHand: decimal("5"),
      reserved: decimal("2"),
    });
    assert.notEqual(
      decision.medusaQuantity,
      5,
      "ha az onHand menne ki, a bolt 5-öt ígérne 3 helyett",
    );
    assert.equal(decision.medusaQuantity, 3);
  });

  it("a hiányzó foglalás nullát jelent, nem hibát", () => {
    assert.equal(
      decideInventoryProjection({ onHand: decimal("4") }).medusaQuantity,
      4,
    );
    assert.equal(
      decideInventoryProjection({ onHand: decimal("4"), reserved: null })
        .medusaQuantity,
      4,
    );
  });

  /**
   * A törtrész lefelé vágódik, és a jelentés kimondja.
   *
   * Nem üzleti döntés: a Medusa a saját elérhetőség-számításában `Math.floor`
   * műveletet végez, tehát 2,7-ből úgyis 2 lenne eladható. Enélkül a jelentés
   * többet állítana, mint amennyit a bolt elad.
   */
  it("a törtrész lefelé vágódik, és a jelentés jelzi", () => {
    const decision = decideInventoryProjection({
      onHand: decimal("2.7"),
      reserved: decimal("0"),
    });
    assert.equal(decision.medusaQuantity, 2);
    assert.equal(decision.fractionDropped, true);
    assert.equal(decision.clamped, false);
  });

  it("az egész érték nem jelez törtrészt", () => {
    const decision = decideInventoryProjection({
      onHand: decimal("2.000000"),
      reserved: decimal("0"),
    });
    assert.equal(decision.fractionDropped, false);
  });

  /**
   * A negatívnál a VÁGÁS sora számít, nem a törtrészé: a teendő más. A negatív
   * a leltárig szándékolt állapot, a törtrész viszont azt jelenti, hogy a bolt
   * kevesebbet ad el, mint amennyi a nyilvántartásban áll.
   */
  it("negatív törtnél a vágás jelződik, nem a törtrész", () => {
    const decision = decideInventoryProjection({
      onHand: decimal("-2.5"),
      reserved: decimal("0"),
    });
    assert.equal(decision.medusaQuantity, 0);
    assert.equal(decision.clamped, true);
    assert.equal(decision.fractionDropped, false);
  });

  it("a nem ábrázolható mennyiség megállít, nem kerekít", () => {
    assert.throws(
      () =>
        decideInventoryProjection({
          onHand: decimal("90071992547409910"),
          reserved: decimal("0"),
        }),
      MedusaInventoryQuantityError,
    );
  });

  it("a vetített rendelhetőség engedélyezett", () => {
    assert.equal(PROJECTED_ALLOW_BACKORDER, true);
    assert.equal(
      decideInventoryProjection({ onHand: decimal("0") }).allowBackorder,
      true,
    );
  });
});
