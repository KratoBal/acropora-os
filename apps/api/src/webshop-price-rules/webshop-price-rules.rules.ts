import {
  WEBSHOP_PRICE_RULES,
  type WebshopPriceRuleSource,
  type WebshopPriceRules,
} from "@acropora/types";

import type { MedusaCommerceSetting } from "../webshop-shipping-settings/webshop-shipping-settings.client.js";
import { settingAmount } from "../webshop-shipping-settings/webshop-shipping-settings.rules.js";
import type { MedusaLoyaltySettings } from "./webshop-price-rules.client.js";

const SOURCES: readonly WebshopPriceRuleSource[] = [
  "row",
  "env",
  "default",
  "row_invalid",
  "read_failed",
];

/** A whole number within the rule's bounds, or `null`: a value outside them is shown as not set, not clamped. */
const inBounds = (
  value: number | null,
  rule: (typeof WEBSHOP_PRICE_RULES)[number],
): number | null =>
  value !== null &&
  Number.isInteger(value) &&
  value >= rule.min &&
  value <= rule.max
    ? value
    : null;

/**
 * The screen's rules from what the shop uses: the redemption's five fields from `GET /admin/loyalty-settings` (the value in
 * use and its source: a stored row, the environment, the default), the Omnibus threshold from its setting key (a row or the
 * default; it has no environment source). The switch is `true`/`false` there and 1/0 here. A source the OS does not know (a
 * newer shop) is shown as `default`, the least it can claim.
 */
export function toPriceRules(
  loyalty: MedusaLoyaltySettings,
  omnibus: MedusaCommerceSetting,
): WebshopPriceRules {
  const values = {} as WebshopPriceRules["values"];
  const sources = {} as WebshopPriceRules["sources"];
  for (const rule of WEBSHOP_PRICE_RULES) {
    if (rule.loyaltyField === null) {
      values[rule.field] = inBounds(settingAmount(omnibus), rule);
      sources[rule.field] = omnibus.is_configured === false ? "default" : "row";
      continue;
    }
    const raw = loyalty.settings[rule.loyaltyField];
    values[rule.field] = inBounds(
      typeof raw === "boolean"
        ? raw
          ? 1
          : 0
        : typeof raw === "number"
          ? raw
          : null,
      rule,
    );
    const source = loyalty.sources[rule.loyaltyField];
    sources[rule.field] = (SOURCES as readonly string[]).includes(source)
      ? (source as WebshopPriceRuleSource)
      : "default";
  }
  return { values, sources };
}
