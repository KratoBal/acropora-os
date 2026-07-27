import { Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { unasStockSyncWorkerConfig } from "./unas-stock-sync-outbox.service.js";
import { UnasStockSyncOutboxScheduler } from "./unas-stock-sync-outbox.scheduler.js";
import {
  UnasStockSyncOutboxRepository,
  type UnasStockSyncOutboxStatus,
} from "./unas-stock-sync-outbox.repository.js";

const VALID_STATUSES: readonly UnasStockSyncOutboxStatus[] = [
  "PENDING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "DEAD_LETTER",
];

function parseStatus(value: unknown): UnasStockSyncOutboxStatus | undefined {
  if (typeof value !== "string") return undefined;
  return VALID_STATUSES.includes(value as UnasStockSyncOutboxStatus)
    ? (value as UnasStockSyncOutboxStatus)
    : undefined;
}

@Controller("integrations/unas/stock-sync/outbox")
export class UnasStockSyncOutboxController {
  constructor(
    private readonly repository: UnasStockSyncOutboxRepository,
    private readonly scheduler: UnasStockSyncOutboxScheduler,
  ) {}

  @Get("summary")
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  async summary() {
    const config = unasStockSyncWorkerConfig();
    const [counts, lastSuccessfulPublishAt] = await Promise.all([
      this.repository.countsByStatus(),
      this.repository.lastSuccessfulPublishAt(),
    ]);
    return {
      workerEnabled: config.enabled,
      intervalMs: config.enabled ? config.intervalMs : null,
      counts,
      lastSuccessfulPublishAt,
    };
  }

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  list(@Query("status") status: unknown, @Query("limit") limit: unknown) {
    const parsedLimit = Number(limit);
    return this.repository.list({
      status: parseStatus(status),
      limit:
        Number.isSafeInteger(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, 200)
          : 50,
    });
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  async getOne(@Param("id") id: string) {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException("A sor nem található.");
    return row;
  }

  // Admin-triggered manual retry for a FAILED/DEAD_LETTER row - see
  // UnasStockSyncOutboxRepository.manualRetry doc comment for why it's
  // safe to call repeatedly. INVENTORY_MANAGE (not VIEW), since this
  // actively re-schedules a write to UNAS.
  @Post(":id/retry")
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  retry(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.repository.manualRetry(id, user.id);
  }

  // Manually trigger one batch now, without waiting for the scheduler's
  // own interval - same code path the scheduler itself calls
  // (UnasStockSyncOutboxScheduler.runOnce -> ...Service.processBatch), so
  // there is no separate, less-tested "admin trigger" behavior.
  @Post("run")
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  run() {
    return this.scheduler.runOnce();
  }
}
