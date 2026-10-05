import {
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from "@nestjs/common";
import { CashRegisterService, opgErrorCode } from "./cash-register.service.js";
export function opgScheduleConfig(env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.NAV_CASH_REGISTER_SYNC_ENABLED === "true";
  const minutes = Number(env.NAV_CASH_REGISTER_SYNC_INTERVAL_MINUTES ?? 1440);
  if (enabled && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440))
    throw new Error("NAV_CASH_REGISTER_SYNC_INTERVAL_MINUTES_INVALID");
  return { enabled, intervalMs: minutes * 60000 };
}
@Injectable()
export class CashRegisterScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CashRegisterScheduler.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  constructor(private readonly service: CashRegisterService) {}
  onModuleInit() {
    const config = opgScheduleConfig();
    if (config.enabled) this.schedule(30000, config.intervalMs);
  }
  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
  private schedule(delay: number, interval: number) {
    this.timer = setTimeout(() => {
      void this.tick(interval);
    }, delay);
    this.timer.unref();
  }
  private async tick(interval: number) {
    try {
      const counts = await this.service.sync();
      this.logger.log(
        `OPG_SYNC_OK files=${counts.filesFetched} receipts=${counts.receiptsCreated} gaps=${counts.gapsRecorded}`,
      );
    } catch (e) {
      this.logger.warn(opgErrorCode(e));
    } finally {
      if (!this.stopped) this.schedule(interval, interval);
    }
  }
}
