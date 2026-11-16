import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";

import type { TicketMailMessage } from "./ticket-mail-gmail.client.js";
import type {
  IntakeOutcome,
  ResolvedSender,
  draftContentOf,
} from "./ticket-mail-intake.js";

/** The `source` of every ticket@ draft and mail row; the Cápasuli rows keep theirs. */
export const TICKET_MAIL_SOURCE = "TICKET_MAIL";

/** The stored copy of a mail's text is capped: a mail is read, not archived whole (an attachment-heavy or looping sender cannot grow a row without bound). */
const MAX_STORED_TEXT_CHARS = 200_000;

export interface RecordedMail {
  /** false: the message was already recorded (a second run, or two at once). */
  recorded: boolean;
  drafts: number;
  /** The `ServiceDraftMail` row of a message recorded now (the push's target); null when it was already recorded. */
  mailId: string | null;
}

/**
 * THE TICKET@ INTAKE'S DATABASE SIDE (card ec7b947b, S2b). Every processed message leaves ONE `ServiceDraftMail` row, whatever came of it (a
 * draft, a machine's mail skipped, an unknown sender over the hourly guard): that row is what keeps the next run from reading it again, and it
 * keeps the original text, so nothing that arrived is lost, only not listed.
 */
@Injectable()
export class TicketMailRepository {
  hasMessage(mailbox: string, messageId: string) {
    return prisma.serviceDraftMail.findUnique({
      where: {
        source_mailbox_messageId: {
          source: TICKET_MAIL_SOURCE,
          mailbox,
          messageId,
        },
      },
      select: { id: true },
    });
  }

  /**
   * THE SENDER AS A USER, or null: an ACTIVE INTERNAL account (no customer, no supplier, not a service account) whose email equals the address
   * (case-insensitively). A partner or supplier account is not a known sender. The capability and the departments are read for that user only.
   */
  async resolveSender(address: string): Promise<ResolvedSender | null> {
    const user = await prisma.user.findFirst({
      where: {
        email: { equals: address, mode: "insensitive" },
        isActive: true,
        isServiceAccount: false,
        customerId: null,
        supplierId: null,
      },
      select: { id: true, displayName: true },
    });
    if (!user) return null;
    const [capability, departments] = await Promise.all([
      prisma.userServiceCapability.findUnique({
        where: {
          userId_capability: {
            userId: user.id,
            capability: "TICKET_MAIL_AI_WATCH",
          },
        },
        select: { userId: true },
      }),
      prisma.userWorksheetDepartment.findMany({
        where: { userId: user.id, department: { isActive: true } },
        select: { departmentId: true },
        orderBy: { departmentId: "asc" },
      }),
    ]);
    return {
      userId: user.id,
      displayName: user.displayName,
      watching: capability !== null,
      departmentIds: departments.map((d) => d.departmentId),
    };
  }

  /** How many mails from this address were listed or capped since `since`: the machine's mail skipped does not count against a sender. */
  unknownCountSince(mailbox: string, address: string, since: Date) {
    return prisma.serviceDraftMail.count({
      where: {
        source: TICKET_MAIL_SOURCE,
        mailbox,
        fromAddress: address,
        createdAt: { gte: since },
        OR: [{ skipReason: null }, { skipReason: "CAPPED" }],
      },
    });
  }

  /**
   * ONE MESSAGE, ONE TRANSACTION: the mail row, and for a draft outcome the draft with its attachments. The lock and the existing-row check make a
   * second run (or two at once) a no-op for a message already recorded.
   */
  async record(input: {
    mailbox: string;
    message: TicketMailMessage;
    authVerdict: string;
    outcome: IntakeOutcome;
    content: ReturnType<typeof draftContentOf>;
  }): Promise<RecordedMail> {
    const { mailbox, message, outcome, content } = input;
    return prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`service-drafts-ingest:${TICKET_MAIL_SOURCE}:${mailbox}`}))`;
        const previous = await tx.serviceDraftMail.findUnique({
          where: {
            source_mailbox_messageId: {
              source: TICKET_MAIL_SOURCE,
              mailbox,
              messageId: message.id,
            },
          },
          select: { id: true },
        });
        if (previous) return { recorded: false, drafts: 0, mailId: null };
        const mail = await tx.serviceDraftMail.create({
          data: {
            source: TICKET_MAIL_SOURCE,
            mailbox,
            messageId: message.id,
            subject: message.subject,
            receivedAt: message.receivedAt,
            originalText: message.text.slice(0, MAX_STORED_TEXT_CHARS),
            fromAddress: message.fromAddress,
            authVerdict: input.authVerdict,
            skipReason:
              outcome.kind === "SKIP"
                ? outcome.reason
                : outcome.kind === "CAPPED"
                  ? "CAPPED"
                  : null,
            droppedAttachments: message.droppedAttachments.length,
          },
        });
        if (outcome.kind !== "DRAFT")
          return { recorded: true, drafts: 0, mailId: mail.id };
        const unique = new Map(
          message.attachments.map((a) => [
            createHash("sha256").update(a.buffer).digest("hex"),
            a,
          ]),
        );
        await tx.serviceTicketDraft.create({
          data: {
            source: TICKET_MAIL_SOURCE,
            mailbox,
            reportDate: content.reportDate,
            fingerprint: content.fingerprint,
            mailId: mail.id,
            originalProblem: content.originalProblem,
            title: content.title,
            reporterPersonName: outcome.reporterPersonName,
            proposedDepartmentId: outcome.proposedDepartmentId,
            intakeState: outcome.intakeState,
            senderUserId: outcome.senderUserId,
            attachments: {
              create: [...unique].map(([sha256, a]) => ({
                fileName: a.fileName,
                contentType: a.contentType,
                content: new Uint8Array(a.buffer),
                sizeBytes: a.buffer.length,
                sha256,
              })),
            },
          },
        });
        return { recorded: true, drafts: 1, mailId: mail.id };
      },
      { timeout: 30_000 },
    );
  }
}
