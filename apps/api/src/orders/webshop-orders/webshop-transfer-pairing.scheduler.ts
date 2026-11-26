import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import {
  WebshopTransferPairingService,
  transferPairingMode,
  type TransferPairingOutcome,
  type TransferPairingRun,
} from "./webshop-transfer-pairing.service.js";

/** The first round after the start (the modules and the database connection first). */
export const TRANSFER_PAIRING_START_DELAY_MS = 3 * 60_000;
/** Between two rounds: the bank lines come with the statement upload and the Számlázz.hu forwarding, minutes apart at best. */
export const TRANSFER_PAIRING_TICK_MS = 10 * 60_000;

/** One log line per outcome: the ids, amounts and days, never the narrative (it carries the customer's name). */
export const outcomeLine = (
  mode: TransferPairingRun["mode"],
  outcome: TransferPairingOutcome,
) => `WEBSHOP-PAROSITAS mode=${mode} ${JSON.stringify(outcome)}`;

/**
 * THE SCHEDULE OF THE LIVE BANK PAIRING (card d31a66a3, S5), after the repo's own pattern (`due-invoices-mail.scheduler.ts`): a start
 * delay, an unref'd interval, a guard against overlapping rounds, and a round's failure never leaves the scheduler. OFF unless
 * `WEBSHOP_TRANSFER_PAIRING_MODE` is `observe` or `write` (`transferPairingMode`), read once at the start.
 *
 * THE LOG IS THE OBSERVE MODE'S RESULT: every outcome (paired, review, and in write mode what was written) once, with the line
 * prefix `WEBSHOP-PAROSITAS`; the same outcome is not logged again in later rounds of the same process.
 */
@Injectable()
export class WebshopTransferPairingScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WebshopTransferPairingScheduler.name);
  private starter: NodeJS.Timeout | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly logged = new Set<string>();

  constructor(private readonly pairing: WebshopTransferPairingService) {}

  onModuleInit(): void {
    const mode = transferPairingMode();
    if (mode === "off") return;
    this.logger.log(`Webshop banki párosítás: ${mode} mód`);
    this.starter = setTimeout(() => {
      void this.tick(mode);
      this.timer = setInterval(
        () => void this.tick(mode),
        TRANSFER_PAIRING_TICK_MS,
      );
      this.timer.unref();
    }, TRANSFER_PAIRING_START_DELAY_MS);
    this.starter.unref();
  }

  onModuleDestroy(): void {
    if (this.starter) clearTimeout(this.starter);
    if (this.timer) clearInterval(this.timer);
  }

  /** One round, its new outcomes in the log; answers the lines it wrote (the test reads them). */
  async tick(mode: TransferPairingRun["mode"]): Promise<string[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const run = await this.pairing.runOnce(mode);
      const lines: string[] = [];
      for (const outcome of run.outcomes) {
        const line = outcomeLine(mode, outcome);
        if (this.logged.has(line)) continue;
        this.logged.add(line);
        lines.push(line);
      }
      if (lines.length)
        lines.push(
          `WEBSHOP-PAROSITAS mode=${mode} kor: celok=${run.targets} jovairasok=${run.credits} olvashatatlan=${run.unread} uj=${lines.length}`,
        );
      for (const line of lines) this.logger.log(line);
      return lines;
    } catch (error) {
      this.logger.error(
        `Webshop banki párosítás: a kör megállt (${error instanceof Error ? error.name : "UNKNOWN"})`,
      );
      return [];
    } finally {
      this.running = false;
    }
  }
}
