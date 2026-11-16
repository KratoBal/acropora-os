import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import {
  describeTicketMailIntake,
  ticketMailConfig,
} from "./ticket-mail.config.js";
import { TicketMailIntakeService } from "./ticket-mail-intake.service.js";

const STARTUP_DELAY_MS = 120_000;

/**
 * Runs the ticket@ intake on a timer when it is on, and says so in ONE log line at start either way (the same reason as the Cápasuli pull's:
 * silence while off hides a pull that is not running). Off by default.
 */
@Injectable()
export class TicketMailIntakeScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TicketMailIntakeScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly intake: TicketMailIntakeService) {}

  onModuleInit(): void {
    const c = ticketMailConfig();
    this.logger.log(describeTicketMailIntake(c));
    if (!c.enabled) return;
    this.schedule(STARTUP_DELAY_MS, c.intervalMinutes * 60_000);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<"APPLIED" | "SKIPPED" | "FAILED"> {
    try {
      await this.intake.run();
      return "APPLIED";
    } catch (error) {
      if (
        error instanceof ConflictException &&
        error.message === "TICKET_MAIL_ALREADY_RUNNING"
      ) {
        this.logger.log("Ticket mailbox run skipped: another run is active");
        return "SKIPPED";
      }
      this.logger.error(
        `Scheduled ticket mailbox run failed: ${
          error instanceof Error &&
          /^TICKET_MAIL_[A-Z0-9_]+$/.test(error.message)
            ? error.message
            : "TICKET_MAIL_SCHEDULED_FAILED"
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
