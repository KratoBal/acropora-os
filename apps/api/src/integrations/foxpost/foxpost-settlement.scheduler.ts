import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { FoxpostSettlementService } from "./foxpost-settlement.service.js";

export interface FoxpostSettlementScheduleConfig {
  enabled: boolean;
  intervalMs: number;
  startupDelayMs: number;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  code: string,
): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(code);
  return parsed;
}

export function foxpostSettlementScheduleConfig(
  environment: NodeJS.ProcessEnv = process.env,
): FoxpostSettlementScheduleConfig {
  const enabled = environment.GMAIL_FOXPOST_SYNC_ENABLED === "true";
  if (!enabled) return { enabled: false, intervalMs: 0, startupDelayMs: 0 };
  return {
    enabled: true,
    intervalMs:
      boundedInteger(
        environment.GMAIL_FOXPOST_SYNC_INTERVAL_MINUTES,
        60,
        5,
        1440,
        "FOXPOST_SYNC_INTERVAL_INVALID",
      ) * 60_000,
    startupDelayMs:
      boundedInteger(
        environment.GMAIL_FOXPOST_SYNC_STARTUP_DELAY_SECONDS,
        60,
        0,
        3600,
        "FOXPOST_SYNC_STARTUP_DELAY_INVALID",
      ) * 1000,
  };
}

@Injectable()
export class FoxpostSettlementScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(FoxpostSettlementScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly settlements: FoxpostSettlementService) {}

  onModuleInit(): void {
    const config = foxpostSettlementScheduleConfig();
    if (!config.enabled) return;
    this.logger.log(
      `Foxpost Gmail scheduler enabled (${config.intervalMs / 60_000} min)`,
    );
    this.schedule(config.startupDelayMs, config.intervalMs);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<"APPLIED" | "SKIPPED" | "FAILED"> {
    try {
      await this.settlements.sync();
      return "APPLIED";
    } catch (error) {
      if (
        error instanceof ConflictException &&
        error.message === "FOXPOST_GMAIL_SYNC_ALREADY_RUNNING"
      ) {
        this.logger.log("Foxpost Gmail sync skipped: another run is active");
        return "SKIPPED";
      }
      this.logger.error(
        `Scheduled Foxpost Gmail sync failed: ${
          error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
            ? error.message
            : "FOXPOST_GMAIL_SYNC_SCHEDULED_FAILED"
        }`,
      );
      return "FAILED";
    }
  }

  private schedule(delayMs: number, intervalMs: number): void {
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => {
        if (!this.stopped) this.schedule(intervalMs, intervalMs);
      });
    }, delayMs);
    this.timer.unref();
  }
}
