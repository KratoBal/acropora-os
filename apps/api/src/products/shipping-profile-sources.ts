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
  Record<`${ShippingFlag}Source`, ShippingFlagSource> & {
    /** Van-e kézi jelző, ami eltér a UNAS-étól (a lista eltérés-szűrője). */
    unasDiffers?: boolean;
  };

/** Van-e kézi jelző, ami eltér a UNAS mai beállításától. */
export function shippingUnasDiffers(
  row: Record<ShippingFlag, boolean> &
    Record<`${ShippingFlag}Source`, ShippingFlagSource>,
  unas: OsShippingProfile | null,
): boolean {
  return SHIPPING_FLAGS.some(
    (flag) =>
      row[`${flag}Source`] === "MANUAL" &&
      row[flag] !== (unas?.[flag] ?? false),
  );
}

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
        unasDiffers: false,
      },
    };
  const flags = SHIPPING_FLAGS.filter(
    (flag) =>
      existing[`${flag}Source`] === "UNAS" && existing[flag] !== ertek(flag),
  );
  const data: Partial<StoredShippingProfile> = Object.fromEntries(
    flags.map((flag) => [flag, ertek(flag)]),
  );
  // az eltérés-jelző a frissítés UTÁNI állapotból: egy kézi jelző eltérése a
  // UNAS változásával is megjelenhet vagy eltűnhet
  const differs = shippingUnasDiffers({ ...existing, ...data }, unas);
  if (differs !== (existing.unasDiffers ?? false)) data.unasDiffers = differs;
  if (Object.keys(data).length === 0) return { kind: "unchanged" };
  return { kind: "update", data, flags };
}

/** Amit a tömeges szerkesztés kér (a82ed229, a lista kijelölése). */
export interface ShippingBulkChange {
  /** Beállítandó jelzők: kézi forrással. */
  set: Partial<Record<ShippingFlag | "lockerUnsuitable", boolean>>;
  /** „UNAS szerint”: a jelző a UNAS mai értékét kapja, `UNAS` forrással. */
  resetToUnas: ShippingFlag[];
}

/**
 * EGY TERMÉK SORA A TÖMEGES SZERKESZTÉS UTÁN. A megnevezett jelző kézi lesz,
 * akkor is, ha az értéke nem változik: itt valaki kifejezetten azt mondta, és egy
 * későbbi UNAS-változás ne írja át. Új sornál a meg nem nevezett jelzők a UNAS-éi.
 */
export function bulkShippingRow(
  existing: (StoredShippingProfile & { lockerUnsuitable?: boolean }) | null,
  unas: OsShippingProfile | null,
  change: ShippingBulkChange,
): StoredShippingProfile & { lockerUnsuitable: boolean; unasDiffers: boolean } {
  const alap =
    existing ??
    (planUnasShippingFlags(null, unas) as { data: StoredShippingProfile }).data;
  const sor: StoredShippingProfile & { lockerUnsuitable: boolean } = {
    ...alap,
    lockerUnsuitable: existing?.lockerUnsuitable ?? false,
  };
  for (const flag of SHIPPING_FLAGS) {
    const ertek = change.set[flag];
    if (ertek !== undefined) {
      sor[flag] = ertek;
      sor[`${flag}Source`] = "MANUAL";
    }
  }
  if (change.set.lockerUnsuitable !== undefined)
    sor.lockerUnsuitable = change.set.lockerUnsuitable;
  for (const flag of change.resetToUnas) {
    sor[flag] = unas?.[flag] ?? false;
    sor[`${flag}Source`] = "UNAS";
  }
  return { ...sor, unasDiffers: shippingUnasDiffers(sor, unas) };
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
  unasDiffers: true,
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
  // az eltérés-jelző a VÉGSŐ sorból: egy közben beíró kézi írás után is helyes
  const vegso = await olvas();
  if (vegso) {
    const differs = shippingUnasDiffers(vegso, unas);
    if (differs !== vegso.unasDiffers)
      await tx.productShippingProfile.updateMany({
        where: { productId },
        data: { unasDiffers: differs },
      });
  }
  return plan;
}
