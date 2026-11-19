import {
  WEBSHOP_PAYMENT_ROLES,
  WEBSHOP_SHIPPING_FEES,
  WEBSHOP_SHIPPING_ROLES,
  type WebshopPaymentMatrix,
  type WebshopPaymentRole,
  type WebshopShippingFeeField,
  type WebshopShippingSettings,
} from "@acropora/types";

import type { MedusaCommerceSetting } from "./webshop-shipping-settings.client.js";

/**
 * A stored value is text (the web shop's column), a default a number; anything that is not a whole number stays `null`,
 * so the screen shows it as not set instead of inventing a value.
 */
export function settingAmount(setting: MedusaCommerceSetting): number | null {
  const value =
    typeof setting.value === "string" && setting.value.trim() !== ""
      ? Number(setting.value)
      : setting.value;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/** The payment roles the web shop returned that the OS does not know, in their first order (a new shop payment method). */
export function unknownPaymentRoles(
  matrix: Record<string, string[]> | undefined,
): string[] {
  const known = WEBSHOP_PAYMENT_ROLES as readonly string[];
  return [
    ...new Set(
      Object.values(matrix ?? {})
        .flat()
        .filter((p) => !known.includes(p)),
    ),
  ];
}

/**
 * The web shop's matrix as the screen's: the known shipping methods in the screen's order, each with its known payment
 * methods in the shop's order. A shipping method the shop does not list gets an empty list (the screen then asks for one).
 * An unknown payment method is left out here, and named by `unknownPaymentRoles`, which stops the save.
 */
export function toPaymentMatrix(
  matrix: Record<string, string[]> | undefined,
): WebshopPaymentMatrix {
  return Object.fromEntries(
    WEBSHOP_SHIPPING_ROLES.map((shipping) => [
      shipping,
      (matrix?.[shipping] ?? []).filter((p): p is WebshopPaymentRole =>
        (WEBSHOP_PAYMENT_ROLES as readonly string[]).includes(p),
      ),
    ]),
  ) as WebshopPaymentMatrix;
}

/** The six settings (in `WEBSHOP_SHIPPING_FEES` order) and the matrix as the screen's settings. */
export function toShippingSettings(
  settings: MedusaCommerceSetting[],
  matrix: Record<string, string[]> | undefined,
): WebshopShippingSettings {
  const fees = {} as WebshopShippingSettings["fees"];
  const defaultFees: WebshopShippingFeeField[] = [];
  WEBSHOP_SHIPPING_FEES.forEach(({ field }, index) => {
    const setting = settings[index]!;
    fees[field] = settingAmount(setting);
    if (setting.is_configured === false && fees[field] !== null)
      defaultFees.push(field);
  });
  return {
    fees,
    defaultFees,
    matrix: toPaymentMatrix(matrix),
    unknownPayments: unknownPaymentRoles(matrix),
  };
}
