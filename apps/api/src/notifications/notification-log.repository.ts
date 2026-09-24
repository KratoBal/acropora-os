import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";

export interface NotificationAttempt {
  userId: string;
  delivered: boolean;
  /**
   * A KULDO SAJAT SZAVA AZ ELUTASITASRA, vagy a mi helyi indokunk. Sikernel
   * hianyzik.
   *
   * 2026-09-21-IG EZ A SOR „Apple's own word"-ot mondott, es akkor igaz volt:
   * egy kuldo ut letezett. Ma ketto van, tehat ide a Google `UNREGISTERED` vagy
   * `SENDER_ID_MISMATCH` szava is bekerulhet.
   */
  reason?: string;
  /** Whether the device was dropped as a result. */
  retired?: boolean;
  /**
   * AMI ITT NINCS, ES KIMONDVA JOBB, MINT HALLGATVA: a PLATFORM.
   *
   * Egy felhasznalonak lehet iPhone-ja ES androidos keszuleke is; ilyenkor ket
   * `attempt` all ugyanazzal a `userId`-val, es a naplobol nem derul ki,
   * melyik keszulekrol van szo. A megkulonboztetes uj mezot kivanna a naplo
   * tablajan -- az mar sema-valtozas, es nem ennek a kartyanak a targya.
   */
}

export interface NotificationOutcome {
  worksheetId: string;
  attempts: NotificationAttempt[];
}

/** Ugyanaz a kimenetel, hibajegyre. */
export interface ServiceJobNotificationOutcome {
  serviceJobId: string;
  attempts: NotificationAttempt[];
}

/** Ugyanaz a kimenetel, anyagigenyre. */
export interface MaterialRequestNotificationOutcome {
  materialRequestId: string;
  attempts: NotificationAttempt[];
}

/** Ugyanaz a kimenetel, vizmeresre -- az aggregatum az AKVARIUM, nem a
 * mereskent felvitt sorok, mert egy mereesi alkalom tobb sort ir. */
export interface AquariumMeasurementNotificationOutcome {
  aquariumId: string;
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
    await this.record({
      eventType: "worksheet.assignment.notified",
      aggregateType: "Worksheet",
      aggregateId: outcome.worksheetId,
      attempts: outcome.attempts,
    });
  }

  /**
   * UGYANAZ A KERDES, HIBAJEGYRE -- ES KULON ESEMENY-TIPUSSAL.
   *
   * Nem ugyanaz a sor mas azonositoval: a `DomainEvent` a MAGA aggregatuma
   * szerint kereshető, es egy "worksheet.assignment.notified" tipusu sor egy
   * hibajegy azonositojaval a napló olvasójat vinne felre -- a munkalapok
   * esemenyeit kerdezve egy jegy-esemenyt kapna vissza.
   */
  async recordServiceJobAssignment(
    outcome: ServiceJobNotificationOutcome,
  ): Promise<void> {
    await this.record({
      eventType: "serviceJob.assignment.notified",
      aggregateType: "ServiceJob",
      aggregateId: outcome.serviceJobId,
      attempts: outcome.attempts,
    });
  }

  /** Ugyanaz a kimenetel, vizmeresre -- az aggregatum az AKVARIUM. */
  async recordAquariumMeasurement(
    outcome: AquariumMeasurementNotificationOutcome,
  ): Promise<void> {
    await this.record({
      eventType: "aquarium.measurement.notified",
      aggregateType: "Aquarium",
      aggregateId: outcome.aquariumId,
      attempts: outcome.attempts,
    });
  }

  /** Ugyanaz a kimenetel, anyagigenyre -- lasd a fenti ket metodus fejleceit. */
  async recordMaterialRequestCreated(
    outcome: MaterialRequestNotificationOutcome,
  ): Promise<void> {
    await this.record({
      eventType: "materialRequest.created.notified",
      aggregateType: "MaterialRequest",
      aggregateId: outcome.materialRequestId,
      attempts: outcome.attempts,
    });
  }

  /** Kulon esemeny-tipus, ugyanazon okbol, mint fent: kulon aggregatum. */
  async recordMaterialRequestReceived(
    outcome: MaterialRequestNotificationOutcome,
  ): Promise<void> {
    await this.record({
      eventType: "materialRequest.received.notified",
      aggregateType: "MaterialRequest",
      aggregateId: outcome.materialRequestId,
      attempts: outcome.attempts,
    });
  }

  /**
   * A KOZOS TORZS. A ket bejegyzes alakja beture azonos, es ez SZANDEKOS: aki a
   * munkalap-ertesitesek naplojat olvasni tudja, a jegyet is tudja, atirás
   * nelkul. Egy masodik alak ugyanarra a tenyre csak azt jelentene, hogy az
   * egyik olvasot elfelejtettuk karbantartani.
   */
  private async record(input: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    attempts: NotificationAttempt[];
  }): Promise<void> {
    if (input.attempts.length === 0) return;

    const delivered = input.attempts.filter((attempt) => attempt.delivered);
    const failed = input.attempts.filter((attempt) => !attempt.delivered);

    await this.database.domainEvent.create({
      data: {
        id: randomUUID(),
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
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
