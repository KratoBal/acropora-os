import { Prisma, prisma, type SyncRunTrigger } from "@acropora/database";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import type {
  SimplePaySyncRunSummary,
  SimplePaySyncState,
  SimplePaySyncStatus,
} from "@acropora/types";

import {
  isSimplePayReportSubject,
  simplePayGmailCredentials,
  simplePaySyncIntervalMinutes,
  simplePaySyncSwitch,
} from "./simplepay-gmail.config.js";
import {
  SimplePayGmailClient,
  SimplePayGmailError,
} from "./simplepay-gmail.client.js";
import { SimplePayReportError } from "./simplepay-report.parser.js";
import { SimplePaySettlementService } from "./simplepay-settlement.service.js";

/** The environment the pull reads its switch and key from (a test hands in its own). */
export const SIMPLEPAY_SYNC_ENV = Symbol("SIMPLEPAY_SYNC_ENV");

const ACTIVE_KEY = "SIMPLEPAY_GMAIL_SYNC";
const STALE_RUN_AFTER_MS = 30 * 60_000;
/** SimplePay's sending address; the query already asks for it, this checks. */
const SIMPLEPAY_SENDER = "noreply@simplepay.hu";

/** The pull's state, from the same readers the scheduler's log line uses. */
export function simplePaySyncState(
  environment: NodeJS.ProcessEnv = process.env,
): SimplePaySyncState {
  const switchState = simplePaySyncSwitch(
    environment.GMAIL_SIMPLEPAY_SYNC_ENABLED,
  );
  if (!switchState.on)
    return (
      {
        NOT_SET: "DISABLED_NOT_SET",
        OFF: "DISABLED_OFF",
        UNRECOGNISED: "DISABLED_UNRECOGNISED",
      } as const
    )[switchState.reason];
  return simplePayGmailCredentials(environment) ? "ENABLED" : "NO_KEY";
}

/**
 * THE SIMPLEPAY GMAIL PULL: SimplePay's weekly report mails, each CSV through
 * the same path as a hand upload (a report already in is a duplicate), with
 * the mail's body for SimplePay's own totals. A mail is fetched once: after
 * that it is known by its id, also when its file was refused or it turned out
 * not to be a weekly report. Every run is recorded, so the page can say when
 * it last ran and what it found.
 */
@Injectable()
export class SimplePayGmailSyncService {
  private readonly logger = new Logger(SimplePayGmailSyncService.name);

  constructor(
    private readonly gmail: SimplePayGmailClient,
    private readonly settlements: SimplePaySettlementService,
    @Optional()
    @Inject(SIMPLEPAY_SYNC_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  async status(): Promise<SimplePaySyncStatus> {
    const [last, lastScheduled] = await Promise.all([
      prisma.simplePaySyncRun.findFirst({ orderBy: { startedAt: "desc" } }),
      prisma.simplePaySyncRun.findFirst({
        where: { trigger: "SCHEDULED" },
        orderBy: { startedAt: "desc" },
      }),
    ]);
    return {
      state: simplePaySyncState(this.environment),
      canRunNow: simplePayGmailCredentials(this.environment) !== null,
      intervalMinutes: simplePaySyncIntervalMinutes(this.environment),
      lastRun: last ? summary(last) : undefined,
      lastScheduledRun: lastScheduled ? summary(lastScheduled) : undefined,
    };
  }

  /** One pull. The trigger is required: the status counts SCHEDULED runs apart. */
  async sync(trigger: SyncRunTrigger): Promise<SimplePaySyncRunSummary> {
    if (!simplePayGmailCredentials(this.environment))
      throw new BadRequestException(
        "Nincs Gmail-kulcs beállítva, a SimplePay-leveleket nem lehet lehúzni.",
      );
    const runId = await this.startRun(trigger);
    const counts = {
      messagesSeen: 0,
      documentsRead: 0,
      duplicateCount: 0,
      failedCount: 0,
    };
    try {
      const ids = await this.gmail.listMessageIds();
      counts.messagesSeen = ids.length;
      const known = new Set(
        (
          await prisma.simplePayGmailMessage.findMany({
            where: { gmailMessageId: { in: ids } },
            select: { gmailMessageId: true },
          })
        ).map((message) => message.gmailMessageId),
      );
      for (const id of ids.filter((id) => !known.has(id))) {
        let documentCount = 0;
        let messageError: string | null = null;
        let receivedAt: Date | null = null;
        let subject: string | null = null;
        try {
          const message = await this.gmail.getMessage(id);
          receivedAt = message.receivedAt;
          subject = message.subject;
          // a changed GMAIL_SIMPLEPAY_QUERY must not bring in "Sikeres
          // fizetés" (a payment we made) or another sender's CSV
          if (
            !isSimplePayReportSubject(message.subject) ||
            !message.sender?.toLowerCase().includes(SIMPLEPAY_SENDER)
          )
            messageError = "SIMPLEPAY_GMAIL_NOT_A_REPORT";
          else if (message.csv.length === 0)
            messageError = "SIMPLEPAY_GMAIL_NO_CSV";
          else
            for (const file of message.csv) {
              try {
                const result = await this.settlements.ingest(
                  file.buffer,
                  file.fileName,
                  {
                    actorUserId: null,
                    gmailMessageId: id,
                    mailBody: message.body,
                  },
                );
                documentCount++;
                if (result.duplicate) counts.duplicateCount++;
                else counts.documentsRead++;
              } catch (error) {
                if (!(error instanceof SimplePayReportError)) throw error;
                counts.failedCount++;
                messageError = error.code;
                this.logger.warn(
                  `SimplePay Gmail: ${file.fileName} was not read (${error.code})`,
                );
              }
            }
        } catch (error) {
          // a mail that cannot be fetched is not recorded: the next run tries
          // it again (a network error is not a verdict on the mail)
          if (error instanceof SimplePayGmailError) {
            counts.failedCount++;
            this.logger.warn(
              `SimplePay Gmail: mail ${id} not fetched (${error.code})`,
            );
            continue;
          }
          throw error;
        }
        await prisma.simplePayGmailMessage.create({
          data: {
            gmailMessageId: id,
            receivedAt,
            subject,
            documentCount,
            errorCode: messageError,
          },
        });
      }
      return summary(
        await prisma.simplePaySyncRun.update({
          where: { id: runId },
          data: {
            ...counts,
            status: "APPLIED",
            activeKey: null,
            completedAt: new Date(),
          },
        }),
      );
    } catch (error) {
      await prisma.simplePaySyncRun.update({
        where: { id: runId },
        data: {
          ...counts,
          status: "FAILED",
          activeKey: null,
          completedAt: new Date(),
          errorCode:
            error instanceof SimplePayGmailError
              ? error.code
              : "SIMPLEPAY_GMAIL_SYNC_FAILED",
        },
      });
      throw error;
    }
  }

  private async startRun(trigger: SyncRunTrigger): Promise<string> {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.simplePaySyncRun.updateMany({
          where: {
            activeKey: ACTIVE_KEY,
            status: "RUNNING",
            updatedAt: { lt: new Date(Date.now() - STALE_RUN_AFTER_MS) },
          },
          data: {
            activeKey: null,
            status: "FAILED",
            completedAt: new Date(),
            errorCode: "SIMPLEPAY_GMAIL_SYNC_STALE",
          },
        });
        const run = await tx.simplePaySyncRun.create({
          data: { activeKey: ACTIVE_KEY, status: "RUNNING", trigger },
        });
        return run.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("SIMPLEPAY_GMAIL_SYNC_ALREADY_RUNNING");
      throw error;
    }
  }
}

function summary(run: {
  status: "RUNNING" | "APPLIED" | "FAILED";
  trigger: SyncRunTrigger;
  startedAt: Date;
  completedAt: Date | null;
  messagesSeen: number;
  documentsRead: number;
  duplicateCount: number;
  failedCount: number;
  errorCode: string | null;
}): SimplePaySyncRunSummary {
  return {
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString(),
    messagesSeen: run.messagesSeen,
    documentsRead: run.documentsRead,
    duplicateCount: run.duplicateCount,
    failedCount: run.failedCount,
    errorCode: run.errorCode ?? undefined,
  };
}
