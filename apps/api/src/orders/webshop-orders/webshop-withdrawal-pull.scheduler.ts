import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { boundedMinutes } from "./webshop-problem-report-pull.scheduler.js";
import { WebshopWithdrawalPullService } from "./webshop-withdrawal-pull.service.js";
import { describeWithdrawalPull } from "./webshop-withdrawal-pull.js";

/**
 * THE SCHEDULE OF THE WITHDRAWAL PULL (V0.3), the problem report pull's pattern. OFF BY DEFAULT:
 * `WEBSHOP_WITHDRAWAL_PULL_ENABLED=true`, EXACTLY that, so an OS deployed before the shop knows the endpoint asks
 * for nothing. Every ten minutes by default; the interval is bounded.
 */
export interface WithdrawalPullConfig {
  enabled: boolean;
  intervalMs: number;
  startupDelayMs: number;
}

export function withdrawalPullConfig(
  env: NodeJS.ProcessEnv = process.env,
): WithdrawalPullConfig {
  if (env.WEBSHOP_WITHDRAWAL_PULL_ENABLED !== "true")
    return { enabled: false, intervalMs: 0, startupDelayMs: 0 };
  return {
    enabled: true,
    intervalMs:
      boundedMinutes(
        env.WEBSHOP_WITHDRAWAL_PULL_INTERVAL_MINUTES,
        10,
        5,
        1440,
        "WEBSHOP_WITHDRAWAL_PULL_INTERVAL_INVALID",
      ) * 60_000,
    startupDelayMs:
      boundedMinutes(
        env.WEBSHOP_WITHDRAWAL_PULL_STARTUP_DELAY_MINUTES,
        2,
        0,
        240,
        "WEBSHOP_WITHDRAWAL_PULL_STARTUP_DELAY_INVALID",
      ) * 60_000,
  };
}

@Injectable()
export class WebshopWithdrawalPullScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WebshopWithdrawalPullScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private running = false;

  constructor(private readonly service: WebshopWithdrawalPullService) {}

  onModuleInit(): void {
    const config = withdrawalPullConfig();
    if (!config.enabled) return;
    this.schedule(config.startupDelayMs, config.intervalMs);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** One run; a run that is still going is not started twice. Returns the log text ("" when nothing to say). */
  async runOnce(): Promise<string> {
    if (this.running) return "";
    this.running = true;
    try {
      const report = await this.service.run();
      const text = describeWithdrawalPull(report);
      // a declaration left waiting for want of an assignee is a WARNING, every round
      if (text)
        report.assigneeProblem ? this.logger.warn(text) : this.logger.log(text);
      return text;
    } finally {
      this.running = false;
    }
  }

  private schedule(delayMs: number, intervalMs: number): void {
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch((error) => {
          this.logger.error(
            `Scheduled withdrawal pull failed: ${
              error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
                ? error.message
                : "WEBSHOP_WITHDRAWAL_PULL_FAILED"
            }`,
          );
        })
        .finally(() => {
          if (!this.stopped) this.schedule(intervalMs, intervalMs);
        });
    }, delayMs);
    this.timer.unref();
  }
}
