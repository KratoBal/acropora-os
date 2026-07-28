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
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/// Read-only admin diagnostics surface for the stock-reconciliation module.
/// Every route here is a GET - no mutation exists yet (see
/// docs/INVENTORY-CONSISTENCY.md's reconciliation section, "Biztonságos
/// javítási terv", for why the mutating repair endpoint was deliberately
/// deferred rather than half-built this checkpoint). Gated on
/// INVENTORY_VIEW like every other read-only inventory endpoint in this
/// codebase (unas-stock-sync-outbox.controller.ts, inventory-count.controller.ts).
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
      parseOptionalString(warehouseId) ?? (await ensureMainWarehouse(prisma)).id;
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
