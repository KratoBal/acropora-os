import { Controller, Get, Query } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { UnasOrderStockAuditService } from "./unas-order-stock-audit.service.js";

function parsePage(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parsePageSize(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
}

/// Read-only admin surface for the historical UNAS order audit - the
/// checkpoint-4 production-activation precondition (see
/// docs/INVENTORY-CONSISTENCY.md). Every route is a GET; nothing here ever
/// mutates a SalesOrder/StockMovement/ExternalReference row.
@Controller("orders/unas/stock-audit")
export class UnasOrderStockAuditController {
  constructor(private readonly service: UnasOrderStockAuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  page(@Query("page") page: unknown, @Query("pageSize") pageSize: unknown) {
    return this.service.auditPage({ page: parsePage(page), pageSize: parsePageSize(pageSize) });
  }

  @Get("anomalies")
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  anomalies() {
    return this.service.findAnomalies();
  }

  /// The actual go/no-go answer for "can we trust the checkpoint-4 delta
  /// engine against every already-imported order without a corrective
  /// backfill" - walks every order in bounded batches server-side (see
  /// UnasOrderStockAuditService.summarize).
  @Get("summary")
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  summary() {
    return this.service.summarize();
  }
}
