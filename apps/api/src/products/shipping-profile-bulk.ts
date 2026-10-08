import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@acropora/database";

import { unasShippingProfile } from "../integrations/medusa/medusa-unas-shipping.policy.js";
import {
  bulkShippingRow,
  SHIPPING_FLAGS,
  type ShippingBulkChange,
} from "./shipping-profile-sources.js";

export interface ShippingBulkResult {
  updated: number;
  created: number;
  /** A kért, de nem létező termékek: kimaradtak. */
  missing: string[];
}

/**
 * A TÖMEGES SZERKESZTÉS (a82ed229, a lista kijelölése). Egy tranzakció a teljes
 * kijelölésre, termékenként audit-sorral. Frissítéskor CSAK a megnevezett
 * jelzőt (és a forrását), a csomagautomata-jelzőt és az eltérés-jelzőt írja:
 * egy közben futó UNAS-szinkron a többi jelzőt frissítheti, és azt nem írjuk
 * vissza egy régebbi olvasatra.
 */
export async function runShippingBulk(
  db: Pick<PrismaClient, "$transaction">,
  productIds: readonly string[],
  change: ShippingBulkChange,
  actorUserId: string,
): Promise<ShippingBulkResult> {
  return db.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const [products, profiles, snapshots] = await Promise.all([
        tx.product.findMany({
          where: { id: { in: [...productIds] } },
          select: { id: true },
        }),
        tx.productShippingProfile.findMany({
          where: { productId: { in: [...productIds] } },
        }),
        tx.unasProductSnapshot.findMany({
          where: { productId: { in: [...productIds] } },
          select: { productId: true, rawPayload: true },
        }),
      ]);
      const letezo = new Set(products.map((p) => p.id));
      const profil = new Map(profiles.map((p) => [p.productId, p]));
      const nyers = new Map(snapshots.map((s) => [s.productId, s.rawPayload]));
      const result: ShippingBulkResult = {
        updated: 0,
        created: 0,
        missing: productIds.filter((id) => !letezo.has(id)),
      };
      for (const productId of productIds) {
        if (!letezo.has(productId)) continue;
        const regi = profil.get(productId) ?? null;
        const unas = nyers.has(productId)
          ? unasShippingProfile(nyers.get(productId))
          : null;
        const sor = bulkShippingRow(regi, unas, change);
        const megnevezett = [
          ...SHIPPING_FLAGS.filter(
            (f) =>
              change.set[f] !== undefined || change.resetToUnas.includes(f),
          ).flatMap((f) => [f, `${f}Source`] as const),
          ...(change.set.lockerUnsuitable !== undefined
            ? (["lockerUnsuitable"] as const)
            : []),
          "unasDiffers" as const,
        ];
        const frissites = Object.fromEntries(
          megnevezett.map((k) => [k, sor[k]]),
        );
        const uj = await tx.productShippingProfile.upsert({
          where: { productId },
          create: { productId, ...sor },
          update: frissites,
        });
        if (regi) result.updated++;
        else result.created++;
        const metadata = {
          productId,
          bulk: true,
          change: {
            set: change.set,
            resetToUnas: change.resetToUnas,
          },
          before: regi ? pick(regi) : null,
          after: pick(uj),
        } satisfies Prisma.JsonObject;
        await tx.auditLog.create({
          data: {
            userId: actorUserId,
            action: "product_shipping_profile.bulk_updated",
            entityType: "ProductShippingProfile",
            entityId: uj.id,
            metadata,
          },
        });
        await tx.domainEvent.create({
          data: {
            id: randomUUID(),
            eventType: "product_shipping_profile.bulk_updated",
            aggregateType: "Product",
            aggregateId: productId,
            actorUserId,
            payload: metadata,
            occurredAt: new Date(),
          },
        });
      }
      return result;
    },
    { timeout: 60_000 },
  );
}

function pick(row: Record<string, unknown>): Prisma.JsonObject {
  return Object.fromEntries(
    [
      ...SHIPPING_FLAGS.flatMap((f) => [f, `${f}Source`]),
      "lockerUnsuitable",
      "unasDiffers",
    ].map((k) => [k, row[k] as Prisma.JsonValue]),
  );
}
