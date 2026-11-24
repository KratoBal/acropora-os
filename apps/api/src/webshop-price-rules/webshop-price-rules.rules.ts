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
 * The screen's rules from what the shop uses: the redemption's five fields and the accrual's three from
 * `GET /admin/loyalty-settings` (the value in use and its source: a stored row, the environment, the default), the Omnibus
 * threshold from its setting key (a row or the default; it has no environment source). A switch is `true`/`false` there and
 * 1/0 here. A source the OS does not know (a newer shop) is shown as `default`, the least it can claim; a shop from before
 * the accrual (#882) gives no accrual part, so those fields are not set.
 */
export function toPriceRules(
  loyalty: MedusaLoyaltySettings,
  omnibus: MedusaCommerceSetting,
): WebshopPriceRules {
  const values = {} as WebshopPriceRules["values"];
  const sources = {} as WebshopPriceRules["sources"];
  for (const rule of WEBSHOP_PRICE_RULES) {
    if (rule.shopField === null) {
      values[rule.field] = inBounds(settingAmount(omnibus), rule);
      sources[rule.field] = omnibus.is_configured === false ? "default" : "row";
      continue;
    }
    const part = rule.shopField.part === "accrual" ? loyalty.accrual : loyalty;
    const raw = (part?.settings as Record<string, unknown> | undefined)?.[
      rule.shopField.name
    ];
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
    const source = (part?.sources as Record<string, unknown> | undefined)?.[
      rule.shopField.name
    ];
    sources[rule.field] =
      typeof source === "string" &&
      (SOURCES as readonly string[]).includes(source)
        ? (source as WebshopPriceRuleSource)
        : "default";
  }
  return { values, sources };
}
