import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  decidePricingProjection,
  MEDUSA_CURRENCY_CODE,
  type PricingRefusal,
} from "./medusa-pricing.policy.js";

/**
 * A döntés, hálózat nélkül.
 *
 * A táblázat minden sora egy OLYAN bemenet, amitől a döntés MÁS lesz. Ha egy
 * sorhoz nem tudnék ilyen bemenetet írni, az a sor nem mérne semmit.
 */

const huf = (value: string) => ({
  sellingGrossPrice: new Prisma.Decimal(value),
  sellingPriceCurrency: "HUF",
});

describe("decidePricingProjection", () => {
  it("sends a whole-forint gross price unchanged", () => {
    const decision = decidePricingProjection(huf("12990"));

    assert.deepEqual(decision, {
      send: true,
      amount: 12990,
      currencyCode: MEDUSA_CURRENCY_CODE,
    });
  });

  /**
   * A VÁLTOZATLANSÁG KÜLÖN ÁLLÍTÁS, nem a fenti eset ismétlése.
   *
   * Ez a teszt azt őrzi, hogy senki ne tegyen be egy „közben gyorsan
   * átváltom" sort: az OS bruttó árat tárol, a bolt adóval növeltnek veszi,
   * tehát bármilyen áfa-osztás vagy szorzás hibás lenne. A szándékos rontás,
   * amitől pirosra kell váltania, egy 1.27-tel való osztás.
   */
  it("applies no conversion at all, for any amount", () => {
    for (const value of ["1", "999", "12990", "1000000"]) {
      const decision = decidePricingProjection(huf(value));
      assert.equal(decision.send, true);
      if (!decision.send) return;
      assert.equal(decision.amount, Number(value));
    }
  });

  const refusals: {
    name: string;
    input: Parameters<typeof decidePricingProjection>[0];
    reason: PricingRefusal;
  }[] = [
    {
      name: "no price at all",
      input: { sellingGrossPrice: null, sellingPriceCurrency: null },
      reason: "price-missing",
    },
    {
      name: "an amount without a currency",
      input: {
        sellingGrossPrice: new Prisma.Decimal("100"),
        sellingPriceCurrency: null,
      },
      reason: "currency-missing",
    },
    {
      name: "a currency this round does not support",
      input: {
        sellingGrossPrice: new Prisma.Decimal("100"),
        sellingPriceCurrency: "EUR",
      },
      reason: "currency-not-supported",
    },
    {
      name: "a negative amount",
      input: huf("-1"),
      reason: "price-negative",
    },
    {
      name: "a fractional forint",
      input: huf("12990.5"),
      reason: "price-not-whole-forint",
    },
    {
      name: "an amount beyond exact integer representation",
      input: huf("9007199254740993"),
      reason: "price-not-whole-forint",
    },
    {
      name: "zero, which is an open business question",
      input: huf("0"),
      reason: "price-zero-needs-decision",
    },
  ];

  for (const { name, input, reason } of refusals)
    it(`refuses ${name}`, () => {
      const decision = decidePricingProjection(input);

      assert.equal(decision.send, false);
      if (decision.send) return;
      assert.equal(decision.reason, reason);
      /**
       * Az indoklás nem lehet üres: a megállás-ok NEVE a teendőt adja, a
       * szöveg pedig azt, hogy MIÉRT. Egy néma megállás ugyanolyan rossz,
       * mint egy néma továbbengedés.
       */
      assert.ok(decision.details.length > 20);
    });

  /**
   * A NULLA NEM AZÉRT ÁLL MEG, MERT TÖRT. Ha a két ág sorrendje felcserélődne,
   * a nulla „tört forint" indokot kapna, és a jelentés rossz teendőt adna.
   */
  it("tells zero and a fraction apart", () => {
    const zero = decidePricingProjection(huf("0"));
    const fraction = decidePricingProjection(huf("0.5"));

    assert.equal(zero.send, false);
    assert.equal(fraction.send, false);
    if (zero.send || fraction.send) return;
    assert.notEqual(zero.reason, fraction.reason);
  });
});
