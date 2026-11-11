import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { AI_CHAT_SETTINGS_LIMITS } from "@acropora/types";

import { AiChatSettingsService } from "../ai-chat-settings/ai-chat-settings.service.js";
import { AiContactRequestsRepository } from "./ai-contact-requests.repository.js";

/** The sweep runs every six hours, and once five minutes after the start. The delete is idempotent, so a late or repeated run costs nothing. */
export const CONTACT_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const CONTACT_RETENTION_FIRST_RUN_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ContactRetentionResult =
  | { ran: true; handled: number; unhandled: number }
  | { ran: false; reason: "invalid_days" };

/**
 * THE RETENTION OF THE CONTACT REQUESTS (card f5b8f7ba, plan section 2 point 4; the days are the settings', approved 2026-11-11 11:38:
 * handled 30, unhandled at most 90). A customer's telephone number or address must not stay for ever, and this job is the reason the
 * contact request may be switched on at all (barracuda's condition on the record's PR).
 *
 * THE DAYS COME FROM THE OS'S OWN SETTINGS ROW (the database, no network), read at every run. A value the job does not trust MAKES IT
 * SKIP, NEVER GUESS: days that are not whole numbers inside the settings' own limits (7 to 180, or the unhandled shorter than the
 * handled) skip the run and log `invalid_days`; nothing is clamped (a clamped 1000 would delete what the owner asked to keep). The
 * save path refuses such values, so this is the belt for a row edited by hand.
 *
 * NOTHING BUT NUMBERS IS LOGGED: how many were removed, never a value or an id.
 */
@Injectable()
export class AiContactRequestsRetention
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AiContactRequestsRetention.name);
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;

  constructor(
    private readonly repository: AiContactRequestsRepository,
    private readonly settings: AiChatSettingsService,
  ) {}

  onModuleInit(): void {
    const run = () =>
      void this.sweep(new Date()).catch((error: unknown) =>
        // the error's NAME only: a database message can quote a row
        this.logger.warn(
          `contact_retention_failed error=${(error as Error)?.name ?? "unknown"}`,
        ),
      );
    this.first = setTimeout(run, CONTACT_RETENTION_FIRST_RUN_MS);
    this.first.unref();
    this.timer = setInterval(run, CONTACT_RETENTION_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
    this.first = null;
    this.timer = null;
  }

  /** One run at `now`. */
  async sweep(now: Date): Promise<ContactRetentionResult> {
    const {
      contactHandledRetentionDays: handled,
      contactUnhandledRetentionDays: unhandled,
    } = await this.settings.settings();
    const { min, max } = AI_CHAT_SETTINGS_LIMITS.contactRetentionDays;
    const whole = (value: unknown): value is number =>
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= min &&
      value <= max;
    if (!whole(handled) || !whole(unhandled) || unhandled < handled) {
      this.logger.warn("contact_retention_skipped reason=invalid_days");
      return { ran: false, reason: "invalid_days" };
    }
    const removed = await this.repository.purge(
      new Date(now.getTime() - handled * DAY_MS),
      new Date(now.getTime() - unhandled * DAY_MS),
    );
    this.logger.log(
      `contact_retention handledDays=${handled} unhandledDays=${unhandled} removedHandled=${removed.handled} removedUnhandled=${removed.unhandled}`,
    );
    return { ran: true, ...removed };
  }
}
