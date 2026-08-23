import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";

export interface NotificationAttempt {
  userId: string;
  delivered: boolean;
  /** Apple's own word for the refusal, or the local one. Absent on success. */
  reason?: string;
  /** Whether the device was dropped as a result. */
  retired?: boolean;
}

export interface NotificationOutcome {
  worksheetId: string;
  attempts: NotificationAttempt[];
}

/**
 * Writes down who was reached and who was not.
 *
 * A log line is enough while somebody is watching the process; this is for
 * the question asked a day later - "did the technician get it?" - which a
 * rotated log file cannot answer. `DomainEvent` is where this system already
 * records what happened, so the answer lives with the rest of the history of
 * the worksheet rather than in a table of its own.
 *
 * NO DEVICE TOKEN IS STORED HERE. A token is a credential for reaching
 * somebody's phone; the colleague's id answers the question just as well, and
 * an event row is read by more people than the device table is.
 */
@Injectable()
export class NotificationLogRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async recordWorksheetAssignment(outcome: NotificationOutcome): Promise<void> {
    if (outcome.attempts.length === 0) return;

    const delivered = outcome.attempts.filter((attempt) => attempt.delivered);
    const failed = outcome.attempts.filter((attempt) => !attempt.delivered);

    await this.database.domainEvent.create({
      data: {
        id: randomUUID(),
        eventType: "worksheet.assignment.notified",
        aggregateType: "Worksheet",
        aggregateId: outcome.worksheetId,
        occurredAt: new Date(),
        schemaVersion: 1,
        payload: {
          deliveredTo: delivered.map((attempt) => attempt.userId),
          failed: failed.map((attempt) => ({
            userId: attempt.userId,
            reason: attempt.reason ?? "unknown",
            retiredDevice: attempt.retired ?? false,
          })),
        } satisfies Prisma.JsonObject,
      },
    });
  }
}
