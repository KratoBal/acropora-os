import { createHash } from "node:crypto";

import { Prisma } from "@acropora/database";
import type {
  QuoteHandoffLineDto,
  QuoteHandoffPlanDto,
  QuoteHandoffReservationDto,
  QuoteHandoffWarehouseDto,
} from "@acropora/types";

/**
 * THE HANDOFF PLAN (#1582 P6, plan 5.4), a pure function: no database, no
 * clock, so the preview and the execution under the locks compute the same
 * plan from the same rows, and its hash says whether anything moved between.
 *
 * Per PRODUCT BOM line, the stock rows of its product are filled greedily:
 * the product's default warehouse first, then the others by warehouse code.
 * A row gives `max(0, onHand − reserved)`, less what an earlier line of this
 * plan already took from it (two lines may ask for the same product). What
 * is still needed after the last row is the shortage, at most one per line.
 * A CUSTOM line is a shortage in full (nothing to hold), a SERVICE line is
 * only listed.
 *
 * No cost goes in: the plan is shown to whoever may start the project, and
 * the cost is `quotes.costs.view` only (barracuda's P6 note).
 */

export interface HandoffPlanBomItem {
  id: string;
  kind: "PRODUCT" | "CUSTOM" | "SERVICE";
  variantId: string | null;
  name: string;
  quantity: Prisma.Decimal;
  unit: string;
}

export interface HandoffPlanStockRow {
  stockItemId: string;
  variantId: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  onHand: Prisma.Decimal;
  reserved: Prisma.Decimal;
}

export interface HandoffPlanInput {
  quoteId: string;
  versionId: string;
  acceptanceId: string;
  projectName: string;
  /** the accepted items' BOM lines, in the quote's order */
  bomItems: HandoffPlanBomItem[];
  /** the stock rows of the PRODUCT lines' products, active warehouses only */
  stockRows: HandoffPlanStockRow[];
  /** a product's default warehouse, by variant id */
  defaultWarehouse: Map<string, string | null>;
  excludedWarehouseIds: readonly string[];
}

const ZERO = new Prisma.Decimal(0);
const text = (d: Prisma.Decimal) => d.toString();

export function computeHandoffPlan(
  input: HandoffPlanInput,
): QuoteHandoffPlanDto {
  const excluded = new Set(input.excludedWarehouseIds);
  const taken = new Map<string, Prisma.Decimal>();
  const lines: QuoteHandoffLineDto[] = [];
  const reservations: QuoteHandoffReservationDto[] = [];

  for (const item of input.bomItems) {
    let fromStock = ZERO;
    if (item.kind === "PRODUCT" && item.variantId) {
      const home = input.defaultWarehouse.get(item.variantId) ?? null;
      const rows = input.stockRows
        .filter(
          (r) => r.variantId === item.variantId && !excluded.has(r.warehouseId),
        )
        .sort((a, b) =>
          (a.warehouseId === home) !== (b.warehouseId === home)
            ? a.warehouseId === home
              ? -1
              : 1
            : a.warehouseCode.localeCompare(b.warehouseCode) ||
              a.stockItemId.localeCompare(b.stockItemId),
        );
      for (const row of rows) {
        const remaining = item.quantity.minus(fromStock);
        if (remaining.lessThanOrEqualTo(ZERO)) break;
        const used = taken.get(row.stockItemId) ?? ZERO;
        const free = row.onHand.minus(row.reserved).minus(used);
        const take = Prisma.Decimal.min(remaining, free);
        // a negative free stock counts as none (plan 5.4): nothing is taken
        if (take.lessThanOrEqualTo(ZERO)) continue;
        taken.set(row.stockItemId, used.plus(take));
        fromStock = fromStock.plus(take);
        reservations.push({
          quoteBomItemId: item.id,
          stockItemId: row.stockItemId,
          variantId: row.variantId,
          warehouseId: row.warehouseId,
          warehouseName: row.warehouseName,
          quantity: text(take),
        });
      }
    }
    lines.push({
      quoteBomItemId: item.id,
      kind: item.kind,
      name: item.name,
      variantId: item.variantId,
      unit: item.unit,
      needed: text(item.quantity),
      fromStock: text(fromStock),
      shortage:
        item.kind === "SERVICE" ? "0" : text(item.quantity.minus(fromStock)),
    });
  }

  const warehouses = new Map<
    string,
    QuoteHandoffWarehouseDto & { code: string }
  >();
  for (const row of input.stockRows)
    warehouses.set(row.warehouseId, {
      id: row.warehouseId,
      name: row.warehouseName,
      code: row.warehouseCode,
      excluded: excluded.has(row.warehouseId),
    });

  const plan = {
    quoteId: input.quoteId,
    versionId: input.versionId,
    acceptanceId: input.acceptanceId,
    projectName: input.projectName,
    lines,
    reservations,
    warehouses: [...warehouses.values()]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(({ id, name, excluded }) => ({ id, name, excluded })),
  };
  return { ...plan, planHash: planHash(plan) };
}

/**
 * The plan's fingerprint: what would be written, nothing that is only shown.
 * The warehouses' names are left out, so renaming one does not void a preview.
 */
export function planHash(plan: Omit<QuoteHandoffPlanDto, "planHash">): string {
  const canonical = JSON.stringify({
    versionId: plan.versionId,
    acceptanceId: plan.acceptanceId,
    projectName: plan.projectName,
    excluded: plan.warehouses
      .filter((w) => w.excluded)
      .map((w) => w.id)
      .sort(),
    lines: plan.lines.map((l) => [
      l.quoteBomItemId,
      l.kind,
      l.variantId,
      l.name,
      l.unit,
      l.needed,
      l.fromStock,
      l.shortage,
    ]),
    reservations: plan.reservations.map((r) => [
      r.quoteBomItemId,
      r.stockItemId,
      r.quantity,
    ]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
