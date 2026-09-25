import { Injectable } from "@nestjs/common";
import {
  hasPermission,
  PERMISSIONS,
  type AuthenticatedUser,
  type DashboardInventoryDiscrepancies,
  type DashboardSummary,
} from "@acropora/types";

import { partnerScopeOf } from "../auth/partner-scope.util.js";
import { StockReconciliationService } from "../inventory/stock-reconciliation.service.js";
import type { ReconciliationStatus } from "../inventory/stock-reconciliation.types.js";
import { DashboardRepository } from "./dashboard.repository.js";

const DISCREPANCY_STATUSES: ReadonlySet<ReconciliationStatus> = new Set([
  "LOCAL_LEDGER_MISMATCH",
  "UNAS_MISMATCH_NO_PENDING_SYNC",
  "SYNC_FAILED",
  "PROCESSING_LEASE_EXPIRED",
  "MISSING_STOCK_ITEM",
  "INVALID_LEDGER_DATA",
]);

@Injectable()
export class DashboardService {
  constructor(
    private readonly repository: DashboardRepository,
    private readonly reconciliation: StockReconciliationService,
  ) {}

  async summary(user: AuthenticatedUser): Promise<DashboardSummary> {
    const result: DashboardSummary = {};
    const scope = partnerScopeOf(user);
    const serviceVisible = hasPermission(user, PERMISSIONS.SERVICE_VIEW);
    const serviceManaged = hasPermission(user, PERMISSIONS.SERVICE_MANAGE);
    const assignedUnitIds =
      serviceVisible || serviceManaged
        ? await this.repository.assignedUnitIds(user.id)
        : [];

    if (serviceVisible) {
      [result.myWorksheets, result.openTickets] = await Promise.all([
        this.repository.myWorksheets({
          userId: user.id,
          scope,
          assignedUnitIds,
        }),
        this.repository.openTickets({
          userId: user.id,
          scope,
          assignedUnitIds,
        }),
      ]);
    }
    if (hasPermission(user, PERMISSIONS.AQUARIUMS_VIEW))
      result.aquariumAlerts = await this.repository.aquariumAlerts(new Date());

    if (serviceManaged) {
      [result.managerTiles, result.deadlines, result.teamLoad] =
        await Promise.all([
          this.repository.managerTiles(),
          this.repository.deadlines(new Date()),
          this.repository.teamLoad(),
        ]);
      if (await this.repository.hasMaterialRequestCapability(user.id))
        result.materialRequests = await this.repository.materialRequests();
      result.activity = await this.repository.activity();
    }
    if (hasPermission(user, PERMISSIONS.PURCHASING_VIEW))
      result.purchasing = await this.repository.purchasing();
    if (hasPermission(user, PERMISSIONS.INVENTORY_VIEW))
      result.inventoryDiscrepancies = await this.inventoryDiscrepancies();
    if (hasPermission(user, PERMISSIONS.TASKS_VIEW))
      result.myTaskCount = await this.repository.taskCount(user.id);

    return result;
  }

  private async inventoryDiscrepancies(): Promise<DashboardInventoryDiscrepancies> {
    const [summary, page] = await Promise.all([
      this.reconciliation.summarize({}),
      this.reconciliation.reconcilePage({ page: 1, pageSize: 200 }),
    ]);
    const items = page.items.filter((item) =>
      DISCREPANCY_STATUSES.has(item.status),
    );
    return {
      count: [...DISCREPANCY_STATUSES].reduce(
        (total, status) => total + summary.byStatus[status],
        0,
      ),
      items: items.slice(0, 5).map((item) => ({
        variantId: item.variantId,
        sku: item.sku,
        warehouseCode: item.warehouseCode,
        status: item.status,
      })),
    };
  }
}
