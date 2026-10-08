import type { Prisma } from "@acropora/database";

import type { OsShippingProfile } from "../integrations/medusa/medusa-shipping-attributes.policy.js";
import { unasShippingProfile } from "../integrations/medusa/medusa-unas-shipping.policy.js";

/**
 * A SZÁLLÍTÁSI JELZŐK GAZDÁJA AZ OS (a82ed229, Balázs 2026-10-08 11:16 UTC).
 * Minden jelző mellett a forrás: `UNAS` (a UNAS-szinkron számolja újra minden
 * futásnál) vagy `MANUAL` (kézzel állították, a szinkron nem írja felül). A
 * „csomagautomatába nem fér” jelzőt a UNAS nem ismeri, tehát nincs forrása: kézi.
 */
export const SHIPPING_FLAGS = [
  "pickupOnly",
  "foxpostForbidden",
  "isHeavy",
  "isFrozen",
] as const;
export type ShippingFlag = (typeof SHIPPING_FLAGS)[number];
export type ShippingFlagSource = "UNAS" | "MANUAL";

export type StoredShippingProfile = Record<ShippingFlag, boolean> &
  Record<`${ShippingFlag}Source`, ShippingFlagSource>;

export type UnasShippingPlan =
  | { kind: "create"; data: StoredShippingProfile }
  | {
      kind: "update";
      data: Partial<StoredShippingProfile>;
      flags: ShippingFlag[];
    }
  | { kind: "unchanged" };

/**
 * A UNAS mai beállítása egy termékre, és mit ír belőle az OS. A UNAS
 * felülírása nélküli termék (`unasShippingProfile` `null`) korlátozás nélküli:
 * minden jelzője hamis, `UNAS` forrással.
 *
 * - nincs még sor: létrejön, minden jelző a UNAS-é;
 * - van sor: csak a `UNAS` forrású jelzők frissülnek, a kézit nem írja felül.
 */
export function planUnasShippingFlags(
  existing: StoredShippingProfile | null,
  unas: OsShippingProfile | null,
): UnasShippingPlan {
  const ertek = (flag: ShippingFlag) => unas?.[flag] ?? false;
  if (!existing)
    return {
      kind: "create",
      data: {
        pickupOnly: ertek("pickupOnly"),
        foxpostForbidden: ertek("foxpostForbidden"),
        isHeavy: ertek("isHeavy"),
        isFrozen: ertek("isFrozen"),
        pickupOnlySource: "UNAS",
        foxpostForbiddenSource: "UNAS",
        isHeavySource: "UNAS",
        isFrozenSource: "UNAS",
      },
    };
  const flags = SHIPPING_FLAGS.filter(
    (flag) =>
      existing[`${flag}Source`] === "UNAS" && existing[flag] !== ertek(flag),
  );
  if (flags.length === 0) return { kind: "unchanged" };
  return {
    kind: "update",
    data: Object.fromEntries(flags.map((flag) => [flag, ertek(flag)])),
    flags,
  };
}

const PROFIL_MEZOK = {
  pickupOnly: true,
  foxpostForbidden: true,
  isHeavy: true,
  isFrozen: true,
  pickupOnlySource: true,
  foxpostForbiddenSource: true,
  isHeavySource: true,
  isFrozenSource: true,
} as const;

/**
 * EGY TERMÉK JELZŐI A UNAS NYERS ADATÁBÓL, a hívó tranzakciójában (a
 * UNAS-szinkron a snapshot írása után hívja, a feltöltő parancs kötegenként).
 */
export async function applyUnasShippingFlags(
  tx: Pick<Prisma.TransactionClient, "productShippingProfile">,
  productId: string,
  rawPayload: unknown,
): Promise<UnasShippingPlan> {
  const existing = await tx.productShippingProfile.findUnique({
    where: { productId },
    select: PROFIL_MEZOK,
  });
  const plan = planUnasShippingFlags(existing, unasShippingProfile(rawPayload));
  if (plan.kind === "create")
    await tx.productShippingProfile.create({
      data: { productId, ...plan.data },
    });
  else if (plan.kind === "update")
    await tx.productShippingProfile.update({
      where: { productId },
      data: plan.data,
    });
  return plan;
}
