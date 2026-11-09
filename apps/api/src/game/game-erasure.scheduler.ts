import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { GameErasureService } from "./game-erasure.service.js";

/** Every six hours, the first two minutes after start: a due erasure lands within hours, well inside the 15 days. */
export const GAME_ERASE_INTERVAL_MS = 6 * 60 * 60_000;
export const GAME_ERASE_STARTUP_DELAY_MS = 2 * 60_000;

/** JATEK_ERASE_DRY_RUN=on: the scheduled run only counts and logs, it writes nothing. */
export const gameEraseDryRun = (environment: NodeJS.ProcessEnv) =>
  environment.JATEK_ERASE_DRY_RUN?.trim().toLowerCase() === "on";

/**
 * THE PROMISE KEPT WITHOUT A PERSON (card bc0ca668): the erasure runs on its own, ON by default, because a switch that
 * has to be turned on is a promise that can be forgotten. Before the grand prize draw, and until its days have passed,
 * a run reads and writes nothing; after, it erases once, and every later run finds nothing left.
 */
@Injectable()
export class GameErasureScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GameErasureScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  environment: NodeJS.ProcessEnv = process.env;

  constructor(private readonly erasure: GameErasureService) {}

  onModuleInit(): void {
    this.logger.log(
      `Game data erasure scheduled every ${GAME_ERASE_INTERVAL_MS / 3_600_000} h${
        gameEraseDryRun(this.environment)
          ? " (dry run: JATEK_ERASE_DRY_RUN=on)"
          : ""
      }`,
    );
    this.schedule(GAME_ERASE_STARTUP_DELAY_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<"DONE" | "FAILED"> {
    const dryRun = gameEraseDryRun(this.environment);
    // the data and the sent mails (card jatek-level-torles) each on its own: one failing does not stop the other
    const data = await this.attempt("Game data erasure", () =>
      this.erasure.run({ dryRun }),
    );
    const mail = await this.attempt("Game mail erasure", () =>
      this.erasure.eraseMail({ dryRun }),
    );
    return data && mail ? "DONE" : "FAILED";
  }

  private async attempt(
    what: string,
    step: () => Promise<unknown>,
  ): Promise<boolean> {
    try {
      await step();
      return true;
    } catch (error) {
      // the next run tries again: both are idempotent. Only the kind and the code go to the log: a database error's
      // message can quote the write, and the write carries a winner's address
      const code =
        error instanceof Error && "code" in error
          ? ` ${String(error.code)}`
          : "";
      this.logger.error(
        `${what} failed: ${error instanceof Error ? error.name : "UNKNOWN"}${code}`,
      );
      return false;
    }
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => {
        if (!this.stopped) this.schedule(GAME_ERASE_INTERVAL_MS);
      });
    }, delayMs);
    this.timer.unref();
  }
}
