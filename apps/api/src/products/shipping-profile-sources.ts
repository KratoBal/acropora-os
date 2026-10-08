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
 *
 * VERSENY A KÉZI ÍRÁSSAL (barracuda, #1654 2a): az olvasás és az írás között egy
 * kézi írás kézire állíthat egy jelzőt. Ezért az írás jelzőnként FELTÉTELES (a
 * forrás még `UNAS`): a Postgres a feltételt a sorzár után újraértékeli, tehát a
 * közben kézire állított jelzőhöz nem nyúl, sorzár nélkül sem.
 *
 * EGYIDEJŰ ELSŐ LÉTREHOZÁS (2b): a sort `ON CONFLICT DO NOTHING` hozza létre
 * (`skipDuplicates`). Ha közben más hozta létre, nem dob P2002-t (ami a szinkron
 * egész kötegét visszagörgetné), hanem újraolvas, és a frissítő ágon megy tovább.
 */
export async function applyUnasShippingFlags(
  tx: Pick<Prisma.TransactionClient, "productShippingProfile">,
  productId: string,
  rawPayload: unknown,
): Promise<UnasShippingPlan> {
  const unas = unasShippingProfile(rawPayload);
  const olvas = () =>
    tx.productShippingProfile.findUnique({
      where: { productId },
      select: PROFIL_MEZOK,
    });
  let plan = planUnasShippingFlags(await olvas(), unas);
  if (plan.kind === "create") {
    const { count } = await tx.productShippingProfile.createMany({
      data: [{ productId, ...plan.data }],
      skipDuplicates: true,
    });
    if (count === 1) return plan;
    plan = planUnasShippingFlags(await olvas(), unas);
  }
  if (plan.kind === "update")
    for (const flag of plan.flags)
      await tx.productShippingProfile.updateMany({
        where: { productId, [`${flag}Source`]: "UNAS" },
        data: { [flag]: plan.data[flag] },
      });
  return plan;
}
