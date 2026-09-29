import { Prisma, prisma } from "@acropora/database";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import type {
  GlsSyncRunSummary,
  GlsSyncState,
  GlsSyncStatus,
} from "@acropora/types";

import { GlsDocumentError } from "./gls-documents.parser.js";
import {
  glsGmailCredentials,
  glsSyncIntervalMinutes,
  glsSyncSwitch,
} from "./gls-gmail.config.js";
import { GlsGmailClient, GlsGmailError } from "./gls-gmail.client.js";
import { GlsSettlementService } from "./gls-settlement.service.js";

/** The environment the pull reads its switch and key from (a test hands in its own). */
export const GLS_SYNC_ENV = Symbol("GLS_SYNC_ENV");

const ACTIVE_KEY = "GLS_GMAIL_SYNC";
const STALE_RUN_AFTER_MS = 30 * 60_000;

function errorCodeOf(error: unknown, fallback: string): string {
  return error instanceof GlsGmailError || error instanceof GlsDocumentError
    ? error.code
    : fallback;
}

/** The pull's state, from the same readers the scheduler's log line uses. */
export function glsSyncState(
  environment: NodeJS.ProcessEnv = process.env,
): GlsSyncState {
  const switchState = glsSyncSwitch(environment.GMAIL_GLS_SYNC_ENABLED);
  if (!switchState.on)
    return (
      {
        NOT_SET: "DISABLED_NOT_SET",
        OFF: "DISABLED_OFF",
        UNRECOGNISED: "DISABLED_UNRECOGNISED",
      } as const
    )[switchState.reason];
  return glsGmailCredentials(environment) ? "ENABLED" : "NO_KEY";
}

/**
 * THE GLS GMAIL PULL: the GLS senders' mails, each XLSX attachment through
 * the same path as a hand upload (so a file already in is a duplicate, and
 * nothing is stored twice). A mail is fetched once: afterwards it is known by
 * its id, also when one of its files was refused. Every run is recorded, so
 * the page can say when it last ran and what it found.
 */
@Injectable()
export class GlsGmailSyncService {
  private readonly logger = new Logger(GlsGmailSyncService.name);

  constructor(
    private readonly gmail: GlsGmailClient,
    private readonly settlements: GlsSettlementService,
    @Optional()
    @Inject(GLS_SYNC_ENV)
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  async status(): Promise<GlsSyncStatus> {
    const last = await prisma.glsSyncRun.findFirst({
      orderBy: { startedAt: "desc" },
    });
    return {
      state: glsSyncState(this.environment),
      canRunNow: glsGmailCredentials(this.environment) !== null,
      intervalMinutes: glsSyncIntervalMinutes(this.environment),
      lastRun: last ? summary(last) : undefined,
    };
  }

  async sync(): Promise<GlsSyncRunSummary> {
    if (!glsGmailCredentials(this.environment))
      throw new BadRequestException(
        "Nincs Gmail-kulcs beállítva, a GLS-leveleket nem lehet lehúzni.",
      );
    const runId = await this.startRun();
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
          await prisma.glsGmailMessage.findMany({
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
          for (const file of message.xlsx) {
            try {
              const result = await this.settlements.ingest(
                file.buffer,
                file.fileName,
                null,
              );
              documentCount++;
              if (result.duplicate) counts.duplicateCount++;
              else counts.documentsRead++;
            } catch (error) {
              if (!(error instanceof GlsDocumentError)) throw error;
              counts.failedCount++;
              messageError = error.code;
              this.logger.warn(
                `GLS Gmail: ${file.fileName} was not read (${error.code})`,
              );
            }
          }
          if (message.xlsx.length === 0) messageError = "GLS_GMAIL_NO_XLSX";
        } catch (error) {
          // a mail that cannot be fetched is not recorded: the next run tries
          // it again (a network error is not a verdict on the mail)
          if (error instanceof GlsGmailError) {
            counts.failedCount++;
            this.logger.warn(
              `GLS Gmail: mail ${id} not fetched (${error.code})`,
            );
            continue;
          }
          throw error;
        }
        await prisma.glsGmailMessage.create({
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
        await prisma.glsSyncRun.update({
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
      await prisma.glsSyncRun.update({
        where: { id: runId },
        data: {
          ...counts,
          status: "FAILED",
          activeKey: null,
          completedAt: new Date(),
          errorCode: errorCodeOf(error, "GLS_GMAIL_SYNC_FAILED"),
        },
      });
      throw error;
    }
  }

  private async startRun(): Promise<string> {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.glsSyncRun.updateMany({
          where: {
            activeKey: ACTIVE_KEY,
            status: "RUNNING",
            updatedAt: { lt: new Date(Date.now() - STALE_RUN_AFTER_MS) },
          },
          data: {
            activeKey: null,
            status: "FAILED",
            completedAt: new Date(),
            errorCode: "GLS_GMAIL_SYNC_STALE",
          },
        });
        const run = await tx.glsSyncRun.create({
          data: { activeKey: ACTIVE_KEY, status: "RUNNING" },
        });
        return run.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("GLS_GMAIL_SYNC_ALREADY_RUNNING");
      throw error;
    }
  }
}

function summary(run: {
  status: "RUNNING" | "APPLIED" | "FAILED";
  startedAt: Date;
  completedAt: Date | null;
  messagesSeen: number;
  documentsRead: number;
  duplicateCount: number;
  failedCount: number;
  errorCode: string | null;
}): GlsSyncRunSummary {
  return {
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString(),
    messagesSeen: run.messagesSeen,
    documentsRead: run.documentsRead,
    duplicateCount: run.duplicateCount,
    failedCount: run.failedCount,
    errorCode: run.errorCode ?? undefined,
  };
}
