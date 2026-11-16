import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { NotificationsService } from "../../notifications/notifications.service.js";
import { ServiceJobsRepository } from "../../service-jobs/service-jobs.repository.js";

import { TicketMailGmailClient } from "./ticket-mail-gmail.client.js";
import {
  describeTicketMailIntake,
  ticketMailConfig,
} from "./ticket-mail.config.js";
import {
  announcesArrival,
  decideIntake,
  draftContentOf,
} from "./ticket-mail-intake.js";
import { authenticationVerdict, skipReason } from "./ticket-mail-message.js";
import { TicketMailRepository } from "./ticket-mail.repository.js";

export interface TicketMailRunSummary {
  /** The switch was off or the credentials missing: nothing was read. */
  disabled: boolean;
  /** Ids the query matched that were already recorded. */
  alreadySeen: number;
  drafts: number;
  /** A machine's mail (own address, no-reply, Auto-Submitted, bulk, list): recorded, not listed. */
  skipped: number;
  /** An unknown sender over the hourly guard: recorded, not listed. */
  capped: number;
  /** A message that could not be read or recorded: left unrecorded, so the next run retries it. */
  failed: number;
  /** New messages left for the next run because of the per-run limit. */
  deferred: number;
  /** How many managers the arrival push was sent to (0: nothing to announce, nobody ticked, or the push failed). */
  notified: number;
}

const EMPTY: TicketMailRunSummary = {
  disabled: false,
  alreadySeen: 0,
  drafts: 0,
  skipped: 0,
  capped: 0,
  failed: 0,
  deferred: 0,
  notified: 0,
};

/** The safe code of a failure for the log and the status: a fixed code only, never a message that could carry a token or a mail's text. */
function safeCode(error: unknown, fallback: string): string {
  return error instanceof Error &&
    /^TICKET_MAIL_[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : fallback;
}

/**
 * THE TICKET@ INTAKE RUN (card ec7b947b, S2b): reads the new mail of the mailbox and files each message ONCE.
 *
 * It creates DRAFTS only (`ServiceTicketDraft`, which takes no ticket number): a ticket exists only after a person accepts the draft. Nothing
 * is sent, labelled or deleted in the mailbox (the client is read only). No model is called in this slice.
 */
@Injectable()
export class TicketMailIntakeService {
  private readonly logger = new Logger(TicketMailIntakeService.name);
  private running = false;
  private lastRunAt: string | null = null;
  private lastError: string | null = null;
  private lastSummary: TicketMailRunSummary | null = null;

  constructor(
    private readonly store: TicketMailRepository,
    private readonly gmail: TicketMailGmailClient,
    private readonly notifications: NotificationsService,
    private readonly jobs: ServiceJobsRepository,
  ) {}

  /** The status for the admins: the switch and the settings, and the last run. */
  status(user: AuthenticatedUser) {
    if (
      !["OWNER", "ADMIN"].includes(user.role) ||
      user.customerId ||
      user.supplierId
    )
      throw new ForbiddenException(
        "A ticket levelek állapota csak belső adminisztrátoroknak érhető el.",
      );
    const c = ticketMailConfig();
    return {
      enabled: c.enabled,
      switchReason: c.switchReason,
      configured: c.configured,
      mailbox: c.user,
      query: c.query,
      intervalMinutes: c.intervalMinutes,
      maxMessagesPerRun: c.maxMessagesPerRun,
      unknownSenderPerHour: c.unknownSenderPerHour,
      description: describeTicketMailIntake(c),
      running: this.running,
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      lastSummary: this.lastSummary,
    };
  }

  /**
   * ONE PUSH PER RUN to the managers who hold the `SERVICE_TICKET_AI_DRAFT` role, for the drafts of switched-on colleagues made in this run. A push
   * that fails, or a role nobody holds, never fails the run (the drafts are filed; the list shows them either way): only a fixed code is logged.
   */
  private async announce(announce: {
    count: number;
    mailId: string | null;
  }): Promise<number> {
    if (announce.count === 0 || !announce.mailId) return 0;
    try {
      const recipients = await this.jobs.notificationRoleRecipients(
        "SERVICE_TICKET_AI_DRAFT",
      );
      if (recipients.length === 0) {
        this.logger.warn("TICKET_MAIL_NO_PUSH_RECIPIENTS");
        return 0;
      }
      await this.notifications.deliverTicketMailDraftsArrived({
        mailId: announce.mailId,
        userIds: recipients.map((recipient) => recipient.id),
        count: announce.count,
      });
      return recipients.length;
    } catch {
      this.logger.warn("TICKET_MAIL_PUSH_FAILED");
      return 0;
    }
  }

  async run(now: Date = new Date()): Promise<TicketMailRunSummary> {
    if (this.running)
      throw new ConflictException("TICKET_MAIL_ALREADY_RUNNING");
    const c = ticketMailConfig();
    if (!c.enabled) return { ...EMPTY, disabled: true };
    this.running = true;
    this.lastError = null;
    const summary: TicketMailRunSummary = { ...EMPTY };
    try {
      const ids = await this.gmail.listMessageIds();
      let processed = 0;
      // the drafts of a SWITCHED-ON colleague (the AI branch, with or without the AI's answer) announce themselves; the others do not
      const announce = { count: 0, mailId: null as string | null };
      // Gmail lists newest first; file the oldest first, so the hourly guard and the order of the list follow the order of arrival.
      for (const id of [...ids].reverse()) {
        if (await this.store.hasMessage(c.user, id)) {
          summary.alreadySeen++;
          continue;
        }
        if (processed >= c.maxMessagesPerRun) {
          summary.deferred++;
          continue;
        }
        processed++;
        try {
          const message = await this.gmail.getMessage(id);
          const verdict = authenticationVerdict(
            message.headers.authenticationResults,
            message.fromAddress,
          );
          const skip = skipReason({
            fromAddress: message.fromAddress,
            ownAddress: c.user,
            headers: message.headers,
          });
          // a sender is looked up only for a mail that is not a machine's AND whose From could be believed
          const sender =
            !skip && verdict.verified && message.fromAddress
              ? await this.store.resolveSender(message.fromAddress)
              : null;
          const known = verdict.verified && sender !== null;
          const recentFromSender =
            !skip && !known && message.fromAddress
              ? await this.store.unknownCountSince(
                  c.user,
                  message.fromAddress,
                  new Date(now.getTime() - 60 * 60 * 1000),
                )
              : 0;
          const outcome = decideIntake({
            skip,
            verified: verdict.verified,
            sender,
            recentFromSender,
            unknownSenderPerHour: c.unknownSenderPerHour,
          });
          const recorded = await this.store.record({
            mailbox: c.user,
            message,
            authVerdict: verdict.reason,
            outcome,
            content: draftContentOf(message),
          });
          if (!recorded.recorded) summary.alreadySeen++;
          else if (outcome.kind === "SKIP") summary.skipped++;
          else if (outcome.kind === "CAPPED") summary.capped++;
          else {
            summary.drafts += recorded.drafts;
            if (
              outcome.kind === "DRAFT" &&
              announcesArrival(outcome.intakeState)
            ) {
              announce.count += recorded.drafts;
              announce.mailId = recorded.mailId;
            }
          }
        } catch (error) {
          // A message that cannot be read or recorded must not block the later ones: it stays unrecorded, and the next run retries it.
          summary.failed++;
          this.lastError = safeCode(error, "TICKET_MAIL_MESSAGE_FAILED");
          this.logger.warn(this.lastError);
        }
      }
      summary.notified = await this.announce(announce);
      this.lastSummary = summary;
      this.logger.log(
        `Ticket mailbox run: ${summary.drafts} drafts (${summary.notified} notified), ${summary.skipped} skipped, ${summary.capped} capped, ${summary.failed} failed, ${summary.deferred} deferred, ${summary.alreadySeen} already seen`,
      );
      return summary;
    } catch (error) {
      this.lastError = safeCode(error, "TICKET_MAIL_RUN_FAILED");
      throw error;
    } finally {
      this.running = false;
      this.lastRunAt = new Date().toISOString();
    }
  }
}
