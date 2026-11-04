import { createHash } from "node:crypto";

import { prisma } from "@acropora/database";

import { unasShippingProfile } from "../integrations/medusa/medusa-unas-shipping.policy.js";
import {
  applyUnasShippingFlags,
  planUnasShippingFlags,
  SHIPPING_FLAGS,
  type ShippingFlag,
  type UnasShippingPlan,
} from "./shipping-profile-sources.js";

/**
 * A SZÁLLÍTÁSI JELZŐK EGYSZERI FELTÖLTÉSÉNEK MAGJA (a82ed229). Ugyanezt futtatja a parancs (`shipping-profile:fill`)
 * és az admin végpont (acrobot 42998: a flottának nincs konténer-végrehajtása, sem a stage-en, sem élesen). Minden
 * UNAS-os termék kap egy sort a UNAS mai beállításával, `UNAS` forrással; a kézzel állított jelzőhöz nem nyúl.
 *
 * A PRÓBA ÉS AZ ÍRÁS KÉT LÉPÉS: a próba kiszámolja a tervet és a lenyomatát, az írás újraszámolja, és csak akkor ír,
 * ha a lenyomat egyezik. Ha közben a UNAS-szinkron vagy egy kézi írás megváltoztatott egy sort, a terv más lesz, és
 * az írás elutasít: újra kell nézni a próbát.
 */
const KOTEG = 200;

export interface ShippingFillReport {
  products: number;
  create: number;
  update: number;
  unchanged: number;
  /** Jelzőnként: hány terméken írna át a UNAS. */
  updatedFlags: Record<ShippingFlag, number>;
  /** Kézi jelző, ami eltér a UNAS-étól: a kézi marad, de látszik. */
  manualDiffers: { productId: string; flag: ShippingFlag }[];
}

export interface ShippingFillChange {
  productId: string;
  rawPayload: unknown;
  plan: Exclude<UnasShippingPlan, { kind: "unchanged" }>;
}

export interface ShippingFillPlan {
  report: ShippingFillReport;
  changes: ShippingFillChange[];
  fingerprint: string;
}

type Db = Pick<
  typeof prisma,
  "unasProductSnapshot" | "productShippingProfile" | "$transaction"
>;

/** A terv lenyomata: termékenként a művelet és az írt értékek, termék szerint rendezve. */
export function shippingFillFingerprint(
  changes: readonly ShippingFillChange[],
): string {
  const ordered = changes
    .map((change) => [change.productId, change.plan.kind, change.plan.data])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

/** A PRÓBA: semmit nem ír. */
export async function planShippingFill(
  db: Db = prisma,
): Promise<ShippingFillPlan> {
  const report: ShippingFillReport = {
    products: 0,
    create: 0,
    update: 0,
    unchanged: 0,
    updatedFlags: {
      pickupOnly: 0,
      foxpostForbidden: 0,
      isHeavy: 0,
      isFrozen: 0,
    },
    manualDiffers: [],
  };
  const changes: ShippingFillChange[] = [];
  let utolso: string | null = null;
  for (;;) {
    const sorok: { productId: string; rawPayload: unknown }[] =
      await db.unasProductSnapshot.findMany({
        where: utolso ? { productId: { gt: utolso } } : {},
        orderBy: { productId: "asc" },
        take: KOTEG,
        select: { productId: true, rawPayload: true },
      });
    if (sorok.length === 0) break;
    utolso = sorok.at(-1)!.productId;
    const meglevok = await db.productShippingProfile.findMany({
      where: { productId: { in: sorok.map((s) => s.productId) } },
    });
    const meglevo = new Map(meglevok.map((p) => [p.productId, p]));
    for (const sor of sorok) {
      report.products++;
      const regi = meglevo.get(sor.productId) ?? null;
      const unas = unasShippingProfile(sor.rawPayload);
      const plan = planUnasShippingFlags(regi, unas);
      if (plan.kind === "create") report.create++;
      else if (plan.kind === "update") {
        report.update++;
        for (const flag of plan.flags) report.updatedFlags[flag]++;
      } else report.unchanged++;
      if (plan.kind !== "unchanged")
        changes.push({
          productId: sor.productId,
          rawPayload: sor.rawPayload,
          plan,
        });
      if (regi)
        for (const flag of SHIPPING_FLAGS)
          if (
            regi[`${flag}Source`] === "MANUAL" &&
            regi[flag] !== (unas?.[flag] ?? false)
          )
            report.manualDiffers.push({ productId: sor.productId, flag });
    }
  }
  return { report, changes, fingerprint: shippingFillFingerprint(changes) };
}

/** AZ ÍRÁS: kötegenként, tranzakcióban, a szinkron saját, jelzőnként feltételes írásával. */
export async function applyShippingFill(
  changes: readonly ShippingFillChange[],
  db: Db = prisma,
): Promise<void> {
  for (let start = 0; start < changes.length; start += KOTEG) {
    const batch = changes.slice(start, start + KOTEG);
    await db.$transaction(async (tx) => {
      for (const change of batch)
        await applyUnasShippingFlags(tx, change.productId, change.rawPayload);
    });
  }
}

export function describeShippingFill(r: ShippingFillReport): string {
  const sorok = [
    `Termék a UNAS-tükörrel: ${r.products}`,
    `Új sor (eddig nem volt): ${r.create}`,
    `Frissül (UNAS-forrású jelző változott): ${r.update}`,
    ...SHIPPING_FLAGS.map((f) => `  ${f}: ${r.updatedFlags[f]}`),
    `Változatlan: ${r.unchanged}`,
    `Kézi jelző, ami eltér a UNAS-étól (marad a kézi): ${r.manualDiffers.length}`,
    ...r.manualDiffers.slice(0, 20).map((d) => `  ${d.productId} ${d.flag}`),
  ];
  return `${sorok.join("\n")}\n`;
}
