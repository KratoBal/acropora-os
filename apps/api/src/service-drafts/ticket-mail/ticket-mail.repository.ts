import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";

import type { TicketMailMessage } from "./ticket-mail-gmail.client.js";
import {
  withoutNul,
  type IntakeOutcome,
  type ResolvedSender,
  type draftContentOf,
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
   * EVERY NAME WE KNOW THAT COULD APPEAR IN A MAIL, for the redaction before the AI call: each user's display, first and last name (the staff and
   * the partner portal users), active or not. Names only, no addresses, no ids; the redaction turns the tokens into a pattern and discards them.
   */
  async personNames(): Promise<string[]> {
    const users = await prisma.user.findMany({
      select: { displayName: true, firstName: true, lastName: true },
      take: 20_000,
    });
    return users.flatMap((user) => [
      user.displayName,
      user.firstName,
      user.lastName,
    ]);
  }

  /**
   * HOW MANY MAILS OF ALL UNKNOWN SENDERS TOGETHER were listed or capped since `since`: a draft of an unknown sender, or a mail recorded as
   * capped. The per-address count cannot see a flood from rotating addresses; this one protects the managers' list whoever writes.
   */
  unknownTotalSince(mailbox: string, since: Date) {
    return prisma.serviceDraftMail.count({
      where: {
        source: TICKET_MAIL_SOURCE,
        mailbox,
        createdAt: { gte: since },
        OR: [
          { skipReason: "CAPPED" },
          { drafts: { some: { intakeState: "UNKNOWN_SENDER" } } },
        ],
      },
    });
  }

  /**
   * A MESSAGE FAILED: its failure count goes up by one (the table is the database's, so a restart does not reset it), and the new count is
   * returned. The caller seals it when the count reaches the limit.
   */
  async noteFailure(
    mailbox: string,
    messageId: string,
    code: string,
  ): Promise<number> {
    const row = await prisma.serviceDraftMailFailure.upsert({
      where: { mailbox_messageId: { mailbox, messageId } },
      create: { mailbox, messageId, lastCode: code.slice(0, 60) },
      update: { attempts: { increment: 1 }, lastCode: code.slice(0, 60) },
      select: { attempts: true },
    });
    return row.attempts;
  }

  /**
   * A POISONED MESSAGE, SEALED: a `ServiceDraftMail` row with `skipReason` FAILED and NO text (a message that cannot be stored is exactly the one
   * whose text must not be written again), so the next run does not read it again and it no longer takes a run's places; the failure count row is
   * removed. Nothing is listed: the mail stays in the mailbox, and the row says why it was left.
   */
  async sealFailed(
    mailbox: string,
    messageId: string,
    code: string,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`service-drafts-ingest:${TICKET_MAIL_SOURCE}:${mailbox}`}))`;
      const existing = await tx.serviceDraftMail.findUnique({
        where: {
          source_mailbox_messageId: {
            source: TICKET_MAIL_SOURCE,
            mailbox,
            messageId,
          },
        },
        select: { id: true },
      });
      if (!existing)
        await tx.serviceDraftMail.create({
          data: {
            source: TICKET_MAIL_SOURCE,
            mailbox,
            messageId,
            originalText: "",
            authVerdict: code.slice(0, 40),
            skipReason: "FAILED",
          },
        });
      await tx.serviceDraftMailFailure.deleteMany({
        where: { mailbox, messageId },
      });
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
    content: ReturnType<typeof draftContentOf> & {
      /** The AI's short summary and the model that wrote it (S3b); absent when the AI did not run. */
      aiSummary?: string;
      aiExtractedBy?: string;
    };
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
            // EVERY STORED TEXT WITHOUT NUL (barracuda, #2646): PostgreSQL's text refuses 0x00, and a sender can put one in
            subject: withoutNul(message.subject),
            receivedAt: message.receivedAt,
            originalText: withoutNul(message.text).slice(
              0,
              MAX_STORED_TEXT_CHARS,
            ),
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
            aiSummary: content.aiSummary ?? null,
            aiExtractedBy: content.aiExtractedBy ?? null,
            attachments: {
              create: [...unique].map(([sha256, a]) => ({
                fileName: withoutNul(a.fileName),
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
