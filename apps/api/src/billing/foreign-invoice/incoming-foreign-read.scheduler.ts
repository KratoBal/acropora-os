import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { IncomingReviewService } from "./incoming-review.service.js";

const STARTUP_DELAY_MS = 240_000;

export interface ForeignReadSettings {
  on: boolean;
  intervalMinutes: number;
  since: string | null;
}

/**
 * A KAPCSOLÓ, KI, AMÍG NINCS `true` (kártya e4c3b0fb). A kinyerés csak a még
 * nem olvasott postafiókos sorokat olvassa, „Ellenőrizendő” állapotba; a
 * könyvelőhöz ebből jóváhagyás nélkül egy szám sem megy. Élesen Balázs
 * szavára kapcsolódik be.
 */
export function foreignReadSettings(
  env: NodeJS.ProcessEnv = process.env,
): ForeignReadSettings {
  const interval = Number(env.INCOMING_FOREIGN_READ_INTERVAL_MINUTES);
  const since = env.INCOMING_FOREIGN_READ_SINCE?.trim() ?? "";
  return {
    on: env.INCOMING_FOREIGN_READ_ENABLED?.trim().toLowerCase() === "true",
    intervalMinutes:
      Number.isInteger(interval) && interval >= 5 ? interval : 60,
    since: /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : null,
  };
}

/**
 * A POSTAFIÓKOS SZÁMLÁK KINYERÉSÉNEK IDŐZÍTŐJE. Ugyanaz a minta, mint a
 * számla-begyűjtésé (`invoice-collection.scheduler.ts`): induláskor egy sor
 * arról, fut-e, utána egy időzítő, ami minden futás után újraütemezi magát.
 */
@Injectable()
export class IncomingForeignReadScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(IncomingForeignReadScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private settings: ForeignReadSettings = foreignReadSettings({});

  constructor(private readonly reviews: IncomingReviewService) {}

  onModuleInit(): void {
    this.settings = foreignReadSettings();
    this.logger.log(
      this.settings.on
        ? `Foreign invoice reading on: every ${this.settings.intervalMinutes} min${
            this.settings.since ? `, since ${this.settings.since}` : ""
          }`
        : "Foreign invoice reading off (INCOMING_FOREIGN_READ_ENABLED is not true)",
    );
    if (!this.settings.on) return;
    this.schedule(STARTUP_DELAY_MS, this.settings.intervalMinutes * 60_000);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<"APPLIED" | "FAILED"> {
    try {
      const report = await this.reviews.readPending({
        apply: true,
        since: this.settings.since,
      });
      if (report.written)
        this.logger.log(`Foreign invoice reading: ${report.written} new`);
      return "APPLIED";
    } catch (error) {
      // a hibaüzenet számla-adatot hordozhat, ezért csak a fajtája megy a naplóba
      this.logger.error(
        `Foreign invoice reading failed: ${
          error instanceof Error ? error.name : "UNKNOWN"
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
