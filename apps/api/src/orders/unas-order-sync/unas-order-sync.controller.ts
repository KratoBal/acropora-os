import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { UnasAuthService } from "../../imports/unas/unas-auth.service.js";
import { UnasOrderListQueryDto } from "./dto/unas-order-list-query.dto.js";
import { UnasOrderSyncRunsQueryDto } from "./dto/unas-order-sync-runs-query.dto.js";
import { unasOrderDeletionReconciliationConfig } from "./unas-order-deletion-reconciliation.service.js";
import { UnasOrderDeletionReconciliationScheduler } from "./unas-order-deletion-reconciliation.scheduler.js";
import { UnasOrderSyncRepository } from "./unas-order-sync.repository.js";
import { UnasOrderSyncService } from "./unas-order-sync.service.js";

@Controller("integrations/unas/orders")
export class UnasOrderSyncController {
  constructor(
    private readonly auth: UnasAuthService,
    private readonly sync: UnasOrderSyncService,
    private readonly repository: UnasOrderSyncRepository,
    private readonly deletionReconciliationScheduler: UnasOrderDeletionReconciliationScheduler,
  ) {}

  @Post("sync")
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  async run() {
    const token = await this.auth.getToken();
    return this.sync.runIncremental(token);
  }

  // Manual single-order refresh ("Rendelés frissítése" a rendelés
  // részletező oldalon) - same permission as the general sync trigger, not
  // ORDERS_VIEW, since this actively mutates order/invoice/stock state.
  // Fetches only this order from UNAS by its own Key; never a
  // time-window/general sync, and never touches the incremental sync
  // cursor - see UnasOrderSyncService.refreshOrder().
  @Post(":id/refresh")
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  async refresh(@Param("id") id: string) {
    const token = await this.auth.getToken();
    return this.sync.refreshOrder(token, id);
  }

  @Get("sync-runs/:runId")
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  getRun(@Param("runId") runId: string) {
    return this.repository.getRun(runId);
  }

  @Get("sync-runs")
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  listRuns(@Query() query: UnasOrderSyncRunsQueryDto) {
    return this.repository.listRuns(query.limit);
  }

  @Get("stock/reconciliation")
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  checkStockReconciliation() {
    return this.sync.checkStockReconciliation();
  }

  // Read-only status for the (by default disabled - see business rule 6)
  // automatic deletion-reconciliation worker: whether it's enabled and at
  // what interval, so the admin surface can show this honestly instead of
  // silently implying it always runs.
  @Get("deletion-reconciliation/status")
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  deletionReconciliationStatus() {
    const config = unasOrderDeletionReconciliationConfig();
    return {
      enabled: config.enabled,
      intervalMs: config.enabled ? config.intervalMs : null,
      batchSize: config.enabled ? config.batchSize : null,
    };
  }

  // Manually trigger one deletion-reconciliation batch now, without
  // waiting for the scheduler's own interval - same code path the
  // scheduler itself calls (mirrors UnasStockSyncOutboxController's own
  // "run" endpoint), so there is no separate, less-tested admin-trigger
  // behavior. Still a no-op (returns "DISABLED") while the feature flag is
  // off - this endpoint does not itself enable anything.
  @Post("deletion-reconciliation/run")
  @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  runDeletionReconciliation() {
    return this.deletionReconciliationScheduler.runOnce();
  }

  @Get()
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  list(@Query() query: UnasOrderListQueryDto) {
    return this.repository.list(query);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  async getOne(@Param("id") id: string) {
    const order = await this.repository.findById(id);
    if (!order) throw new NotFoundException("A rendelés nem található.");
    return order;
  }
}
