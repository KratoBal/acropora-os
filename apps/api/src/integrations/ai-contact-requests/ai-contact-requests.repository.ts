import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type {
  AiContactRequestInput,
  AiContactRequestView,
} from "@acropora/types";

export interface StoredContactRequest {
  id: string;
  /** False when the `requestKey` was already stored: nothing new was written. */
  created: boolean;
  /** Whether the notification of the stored request went out (an earlier try may have failed). */
  notified: boolean;
}

const viewOf = (row: {
  id: string;
  channel: "EMAIL" | "PHONE";
  value: string;
  conversationRef: string;
  createdAt: Date;
  notifiedAt: Date | null;
  handledAt: Date | null;
}): AiContactRequestView => ({
  id: row.id,
  channel: row.channel,
  value: row.value,
  conversationRef: row.conversationRef,
  createdAt: row.createdAt.toISOString(),
  notifiedAt: row.notifiedAt?.toISOString() ?? null,
  handledAt: row.handledAt?.toISOString() ?? null,
});

@Injectable()
export class AiContactRequestsRepository {
  /**
   * ONE MESSAGE, ONE REQUEST: the unique `requestKey` decides, not a read before the write, so two parallel hand-overs of the same
   * message cannot both create a row (the loser reads the winner's).
   */
  async store(input: AiContactRequestInput): Promise<StoredContactRequest> {
    try {
      const row = await prisma.aiContactRequest.create({ data: input });
      return { id: row.id, created: true, notified: false };
    } catch (error) {
      if ((error as { code?: unknown })?.code !== "P2002") throw error;
      const existing = await prisma.aiContactRequest.findUniqueOrThrow({
        where: { requestKey: input.requestKey },
        select: { id: true, notifiedAt: true },
      });
      return {
        id: existing.id,
        created: false,
        notified: existing.notifiedAt !== null,
      };
    }
  }

  /** The stored request, for the notification. */
  async find(id: string): Promise<AiContactRequestView | null> {
    const row = await prisma.aiContactRequest.findUnique({ where: { id } });
    return row ? viewOf(row) : null;
  }

  /** Marks the notification as sent, once: a second call does not move the time. */
  async markNotified(id: string): Promise<void> {
    await prisma.aiContactRequest.updateMany({
      where: { id, notifiedAt: null },
      data: { notifiedAt: new Date() },
    });
  }

  /** The newest requests first, for the Settings list. */
  async list(limit: number): Promise<AiContactRequestView[]> {
    const rows = await prisma.aiContactRequest.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map(viewOf);
  }

  /**
   * THE HANDLING AND ITS AUDIT ROW IN ONE TRANSACTION. The conditional update (`handledAt` still empty) decides who handled it:
   * a second click does not move the time or the handler. Null when there is no such request or it was handled already.
   */
  async markHandled(
    id: string,
    userId: string | null,
  ): Promise<AiContactRequestView | null> {
    return prisma.$transaction(async (transaction) => {
      const done = await transaction.aiContactRequest.updateMany({
        where: { id, handledAt: null },
        data: { handledAt: new Date(), handledById: userId },
      });
      if (done.count !== 1) return null;
      await transaction.auditLog.create({
        data: {
          userId,
          action: "ai-contact-request.handled",
          entityType: "AiContactRequest",
          entityId: id,
          metadata: {},
        },
      });
      const row = await transaction.aiContactRequest.findUniqueOrThrow({
        where: { id },
      });
      return viewOf(row);
    });
  }
}
