import type { Prisma } from "@acropora/database";

import { MEDUSA_PRODUCT_REFERENCE } from "./medusa-product-link.repository.js";

/**
 * A KÉSZLET-VETÍTÉS ÜTEMEZETT FUTÁSÁNAK NYILVÁNTARTÁSA (kártya 54d289d3, 9738d2b5;
 * Balázs 2026-10-06 22:05:01 UTC „Mehet a 2,7,6,8”, csak a teszt kirakat).
 *
 * A vetítés a készletet az OS `StockItem` soraiból olvassa, de a Medusába eddig csak
 * a kézi `medusa:inventory` parancs vitte ki. Az ütemező (`medusa-inventory.scheduler.ts`)
 * ezt veszi át, és ehhez tudnia kell, melyik termék készlete változott az utolsó
 * kiküldés óta.
 *
 * SAJÁT SOR, NEM A TERMÉK-LEKÉPEZÉS METAADATA: egy `ExternalReference` sor
 * `entityType: "ProductInventory"`-vel, a `lastSyncedAt` a sikeres kiküldés ideje.
 * A termék-leképezés `metadata`-ját a termék-vetítés olvassa-írja (az árva-jel), és
 * két külön időzítő ugyanazon a mezőn felülírná egymást. A tábla meglévő; új oszlop
 * vagy migráció nem kell.
 *
 * A UNAS TÜKÖR-OSZLOP (`ProductVariant.unasReportedStock`) EZT NEM BEFOLYÁSOLJA: az a
 * UNAS-szinkron tájékoztató mezője, a vetítés soha nem olvassa. A forrás a fő raktár
 * hely és tétel nélküli `StockItem` sora (`onHand - reserved`), ahogy a kézi parancsé.
 */
export const MEDUSA_INVENTORY_REFERENCE = {
  system: "MEDUSA",
  entityType: "ProductInventory",
} as const;

/** Egy sikertelen termék ennyi idő múlva újra próbálkozik, ha a forrása nem változott. */
export const INVENTORY_RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * ESEDÉKES-E EGY TERMÉK KÉSZLET-KIKÜLDÉSE. Tiszta függvény.
 *
 *   - még soha nem ment ki (se siker, se kudarc):                esedékes
 *   - a forrása (készletsor, változat, besorolás) változott az
 *     utolsó próbálkozás óta:                                      esedékes
 *   - az utolsó próbálkozás kudarc volt, és régebbi a
 *     visszalépési időnél:                                         esedékes
 *   - minden más:                                                  nem
 *
 * A kudarc utáni várakozás azért kell, mert a megállás oka gyakran tartós (pl. a
 * változat nincs a Medusában): e nélkül minden kör ugyanazt próbálná és naplózná.
 */
export function decideInventoryDue(input: {
  sourceChangedAt: Date | null;
  syncedAt: Date | null;
  failedAt: Date | null;
  now: Date;
  retryAfterMs?: number;
}): boolean {
  const { sourceChangedAt, syncedAt, failedAt, now } = input;
  if (!syncedAt && !failedAt) return true;
  const last = Math.max(syncedAt?.getTime() ?? 0, failedAt?.getTime() ?? 0);
  if (sourceChangedAt && sourceChangedAt.getTime() > last) return true;
  const failedLast =
    failedAt !== null && (!syncedAt || failedAt.getTime() > syncedAt.getTime());
  return (
    failedLast &&
    now.getTime() - failedAt.getTime() >=
      (input.retryAfterMs ?? INVENTORY_RETRY_AFTER_MS)
  );
}

export interface InventorySyncDatabase {
  externalReference: {
    findMany(args: unknown): Promise<
      {
        entityId: string;
        externalId: string;
        lastSyncedAt: Date | null;
        metadata: unknown;
      }[]
    >;
    upsert(args: unknown): Promise<unknown>;
  };
  stockItem: {
    findMany(
      args: unknown,
    ): Promise<{ updatedAt: Date; variant: { productId: string } }[]>;
  };
  productVariant: {
    findMany(args: unknown): Promise<{ productId: string; updatedAt: Date }[]>;
  };
  productCategory: {
    findMany(args: unknown): Promise<{ productId: string; createdAt: Date }[]>;
  };
}

function failedAtOf(metadata: unknown): Date | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).failedAt;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function later(a: Date | undefined, b: Date): Date {
  return a && a.getTime() >= b.getTime() ? a : b;
}

/**
 * AZ ESEDÉKES TERMÉKEK, legfeljebb `limit` darab. Csak a Medusába MÁR vetített termék
 * jöhet szóba (van termék-leképezése): a készlet a vetített változatra ír, és egy
 * még nem vetített termék készletének nincs hova kimennie.
 */
export async function inventoryDueProducts(
  db: InventorySyncDatabase,
  warehouseId: string,
  limit: number,
  now: Date,
): Promise<{ productId: string; medusaProductId: string }[]> {
  const linked = await db.externalReference.findMany({
    where: { ...MEDUSA_PRODUCT_REFERENCE },
    select: {
      entityId: true,
      externalId: true,
      lastSyncedAt: true,
      metadata: true,
    },
  });
  if (!linked.length) return [];
  const ids = linked.map((row) => row.entityId);

  const [inventoryRefs, stock, variants, categories] = await Promise.all([
    db.externalReference.findMany({
      where: { ...MEDUSA_INVENTORY_REFERENCE, entityId: { in: ids } },
      select: {
        entityId: true,
        externalId: true,
        lastSyncedAt: true,
        metadata: true,
      },
    }),
    db.stockItem.findMany({
      where: {
        warehouseId,
        locationId: null,
        lotId: null,
        variant: { productId: { in: ids } },
      },
      select: { updatedAt: true, variant: { select: { productId: true } } },
    }),
    db.productVariant.findMany({
      where: { productId: { in: ids } },
      select: { productId: true, updatedAt: true },
    }),
    // a backorder a besorolásból dől el (WYSIWYG), tehát az új besorolás is forrás
    db.productCategory.findMany({
      where: { productId: { in: ids } },
      select: { productId: true, createdAt: true },
    }),
  ]);

  const changed = new Map<string, Date>();
  for (const row of stock)
    changed.set(
      row.variant.productId,
      later(changed.get(row.variant.productId), row.updatedAt),
    );
  for (const row of variants)
    changed.set(
      row.productId,
      later(changed.get(row.productId), row.updatedAt),
    );
  for (const row of categories)
    changed.set(
      row.productId,
      later(changed.get(row.productId), row.createdAt),
    );
  const refs = new Map(inventoryRefs.map((row) => [row.entityId, row]));

  const due: { productId: string; medusaProductId: string }[] = [];
  for (const product of linked) {
    const ref = refs.get(product.entityId);
    if (
      decideInventoryDue({
        sourceChangedAt: changed.get(product.entityId) ?? null,
        syncedAt: ref?.lastSyncedAt ?? null,
        failedAt: failedAtOf(ref?.metadata),
        now,
      })
    )
      due.push({
        productId: product.entityId,
        medusaProductId: product.externalId,
      });
    if (due.length >= limit) break;
  }
  return due;
}

/**
 * A PRÓBÁLKOZÁS RÖGZÍTÉSE. Sikernél a `lastSyncedAt` a futás KEZDETE (nem a vége):
 * ami a futás alatt változott, a következő körben újra esedékes lesz. Kudarcnál a
 * `lastSyncedAt` nem mozdul, a `metadata.failedAt` és az ok kerül rá.
 */
export async function recordInventoryAttempt(
  db: InventorySyncDatabase,
  input: {
    productId: string;
    medusaProductId: string;
    startedAt: Date;
    failure: string | null;
  },
): Promise<void> {
  const key = {
    system_entityType_entityId: {
      ...MEDUSA_INVENTORY_REFERENCE,
      entityId: input.productId,
    },
  };
  const failure = input.failure
    ? ({
        failedAt: input.startedAt.toISOString(),
        reason: input.failure.slice(0, 300),
      } satisfies Prisma.JsonObject)
    : null;
  await db.externalReference.upsert({
    where: key,
    create: {
      ...MEDUSA_INVENTORY_REFERENCE,
      entityId: input.productId,
      externalId: input.medusaProductId,
      lastSyncedAt: failure ? null : input.startedAt,
      metadata: failure ?? undefined,
    },
    update: failure
      ? { externalId: input.medusaProductId, metadata: failure }
      : {
          externalId: input.medusaProductId,
          lastSyncedAt: input.startedAt,
          metadata: {},
        },
  });
}
