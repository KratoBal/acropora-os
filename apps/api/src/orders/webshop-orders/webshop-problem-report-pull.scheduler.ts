import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { WebshopProblemReportPullService } from "./webshop-problem-report-pull.service.js";
import { describePullReport } from "./webshop-problem-report-pull.js";

/**
 * THE SCHEDULE OF THE PROBLEM REPORT PULL (V1.2). The repo's own pattern (a Nest service, a chained
 * `setTimeout`, an unref'd timer, an environment switch and a separate `runOnce`). OFF BY DEFAULT:
 * `WEBSHOP_COMPLAINT_PULL_ENABLED=true`, EXACTLY that. Every ten minutes by default (a customer who filed a
 * report about a live animal should not wait hours for the staff to see it); the interval is bounded.
 */
export interface ProblemReportPullConfig {
  enabled: boolean;
  intervalMs: number;
  startupDelayMs: number;
}

export const boundedMinutes = (
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  code: string,
): number => {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(code);
  return parsed;
};

export function problemReportPullConfig(
  env: NodeJS.ProcessEnv = process.env,
): ProblemReportPullConfig {
  if (env.WEBSHOP_COMPLAINT_PULL_ENABLED !== "true")
    return { enabled: false, intervalMs: 0, startupDelayMs: 0 };
  return {
    enabled: true,
    intervalMs:
      boundedMinutes(
        env.WEBSHOP_COMPLAINT_PULL_INTERVAL_MINUTES,
        10,
        5,
        1440,
        "WEBSHOP_COMPLAINT_PULL_INTERVAL_INVALID",
      ) * 60_000,
    startupDelayMs:
      boundedMinutes(
        env.WEBSHOP_COMPLAINT_PULL_STARTUP_DELAY_MINUTES,
        2,
        0,
        240,
        "WEBSHOP_COMPLAINT_PULL_STARTUP_DELAY_INVALID",
      ) * 60_000,
  };
}

@Injectable()
export class WebshopProblemReportPullScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WebshopProblemReportPullScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private running = false;

  constructor(private readonly service: WebshopProblemReportPullService) {}

  onModuleInit(): void {
    const config = problemReportPullConfig();
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
      const text = describePullReport(report);
      // a report left waiting for want of an assignee is a WARNING, every round
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
            `Scheduled problem report pull failed: ${
              error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
                ? error.message
                : "WEBSHOP_COMPLAINT_PULL_FAILED"
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
