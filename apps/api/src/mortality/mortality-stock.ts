import { Prisma } from "@acropora/database";
import type {
  MortalityStockEffect,
  MortalityStockReason,
} from "@acropora/types";

import { generateCode } from "../common/code-generator.util.js";
import {
  postInventoryMovement,
  type InventoryMovementDatabase,
  type InventoryMovementLineInput,
} from "../common/inventory-movement-writer.js";
import {
  ensureMainWarehouse,
  type WarehouseLookupDatabase,
} from "../common/warehouse.util.js";
import { isUnasMasteredVariant } from "../products/catalog-authority.js";

/**
 * AZ ELHULLÁS KÉSZLETHATÁSA (Balázs, 2026-10-07 06:23:38 UTC: „ha olyan
 * élőlényt ír be az ember, ami bent van a rendszerben és készlete is van, akkor
 * csökkentse a készletet az elhullás számával”).
 *
 * A KÖZPONTI ÍRÓN ÁT (`postInventoryMovement`), mint minden más készletmozgás:
 * a fő raktár `StockItem`-je csökken, és UNAS-gazdájú terméknél ugyanabban a
 * tranzakcióban `UnasStockSyncOutbox` sor keletkezik, tehát a levonás az élő
 * bolt készletébe is kimegy (a bolti eladással azonos úton).
 *
 * NEGATÍV KÉSZLET: engedjük, figyelmeztetéssel, ahogy a bolti eladás
 * (docs/INVENTORY-CONSISTENCY.md, „Negatív készlet”). Az elhullás megtörtént
 * tény: ha a rendszer kevesebbet tudott, a hiba a készletben van, nem az
 * elhullásban, és egy nullára vágás a különbséget eltüntetné.
 *
 * A NAPLÓ AZ IGAZSÁG, NEM A BEJEGYZÉS: a már levont mennyiséget a bejegyzésre
 * hivatkozó mozgásokból összegezzük, és csak a különbséget könyveljük. Így egy
 * módosítás (más példányszám, más élőlény, szabad szövegre váltás) pontosan a
 * különbséget mozgatja, és egy megismételt kérés nem von le kétszer.
 *
 *   levonás            SCRAP     (a napló előjele: -1)
 *   visszaírás         RETURN_IN (+1), ugyanaz, amivel a UNAS-rendelés
 *                      sztornója visszateszi a készletet
 */

export const MORTALITY_REFERENCE_TYPE = "MortalityRecord";

export interface MortalityStockProduct {
  type: string;
  catalogAuthority: "UNAS" | "ACROPORA" | null;
  /** az aktív változatok */
  variants: readonly { id: string; sku: string; unit: string }[];
  isPackageProduct: boolean;
}

export interface MortalityStockTarget {
  variantId: string;
  sku: string;
  unit: string;
  quantity: Prisma.Decimal;
  syncToUnas: boolean;
}

/**
 * MIT KELL LEVONNI a bejegyzés mai állapota szerint. Tiszta függvény. A szabályok
 * a számla készlethatásával azonosak (`billing-document-stock.ts`): szolgáltatás
 * nem mozog; több aktív változatnál nem találgatunk; csomagterméknél nem
 * bontunk (élő állatnál nem fordul elő, és egy félig feloldott csomag rosszabb a
 * semminél).
 */
export function planMortalityStock(
  product: MortalityStockProduct | null,
  quantity: number,
): {
  target: MortalityStockTarget | null;
  reason: MortalityStockReason | null;
} {
  if (!product) return { target: null, reason: "FREE_TEXT" };
  if (product.type === "SERVICE")
    return { target: null, reason: "NOT_STOCKED" };
  if (product.isPackageProduct) return { target: null, reason: "PACKAGE" };
  if (product.variants.length === 0)
    return { target: null, reason: "NO_VARIANT" };
  if (product.variants.length > 1)
    return { target: null, reason: "VARIANT_NOT_CHOSEN" };
  const variant = product.variants[0]!;
  return {
    target: {
      variantId: variant.id,
      sku: variant.sku,
      unit: variant.unit,
      quantity: new Prisma.Decimal(quantity),
      syncToUnas: isUnasMasteredVariant({
        product: { catalogAuthority: product.catalogAuthority },
      }),
    },
    reason: null,
  };
}

export interface MortalityLedgerLine {
  type: string;
  variantId: string;
  /** a napló sora abszolút mennyiséget tart; az előjelet a típus adja */
  quantity: Prisma.Decimal;
  sku: string;
  unit: string;
  syncToUnas: boolean;
}

/** Változatonként a bejegyzés miatt NETTÓBAN levont mennyiség (pozitív = levonva). */
export function deductedByVariant(
  lines: readonly MortalityLedgerLine[],
): Map<string, MortalityStockTarget> {
  const byVariant = new Map<string, MortalityStockTarget>();
  for (const line of lines) {
    const sign = line.type === "SCRAP" ? 1 : line.type === "RETURN_IN" ? -1 : 0;
    if (sign === 0) continue;
    const existing = byVariant.get(line.variantId);
    const delta = line.quantity.times(sign);
    if (existing) existing.quantity = existing.quantity.plus(delta);
    else
      byVariant.set(line.variantId, {
        variantId: line.variantId,
        sku: line.sku,
        unit: line.unit,
        quantity: delta,
        syncToUnas: line.syncToUnas,
      });
  }
  return byVariant;
}

/**
 * A KÖNYVELENDŐ KÜLÖNBSÉG: ami a célhoz képest még nincs levonva (SCRAP), és ami
 * túl van vonva vagy már nem ide tartozik (RETURN_IN). Tiszta függvény; a
 * `quantityDelta` a központi író előjeles alakja.
 */
export function mortalityCorrections(
  deducted: ReadonlyMap<string, MortalityStockTarget>,
  target: MortalityStockTarget | null,
): {
  deduct: InventoryMovementLineInput[];
  giveBack: InventoryMovementLineInput[];
} {
  const deduct: InventoryMovementLineInput[] = [];
  const giveBack: InventoryMovementLineInput[] = [];
  const variantIds = new Set([
    ...deducted.keys(),
    ...(target ? [target.variantId] : []),
  ]);
  for (const variantId of variantIds) {
    const already = deducted.get(variantId);
    const wanted =
      target && target.variantId === variantId
        ? target.quantity
        : new Prisma.Decimal(0);
    const diff = wanted.minus(already?.quantity ?? 0);
    if (diff.isZero()) continue;
    const line = (target && target.variantId === variantId ? target : already)!;
    const base = {
      variantId,
      sku: line.sku,
      unit: line.unit,
      syncToUnas: line.syncToUnas,
    };
    if (diff.isPositive())
      deduct.push({ ...base, quantityDelta: diff.negated() });
    else giveBack.push({ ...base, quantityDelta: diff.negated() });
  }
  return { deduct, giveBack };
}

/** A bejegyzés készlethatása a részletlaphoz: a naplóból és a mai tervből. */
export function mortalityStockEffect(
  deducted: ReadonlyMap<string, MortalityStockTarget>,
  reason: MortalityStockReason | null,
): MortalityStockEffect {
  const moved = [...deducted.values()].filter(
    (line) => !line.quantity.isZero(),
  );
  return {
    deducted: moved.reduce((sum, line) => sum + line.quantity.toNumber(), 0),
    sku: moved.length === 1 ? moved[0]!.sku : null,
    reason,
  };
}

export type MortalityStockDatabase = InventoryMovementDatabase & {
  mortalityRecord: {
    findUnique(args: unknown): Promise<{
      id: string;
      recordNumber: string;
      quantity: number;
      productId: string | null;
    } | null>;
  };
  product: { findUnique(args: unknown): Promise<unknown> };
  stockMovementLine: InventoryMovementDatabase["stockMovementLine"] & {
    findMany(args: unknown): Promise<unknown[]>;
  };
  stockMovement: InventoryMovementDatabase["stockMovement"] & {
    count(args: unknown): Promise<number>;
  };
  warehouse: WarehouseLookupDatabase["warehouse"];
};

const PRODUCT_SELECT = {
  type: true,
  catalogAuthority: true,
  variants: {
    where: { isActive: true },
    select: { id: true, sku: true, unit: true },
  },
  unasSnapshot: { select: { isPackageProduct: true } },
} as const;

interface ProductRow {
  type: string;
  catalogAuthority: "UNAS" | "ACROPORA" | null;
  variants: { id: string; sku: string; unit: string }[];
  unasSnapshot: { isPackageProduct: boolean } | null;
}

/** A bejegyzés termékének készlet-adatai (vagy `null`, ha szabad szöveg). */
export async function mortalityStockProduct(
  db: Pick<MortalityStockDatabase, "product">,
  productId: string | null,
): Promise<MortalityStockProduct | null> {
  if (!productId) return null;
  const row = (await db.product.findUnique({
    where: { id: productId },
    select: PRODUCT_SELECT,
  })) as ProductRow | null;
  if (!row) return null;
  return {
    type: row.type,
    catalogAuthority: row.catalogAuthority,
    variants: row.variants,
    isPackageProduct: row.unasSnapshot?.isPackageProduct ?? false,
  };
}

interface LedgerRow {
  variantId: string;
  quantity: Prisma.Decimal;
  movement: { type: string };
  variant: {
    sku: string;
    unit: string;
    product: { catalogAuthority: "UNAS" | "ACROPORA" | null };
  };
}

/** A bejegyzésre hivatkozó naplósorok. */
export async function mortalityLedger(
  db: Pick<MortalityStockDatabase, "stockMovementLine">,
  recordId: string,
): Promise<MortalityLedgerLine[]> {
  const rows = (await db.stockMovementLine.findMany({
    where: {
      movement: {
        referenceType: MORTALITY_REFERENCE_TYPE,
        referenceId: recordId,
      },
    },
    select: {
      variantId: true,
      quantity: true,
      movement: { select: { type: true } },
      variant: {
        select: {
          sku: true,
          unit: true,
          product: { select: { catalogAuthority: true } },
        },
      },
    },
  })) as LedgerRow[];
  return rows.map((row) => ({
    type: row.movement.type,
    variantId: row.variantId,
    quantity: new Prisma.Decimal(row.quantity),
    sku: row.variant.sku,
    unit: row.variant.unit,
    syncToUnas: isUnasMasteredVariant({
      product: { catalogAuthority: row.variant.product.catalogAuthority },
    }),
  }));
}

/**
 * A BEJEGYZÉS KÉSZLETÉNEK IGAZÍTÁSA, A HÍVÓ TRANZAKCIÓJÁBAN (a létrehozás és a
 * módosítás is ezt hívja). A bejegyzésre tranzakció-szintű zárat tesz, így két
 * egyidejű módosítás nem számolja ki ugyanazt a különbséget kétszer; a zár a
 * tranzakció végén magától oldódik.
 */
export async function syncMortalityStock(
  tx: MortalityStockDatabase,
  recordId: string,
  actorUserId: string,
  now: Date = new Date(),
): Promise<{ posted: number; wentNegative: string[] }> {
  const lockKey = `${MORTALITY_REFERENCE_TYPE}:${recordId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

  const record = await tx.mortalityRecord.findUnique({
    where: { id: recordId },
    select: { id: true, recordNumber: true, quantity: true, productId: true },
  });
  if (!record) return { posted: 0, wentNegative: [] };

  const { target } = planMortalityStock(
    await mortalityStockProduct(tx, record.productId),
    record.quantity,
  );
  const { deduct, giveBack } = mortalityCorrections(
    deductedByVariant(await mortalityLedger(tx, record.id)),
    target,
  );
  if (deduct.length === 0 && giveBack.length === 0)
    return { posted: 0, wentNegative: [] };

  const warehouse = await ensureMainWarehouse(tx);
  // a zár alatt stabil sorszám: hány mozgás hivatkozik már a bejegyzésre
  let sequence = await tx.stockMovement.count({
    where: { referenceType: MORTALITY_REFERENCE_TYPE, referenceId: record.id },
  });
  let posted = 0;
  const wentNegative: string[] = [];
  for (const [type, lines] of [
    ["RETURN_IN", giveBack],
    ["SCRAP", deduct],
  ] as const) {
    if (lines.length === 0) continue;
    sequence += 1;
    const result = await postInventoryMovement(tx, {
      idempotencyKey: `MORTALITY:${record.id}:${sequence}`,
      movementNumber: generateCode("ELHM"),
      type,
      warehouseId: warehouse.id,
      referenceType: MORTALITY_REFERENCE_TYPE,
      referenceId: record.id,
      performedById: actorUserId,
      occurredAt: now,
      note: record.recordNumber,
      sourceProcess: "MORTALITY",
      lines,
    });
    posted += 1;
    for (const line of result.lines)
      if (line.wentNegative) wentNegative.push(line.sku);
  }
  return { posted, wentNegative };
}
