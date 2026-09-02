import { Controller, Get, Query } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";
import { prisma } from "@acropora/database";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { ensureMainWarehouse } from "../common/warehouse.util.js";
import { StockReconciliationService } from "./stock-reconciliation.service.js";

function parsePage(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parsePageSize(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, 200)
    : 50;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/// Read-only admin diagnostics surface for the stock-reconciliation module.
/// Every route HERE is a GET, gated on INVENTORY_VIEW like every other
/// read-only inventory endpoint in this codebase
/// (unas-stock-sync-outbox.controller.ts, inventory-count.controller.ts).
///
/// THE MUTATION EXISTS NOW, and this comment said otherwise until 2026-09-01.
/// It lives in stock-reconciliation-repair.controller.ts, under the SAME route
/// prefix (`inventory/reconciliation`), behind a narrower permission
/// (INVENTORY_RECONCILIATION_REPAIR, which MANAGER explicitly does not hold):
/// `:stockItemId/repair-local` and `:stockItemId/republish-unas`.
///
/// The original deferral was DELIBERATE, not forgotten -- see
/// docs/INVENTORY-CONSISTENCY.md's reconciliation section, "Biztonságos
/// javítási terv", for why the repair endpoint was postponed rather than
/// half-built at that checkpoint. Saying so matters: without it this reads
/// like an oversight, and the next person re-litigates a decision that was
/// already made on purpose.
///
/// WHY THIS PARAGRAPH WAS WRONG FOR A WHILE, and worth a line: the repair
/// landed in a DIFFERENT file, so nothing forced this header to change with
/// it. A description that outlives its subject is worse than none, because
/// whoever reads it stops looking.
@Controller("inventory/reconciliation")
export class StockReconciliationController {
  constructor(private readonly service: StockReconciliationService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  page(
    @Query("variantId") variantId: unknown,
    @Query("warehouseId") warehouseId: unknown,
    @Query("page") page: unknown,
    @Query("pageSize") pageSize: unknown,
  ) {
    return this.service.reconcilePage({
      variantId: parseOptionalString(variantId),
      warehouseId: parseOptionalString(warehouseId),
      page: parsePage(page),
      pageSize: parsePageSize(pageSize),
    });
  }

  @Get("missing-stock-item")
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  async missingStockItem(
    @Query("warehouseId") warehouseId: unknown,
    @Query("page") page: unknown,
    @Query("pageSize") pageSize: unknown,
  ) {
    const resolvedWarehouseId =
      parseOptionalString(warehouseId) ??
      (await ensureMainWarehouse(prisma)).id;
    return this.service.findVariantsMissingStockItem({
      warehouseId: resolvedWarehouseId,
      page: parsePage(page),
      pageSize: parsePageSize(pageSize),
    });
  }

  /// Walks every reconciliation page internally (bounded, see
  /// StockReconciliationService.summarize) and returns just the status
  /// counts - cheap enough to call synchronously from an admin dashboard
  /// without the client paginating through the full detail list itself.
  @Get("summary")
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  summary(
    @Query("variantId") variantId: unknown,
    @Query("warehouseId") warehouseId: unknown,
  ) {
    return this.service.summarize({
      variantId: parseOptionalString(variantId),
      warehouseId: parseOptionalString(warehouseId),
    });
  }
}
