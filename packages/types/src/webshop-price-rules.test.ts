import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseWebshopPriceRulesInput,
  WEBSHOP_PRICE_RULES,
  WEBSHOP_PRICE_RULE_SECTIONS,
} from "./webshop-price-rules.js";

/*
  A HŰSÉGPONT- ÉS ÁRSZABÁLYOK BEMENETE (acrobot 60467; commerce #880, #881, #882). MI PIROSÍT: egy hiányzó, tört vagy határon kívüli
  érték átjut; a kapcsoló 0-n és 1-en kívül mást is elfogad; az Omnibus-küszöb 15 alatt vagy 30 fölött átjut (a webshop is
  elutasítaná, de a hiba itt látsszon); a pontgyűjtés 0 százaléka (nem jár pont) nem jut át; egy mező a webshop kulcsától eltérő kulcsra mutat; egy mező olyan szakaszban áll, ami
  nincs a lapon.
*/
const rules = {
  loyaltyAccrualEnabled: 0,
  loyaltyAccrualPercent: 3,
  loyaltyAccrualOnSaleItems: 0,
  loyaltyRedemptionEnabled: 0,
  loyaltyPointValueHuf: 1,
  loyaltyMinOrderHuf: 30000,
  loyaltyMinPoints: 100,
  loyaltyMaxPercent: 100,
  omnibusMinHistoryDays: 15,
};

describe("parseWebshopPriceRulesInput", () => {
  it("accepts the old shop's values (the web shop's defaults)", () => {
    assert.deepEqual(parseWebshopPriceRulesInput(rules), {
      ok: true,
      value: rules,
    });
  });

  it("accepts the edges: switch on, no order minimum, 1 percent, 30 days", () => {
    const edges = {
      ...rules,
      loyaltyAccrualEnabled: 1,
      loyaltyAccrualPercent: 0,
      loyaltyAccrualOnSaleItems: 1,
      loyaltyRedemptionEnabled: 1,
      loyaltyMinOrderHuf: 0,
      loyaltyMaxPercent: 1,
      omnibusMinHistoryDays: 30,
    };
    assert.deepEqual(parseWebshopPriceRulesInput(edges), {
      ok: true,
      value: edges,
    });
  });

  it("refuses each field outside its bounds, missing, or not a whole number, naming the field", () => {
    const bad: [string, unknown, RegExp][] = [
      ["loyaltyAccrualEnabled", 2, /1 vagy 0/],
      ["loyaltyAccrualPercent", -1, /0 és 100 között/],
      ["loyaltyAccrualPercent", 101, /0 és 100 között/],
      ["loyaltyAccrualOnSaleItems", true, /1 vagy 0/],
      ["loyaltyRedemptionEnabled", 2, /1 vagy 0/],
      ["loyaltyRedemptionEnabled", true, /1 vagy 0/],
      ["loyaltyPointValueHuf", 0, /1 és 1 000 000 között/],
      ["loyaltyMinOrderHuf", -1, /0 és 1 000 000 000 között/],
      ["loyaltyMinPoints", 0, /1 és 1 000 000 000 között/],
      ["loyaltyMaxPercent", 101, /1 és 100 között/],
      ["loyaltyMaxPercent", 50.5, /1 és 100 között/],
      ["omnibusMinHistoryDays", 14, /15 és 30 között/],
      ["omnibusMinHistoryDays", 31, /15 és 30 között/],
      ["omnibusMinHistoryDays", "20", /15 és 30 között/],
      ["omnibusMinHistoryDays", undefined, /15 és 30 között/],
    ];
    for (const [field, value, message] of bad) {
      const parsed = parseWebshopPriceRulesInput({ ...rules, [field]: value });
      assert.equal(parsed.ok, false, `${field}=${String(value)}`);
      if (!parsed.ok) {
        assert.deepEqual(Object.keys(parsed.errors), [field]);
        assert.match(parsed.errors[field]!, message);
      }
    }
  });

  it("names the web shop's keys and only sections the page has", () => {
    assert.deepEqual(
      WEBSHOP_PRICE_RULES.map((rule) => rule.key),
      [
        "loyalty_accrual_enabled",
        "loyalty_accrual_percent",
        "loyalty_accrual_on_sale_items",
        "loyalty_redemption_enabled",
        "loyalty_point_value_huf",
        "loyalty_min_order_huf",
        "loyalty_min_points",
        "loyalty_max_percent",
        "omnibus_min_history_days",
      ],
    );
    const sections = WEBSHOP_PRICE_RULE_SECTIONS.map((section) => section.id);
    for (const rule of WEBSHOP_PRICE_RULES)
      assert.ok(
        (sections as readonly string[]).includes(rule.section),
        rule.field,
      );
  });
});
