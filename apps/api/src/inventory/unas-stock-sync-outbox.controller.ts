import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
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

/** A lap mérete: alapból 50, legfeljebb 200 (a régi viselkedés). */
export function parseLimit(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, 200)
    : 50;
}

/**
 * A LAPOZÁS KEZDETE (Picasso 3.27, acrobot 62278): a lista eddig csak a legutóbbi `limit` sort adta. Az `offset` nem negatív egész; ami nem az (hiányzik, szöveg, tört, negatív), nulla, vagyis az
 * első oldal, nem hiba: egy régi vagy kézzel írt cím ne törje el a listát. A felső korlát megakadályozza, hogy egy óriási érték a szerverre nagy `skip`-et terheljen.
 */
export const MAX_OUTBOX_OFFSET = 1_000_000;
export function parseOffset(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_OUTBOX_OFFSET)
    : 0;
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
  list(
    @Query("status") status: unknown,
    @Query("limit") limit: unknown,
    @Query("offset") offset: unknown,
  ) {
    return this.repository.list({
      status: parseStatus(status),
      limit: parseLimit(limit),
      offset: parseOffset(offset),
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
