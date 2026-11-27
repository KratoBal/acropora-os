import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { scheduleSwitchOn } from "../../billing/external-invoice-pdf.scheduler.js";
import { SimplePaySettlementService } from "./simplepay-settlement.service.js";

/**
 * THE OPEN SIMPLEPAY LINES, RE-DECIDED EVERY HOUR (Balázs 2026-11-27 09:25 UTC, OS thread: "ez miért van???? van számlája szerintem
 * mindnek"). Three November card payments said "A rendelésnek még nincs számlája": their report was read in before the webshop
 * invoices were tied to the orders (the UNAS order sync wrote them on 11-20), and a line is decided only when its report comes in,
 * or when someone presses "Újrafeldolgozás". This runs that reprocess for every report with an open line, once an hour, with the
 * same rules (a person's decision is kept). Local data only: no Számlázz.hu, Gmail or SimplePay call.
 *
 * ON by default, off with `SIMPLEPAY_REPROCESS_SCHEDULE=0` (or false, off, no), read once at the start; one log line at the start
 * either way, and one per run that resolved something or failed. A run's failure stays inside the run.
 */
export const SIMPLEPAY_REPROCESS_START_DELAY_MS = 5 * 60_000;
export const SIMPLEPAY_REPROCESS_INTERVAL_MS = 60 * 60_000;

/** The environment; a spec gives its own through this token. */
export const SIMPLEPAY_REPROCESS_ENV = Symbol("SIMPLEPAY_REPROCESS_ENV");

export function simplePayReprocessScheduleOn(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return scheduleSwitchOn(env.SIMPLEPAY_REPROCESS_SCHEDULE);
}

@Injectable()
export class SimplePayOpenLinesScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SimplePayOpenLinesScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private running = false;

  constructor(
    private readonly settlements: SimplePaySettlementService,
    @Optional()
    @Inject(SIMPLEPAY_REPROCESS_ENV)
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  onModuleInit(): void {
    if (!simplePayReprocessScheduleOn(this.env)) {
      this.logger.log(
        "SimplePay nyitott sorok újradöntése: KI (SIMPLEPAY_REPROCESS_SCHEDULE).",
      );
      return;
    }
    this.logger.log(
      "SimplePay nyitott sorok újradöntése: óránként, minden kimutatás nyitott sorai.",
    );
    this.schedule(SIMPLEPAY_REPROCESS_START_DELAY_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** One run; never throws. Answers what it did, for the spec. */
  async runOnce(): Promise<
    | { status: "RAN"; reports: number; resolved: number }
    | { status: "SKIPPED" | "FAILED" }
  > {
    if (this.running) return { status: "SKIPPED" };
    this.running = true;
    try {
      const { reports, resolved } = await this.settlements.reprocessOpen();
      if (resolved > 0)
        this.logger.log(
          `SimplePay nyitott sorok újradöntése: ${reports} kimutatás, ${resolved} sor rendeződött.`,
        );
      return { status: "RAN", reports, resolved };
    } catch (error) {
      this.logger.error(
        `SimplePay nyitott sorok újradöntése: a kör megállt (${error instanceof Error ? error.name : "UNKNOWN"}).`,
      );
      return { status: "FAILED" };
    } finally {
      this.running = false;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() =>
        this.schedule(SIMPLEPAY_REPROCESS_INTERVAL_MS),
      );
    }, delayMs);
    this.timer.unref();
  }
}
