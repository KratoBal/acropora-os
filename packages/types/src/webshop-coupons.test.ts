import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseWebshopCouponInput } from "./webshop-coupons.js";

/*
  A KUPON BEMENETE (kártya 393ae5cb): ugyanaz a szabály a rögzítő űrlapon és az API-ban. MI PIROSÍT: egy hibás kód, százalék,
  összeg, dátum vagy korlát átjut; a kód nem igazodik nagybetűsre; a jó bemenet elakad.
*/

const good = {
  code: " tavasz-10 ",
  kind: "PERCENT",
  value: 10,
  validFrom: "2026-03-01",
  validUntil: "2026-03-31",
  usageLimit: 100,
};

describe("parseWebshopCouponInput", () => {
  it("accepts a good coupon and writes the code in capitals without spaces around it", () => {
    assert.deepEqual(parseWebshopCouponInput(good), {
      ok: true,
      value: {
        code: "TAVASZ-10",
        kind: "PERCENT",
        value: 10,
        validFrom: "2026-03-01",
        validUntil: "2026-03-31",
        usageLimit: 100,
      },
    });
  });

  it("takes no dates and no limit as open-ended", () => {
    const parsed = parseWebshopCouponInput({
      code: "EZER",
      kind: "AMOUNT",
      value: 1000,
      validFrom: "",
      validUntil: null,
    });
    assert.deepEqual(parsed, {
      ok: true,
      value: {
        code: "EZER",
        kind: "AMOUNT",
        value: 1000,
        validFrom: null,
        validUntil: null,
        usageLimit: null,
      },
    });
  });

  it("refuses each bad field with its own message", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ code: "AB" }, "code"],
      [{ code: "ÁRAM10" }, "code"],
      [{ code: "TAVASZ 10" }, "code"],
      [{ kind: "SHIPPING" }, "kind"],
      [{ value: 0 }, "value"],
      [{ value: 101 }, "value"],
      [{ value: 10.5 }, "value"],
      [{ kind: "AMOUNT", value: 0 }, "value"],
      [{ validFrom: "2026-02-30" }, "validFrom"],
      [{ validUntil: "2026-02-28" }, "validUntil"],
      [{ usageLimit: 0 }, "usageLimit"],
      [{ usageLimit: 2.5 }, "usageLimit"],
    ];
    for (const [over, field] of cases) {
      const parsed = parseWebshopCouponInput({ ...good, ...over });
      assert.equal(parsed.ok, false, JSON.stringify(over));
      if (!parsed.ok)
        assert.ok(parsed.errors[field], `${field}: ${JSON.stringify(over)}`);
    }
  });

  it("the nearest allowed neighbours pass: 1 and 100 percent, one forint, a one-day window, a limit of 1", () => {
    for (const over of [
      { value: 1 },
      { value: 100 },
      { kind: "AMOUNT", value: 1 },
      { validUntil: "2026-03-01" },
      { usageLimit: 1 },
    ])
      assert.equal(
        parseWebshopCouponInput({ ...good, ...over }).ok,
        true,
        JSON.stringify(over),
      );
  });
});
