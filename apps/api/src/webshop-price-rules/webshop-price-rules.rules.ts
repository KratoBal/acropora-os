import {
  WEBSHOP_PRICE_RULES,
  type WebshopPriceRuleField,
  type WebshopPriceRules,
} from "@acropora/types";

import type { MedusaCommerceSetting } from "../webshop-shipping-settings/webshop-shipping-settings.client.js";
import { settingAmount } from "../webshop-shipping-settings/webshop-shipping-settings.rules.js";

/**
 * The settings (in `WEBSHOP_PRICE_RULES` order) as the screen's rules. A value outside the field's bounds is shown as not
 * set (`null`), not clamped: the shop would refuse it anyway, and the screen should not invent a number.
 */
export function toPriceRules(
  settings: MedusaCommerceSetting[],
): WebshopPriceRules {
  const values = {} as WebshopPriceRules["values"];
  const defaults: WebshopPriceRuleField[] = [];
  WEBSHOP_PRICE_RULES.forEach((rule, index) => {
    const setting = settings[index]!;
    const amount = settingAmount(setting);
    values[rule.field] =
      amount !== null && amount >= rule.min && amount <= rule.max
        ? amount
        : null;
    if (setting.is_configured === false && values[rule.field] !== null)
      defaults.push(rule.field);
  });
  return { values, defaults };
}
