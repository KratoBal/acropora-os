import type { Prisma } from "@acropora/database";
import type {
  ProductShippingFilter,
  ProductShippingSummary,
} from "@acropora/types";

import { SHIPPING_FLAGS } from "./shipping-profile-sources.js";

/**
 * A TERMÉKLISTA SZÁLLÍTÁSI SZŰRŐJE (a82ed229). Egy jelleg a jelző igaz értéke;
 * a „korlátozás nélküli” az, akinek van sora és egyik jelzője sem igaz; a
 * „nincs kitöltve”, akinek még nincs sora. Az eltérés-szűrő a tárolt
 * `unasDiffers` jelzőn megy, mert a UNAS-érték csak a nyers adatból számolható.
 */
const JELZO: Partial<
  Record<ProductShippingFilter, keyof Prisma.ProductShippingProfileWhereInput>
> = {
  PICKUP_ONLY: "pickupOnly",
  HEAVY: "isHeavy",
  FOXPOST_FORBIDDEN: "foxpostForbidden",
  LOCKER_UNSUITABLE: "lockerUnsuitable",
  FROZEN: "isFrozen",
};

export function shippingWhere(
  filter: ProductShippingFilter | undefined,
  unasDiffers: boolean | undefined,
): Prisma.ProductWhereInput {
  if (filter === "NOT_FILLED")
    return unasDiffers ? { id: { in: [] } } : { shippingProfile: { is: null } };
  const feltetel: Prisma.ProductShippingProfileWhereInput = {
    ...(unasDiffers ? { unasDiffers: true } : {}),
  };
  if (filter === "UNRESTRICTED")
    Object.assign(feltetel, {
      pickupOnly: false,
      isHeavy: false,
      foxpostForbidden: false,
      lockerUnsuitable: false,
      isFrozen: false,
    });
  else if (filter) Object.assign(feltetel, { [JELZO[filter]!]: true });
  return Object.keys(feltetel).length
    ? { shippingProfile: { is: feltetel } }
    : {};
}

export type ShippingRow = Record<(typeof SHIPPING_FLAGS)[number], boolean> &
  Record<`${(typeof SHIPPING_FLAGS)[number]}Source`, "UNAS" | "MANUAL"> & {
    lockerUnsuitable: boolean;
    unasDiffers: boolean;
  };

/** A lista oszlopa egy sorból; `null`, ha a terméknek még nincs sora. */
export function shippingSummary(
  row: ShippingRow | null | undefined,
): ProductShippingSummary | null {
  if (!row) return null;
  return {
    pickupOnly: row.pickupOnly,
    foxpostForbidden: row.foxpostForbidden,
    isHeavy: row.isHeavy,
    isFrozen: row.isFrozen,
    lockerUnsuitable: row.lockerUnsuitable,
    hasManual: SHIPPING_FLAGS.some((f) => row[`${f}Source`] === "MANUAL"),
    unasDiffers: row.unasDiffers,
  };
}
