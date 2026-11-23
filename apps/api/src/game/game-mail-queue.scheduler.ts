import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { GameAdminService } from "./game-admin.service.js";

/**
 * Every 15 minutes, the first one minute after start. A confirmation counts only while its question is open, so a mail left in
 * the queue at closing is an entry lost: the last run is at most 15 minutes before the close, and a new Budapest day (a new
 * cap) is picked up within 15 minutes.
 */
export const GAME_MAIL_QUEUE_INTERVAL_MS = 15 * 60_000;
export const GAME_MAIL_QUEUE_STARTUP_DELAY_MS = 60_000;

/** JATEK_MAIL_QUEUE_AUTO=off: the queue waits for the admin button, as before. Anything else: the scheduled drain runs. */
export const gameMailQueueAuto = (environment: NodeJS.ProcessEnv) =>
  environment.JATEK_MAIL_QUEUE_AUTO?.trim().toLowerCase() !== "off";

/**
 * THE MAIL QUEUE DRAINED WITHOUT A PERSON (card 31445d0f, acrobot 58457, 58458: operations, not Balázs's decision). The
 * confirmation mails past the day's cap wait in the queue (`mailPendingSince`) until someone presses "send" on the admin
 * page; an entry whose mail still waits at closing never gets into the draw. This sends them on its own, within the cap, with
 * the same send as the button (`GameAdminService.sendQueued`, one at a time, audited without a user). ON by default, like the
 * erasure: a switch that has to be turned on is a promise that can be forgotten.
 */
@Injectable()
export class GameMailQueueScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GameMailQueueScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  environment: NodeJS.ProcessEnv = process.env;

  constructor(private readonly admin: GameAdminService) {}

  onModuleInit(): void {
    if (!gameMailQueueAuto(this.environment)) {
      this.logger.log(
        "Game mail queue drain is off (JATEK_MAIL_QUEUE_AUTO=off)",
      );
      return;
    }
    this.logger.log(
      `Game mail queue drain scheduled every ${GAME_MAIL_QUEUE_INTERVAL_MS / 60_000} min`,
    );
    this.schedule(GAME_MAIL_QUEUE_STARTUP_DELAY_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** One drain: nothing to do when nothing waits; else the shared send. Counts only in the log, never an address. */
  async runOnce(): Promise<"IDLE" | "SENT" | "BUSY" | "FAILED"> {
    try {
      const queue = await this.admin.mailQueue();
      if (queue.pending === 0) return "IDLE";
      const result = await this.admin.sendQueued(null);
      if (result.busy) return "BUSY";
      this.logger.log(
        `Game mail queue: ${result.sent} sent, ${result.pending} still waiting (today ${result.sentToday}/${result.dailyCap})`,
      );
      return "SENT";
    } catch (error) {
      // the next run tries again. Only the kind and the code: a database or mail error can quote an address
      const code =
        error instanceof Error && "code" in error
          ? ` ${String(error.code)}`
          : "";
      this.logger.error(
        `Game mail queue drain failed: ${error instanceof Error ? error.name : "UNKNOWN"}${code}`,
      );
      return "FAILED";
    }
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => {
        if (!this.stopped) this.schedule(GAME_MAIL_QUEUE_INTERVAL_MS);
      });
    }, delayMs);
    this.timer.unref();
  }
}
