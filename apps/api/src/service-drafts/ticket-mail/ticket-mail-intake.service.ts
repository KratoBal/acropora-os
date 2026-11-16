import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { NotificationsService } from "../../notifications/notifications.service.js";
import { ServiceJobsRepository } from "../../service-jobs/service-jobs.repository.js";

import {
  TicketMailGmailClient,
  TicketMailGmailError,
} from "./ticket-mail-gmail.client.js";
import {
  describeTicketMailIntake,
  ticketMailConfig,
} from "./ticket-mail.config.js";
import {
  announcesArrival,
  decideIntake,
  draftContentOf,
  withoutNul,
} from "./ticket-mail-intake.js";
import {
  authenticationVerdict,
  cleanMailBody,
  cleanSubject,
  skipReason,
} from "./ticket-mail-message.js";
import { TicketMailRepository } from "./ticket-mail.repository.js";
import {
  TICKET_MAIL_AI_CLIENT,
  type TicketDraftClient,
} from "./ticket-mail-ai.client.js";
import { hasReadableText, redactForAi } from "./ticket-mail-redact.js";

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
  /** Messages that failed their last allowed run and were sealed as FAILED (recorded without text, no longer retried). */
  sealed: number;
  /** The AI step: calls made, drafts the AI filled, answers it refused (or this side did), and calls that found it unavailable. */
  aiCalls: number;
  aiDrafts: number;
  aiRefused: number;
  aiUnavailable: number;
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
  sealed: 0,
  aiCalls: 0,
  aiDrafts: 0,
  aiRefused: 0,
  aiUnavailable: 0,
  notified: 0,
};

/**
 * WHETHER A FAILURE BELONGS TO THE MESSAGE: one the mail itself causes (a database refusal of its content, a parse failure, Gmail answering a 4xx
 * for that one message) counts against it. A failure of the MAILBOX CONNECTION (the token, the rate limit, a timeout, the network, a 5xx) is not the
 * message's: it ends the run without counting, or one outage would seal every message in the mailbox.
 */
function isMessageSpecific(error: unknown): boolean {
  if (!(error instanceof TicketMailGmailError)) return true;
  return /^TICKET_MAIL_GMAIL_HTTP_4\d\d$/.test(error.code);
}

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
    @Optional()
    @Inject(TICKET_MAIL_AI_CLIENT)
    private readonly ai: TicketDraftClient | null = null,
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
      ai: {
        enabled: c.aiEnabled && this.ai !== null,
        switchReason: c.aiSwitchReason,
        configured: this.ai !== null,
        maxPerRun: c.aiMaxPerRun,
      },
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
    // the drafts of a SWITCHED-ON colleague (the AI branch, with or without the AI's answer) announce themselves; the others do not
    const announce = { count: 0, mailId: null as string | null };
    try {
      const ids = await this.gmail.listMessageIds();
      let processed = 0;
      // the AI step's budget for this run, and the names it redacts with (read once, only if the AI is going to be asked)
      const budget = { calls: 0, failures: 0 };
      let names: string[] | null = null;
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
          const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
          const unknown = !skip && !known;
          const recentFromSender =
            unknown && message.fromAddress
              ? await this.store.unknownCountSince(
                  c.user,
                  message.fromAddress,
                  hourAgo,
                )
              : 0;
          const recentUnknownTotal = unknown
            ? await this.store.unknownTotalSince(c.user, hourAgo)
            : 0;
          const outcome = decideIntake({
            skip,
            verified: verdict.verified,
            sender,
            recentFromSender,
            unknownSenderPerHour: c.unknownSenderPerHour,
            recentUnknownTotal,
            unknownTotalPerHour: c.unknownTotalPerHour,
          });
          // THE AI STEP, only for a verified, switched-on colleague's mail (the AI branch), never for an unknown or a switched-off sender: their text
          // does not go to the model at all. It runs BEFORE the record, outside any transaction (a call waits for the network).
          let finalOutcome = outcome;
          let content: Parameters<
            TicketMailRepository["record"]
          >[0]["content"] = draftContentOf(message);
          if (
            outcome.kind === "DRAFT" &&
            outcome.intakeState === "AI_UNAVAILABLE" &&
            c.aiEnabled &&
            this.ai &&
            budget.calls < c.aiMaxPerRun &&
            budget.failures < c.aiMaxFailures
          ) {
            names ??= await this.store.personNames().catch(() => []);
            const redacted = redactForAi({
              subject: cleanSubject(withoutNul(message.subject)) ?? "",
              text: cleanMailBody(withoutNul(message.text)).text,
              knownNames: [
                ...names,
                message.fromDisplayName,
                sender?.displayName,
              ],
            });
            // a mail that is only names and numbers once redacted is not worth a call
            if (hasReadableText(`${redacted.subject} ${redacted.text}`)) {
              budget.calls++;
              summary.aiCalls++;
              const answer = await this.ai
                .draft({ subject: redacted.subject, text: redacted.text })
                .catch(
                  () => ({ kind: "UNAVAILABLE", reason: "error" }) as const,
                );
              if (answer.kind === "DRAFT") {
                budget.failures = 0;
                summary.aiDrafts++;
                finalOutcome = { ...outcome, intakeState: "AI_DRAFT" };
                content = {
                  ...content,
                  title: answer.title,
                  aiSummary: answer.summary,
                  aiExtractedBy: answer.extractedBy,
                };
              } else if (answer.kind === "REFUSED") {
                budget.failures = 0;
                summary.aiRefused++;
              } else {
                budget.failures++;
                summary.aiUnavailable++;
              }
            }
          }
          const recorded = await this.store.record({
            mailbox: c.user,
            message,
            authVerdict: verdict.reason,
            outcome: finalOutcome,
            content,
          });
          if (!recorded.recorded) summary.alreadySeen++;
          else if (finalOutcome.kind === "SKIP") summary.skipped++;
          else if (finalOutcome.kind === "CAPPED") summary.capped++;
          else {
            summary.drafts += recorded.drafts;
            if (
              finalOutcome.kind === "DRAFT" &&
              announcesArrival(finalOutcome.intakeState)
            ) {
              announce.count += recorded.drafts;
              announce.mailId = recorded.mailId;
            }
          }
        } catch (error) {
          // A failure of the mailbox connection ends the run (not counted against any message); see `isMessageSpecific`.
          if (!isMessageSpecific(error)) throw error;
          // A message that cannot be read or recorded must not block the later ones: it stays unrecorded and the next run retries it, up to
          // `maxAttempts` runs; then it is sealed as FAILED, so a poisoned mail cannot take a run's places for ever (barracuda, #2646).
          summary.failed++;
          const code = safeCode(error, "TICKET_MAIL_MESSAGE_FAILED");
          this.lastError = code;
          this.logger.warn(code);
          try {
            const attempts = await this.store.noteFailure(c.user, id, code);
            if (attempts >= c.maxAttempts) {
              await this.store.sealFailed(c.user, id, code);
              summary.sealed++;
              this.logger.warn("TICKET_MAIL_MESSAGE_SEALED");
            }
          } catch {
            this.logger.warn("TICKET_MAIL_FAILURE_NOTE_FAILED");
          }
        }
      }
      summary.notified = await this.announce(announce);
      this.lastSummary = summary;
      this.logger.log(
        `Ticket mailbox run: ${summary.drafts} drafts (${summary.notified} notified), ${summary.skipped} skipped, ${summary.capped} capped, ${summary.failed} failed (${summary.sealed} sealed), AI ${summary.aiDrafts}/${summary.aiCalls} (${summary.aiRefused} refused, ${summary.aiUnavailable} unavailable), ${summary.deferred} deferred, ${summary.alreadySeen} already seen`,
      );
      return summary;
    } catch (error) {
      this.lastError = safeCode(error, "TICKET_MAIL_RUN_FAILED");
      // a connection failure ends the run, but the drafts filed before it are recorded: their push goes out now, since the next run will not
      // find them new (barracuda, #2648)
      await this.announce(announce);
      throw error;
    } finally {
      this.running = false;
      this.lastRunAt = new Date().toISOString();
    }
  }
}
