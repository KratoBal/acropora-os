import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";

import type { TicketOpener } from "./ticket-mail.rules.js";

export interface TicketMailContext {
  readonly jobNumber: string;
  readonly title: string;
  readonly description: string | null;
  readonly openedById: string | null;
  readonly opener: TicketOpener | null;
  /**
   * AZ UGYFEL ROVIDITESE (`FANK`), a push cimehez es a `{{ugyfelkod}}`
   * valtozohoz. NULLAZHATO ket okbol is: a jegynek nem kell ugyfele
   * (`customerId` nullazhato), es az ugyfelnek sem kell rovidítése
   * (`worksheetPartnerCode String?`). A ket hiany ugyanazt jelenti a
   * kuldesnek, ezert egy mezo.
   */
  readonly partnerCode: string | null;
}

/** Egy cimzett, akinel az ertesitesi szerep be van jelolve. */
export interface NotificationRoleRecipient {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
}

export interface StoredMailTemplate {
  readonly subject: string;
  readonly body: string;
  /** `null`: szoveges sablon, a mai alakban. Lasd a sema `bodyHtml` mezojet. */
  readonly bodyHtml: string | null;
}

/**
 * A KULDESHEZ KELLO ADAT, EGY LEKERDEZESBEN.
 *
 * A NYITO KULON LEKERDEZES, ES EZ NEM KENYELMETLENSEG: az `openedById`-n
 * SZANDEKOSAN NINCS IDEGENKULCS (lasd a sema fejlecet), tehat a Prisma nem tud
 * `include`-dal csatlakozni. Ugyanez az oka annak, hogy a nyito sora HIANYOZHAT
 * egy letezo azonosito mellett -- es ezert van a dontesben kulon
 * `opener-missing` ag.
 */
@Injectable()
export class TicketMailRepository {
  async context(serviceJobId: string): Promise<TicketMailContext | null> {
    const job = await prisma.serviceJob.findUnique({
      where: { id: serviceJobId },
      select: {
        jobNumber: true,
        title: true,
        description: true,
        openedById: true,
        customer: { select: { worksheetPartnerCode: true } },
      },
    });
    if (!job) return null;

    const opener = job.openedById
      ? await prisma.user.findUnique({
          where: { id: job.openedById },
          select: { email: true, displayName: true, isActive: true },
        })
      : null;

    const { customer, ...mezok } = job;
    return {
      ...mezok,
      opener,
      partnerCode: customer?.worksheetPartnerCode ?? null,
    };
  }

  async template(id: string): Promise<StoredMailTemplate | null> {
    return prisma.ticketMailTemplate.findUnique({
      where: { id },
      select: { subject: true, body: true, bodyHtml: true },
    });
  }

  async saveTemplate(input: {
    id: string;
    subject: string;
    body: string;
    /**
     * `null` KIFEJEZETTEN TOROL: aki szoveges sablont ment, az a HTML-t is
     * visszavonja. Hianyzo ertek helyett `null` kell, kulonben egy regi HTML
     * a szoveges mentes utan is kimenne.
     */
    bodyHtml: string | null;
    updatedByUserId: string | null;
  }): Promise<void> {
    const { id, ...mezok } = input;
    await prisma.ticketMailTemplate.upsert({
      where: { id },
      create: { id, ...mezok },
      update: mezok,
    });
  }

  /**
   * A KIKULDES TENYE A JEGY NAPLOJABA.
   *
   * A `note` CIMET NEM TARTALMAZ. AZ INDOK NEM AZ, HOGY A PARTNER MA LATNA
   * EZT A SORT -- ma nem latja: merve 2026-09-22-en a fo agon, a partner a
   * `partnerServiceJobDetail` vetiteset kapja, ami a naplo-bejegyzest ot
   * nevesitett mezobol epiti ujra, es a `note` nincs koztuk.
   *
   * AZ INDOK EZ: ennek a mezonek a LATHATOSAGA egy nap alatt KETSZER valtozott
   * (2026-09-21 10:5x es 12:07), tehat a lathatosag nem tulajdonsag, hanem
   * pillanat. Egy cim, ami egyszer bekerul egy naplo szovegebe, minden
   * jovobeli feluletnel egyutt utazik.
   *
   * Es a `toStatus` `null`: a jegy allapota nem valtozik ettol az esemenytol,
   * tehat a `STATUS_CHANGE` ala tenni hazugsag lenne.
   */
  async recordNotification(input: {
    serviceJobId: string;
    note: string;
    actorUserId: string | null;
  }): Promise<void> {
    await prisma.serviceJobEvent.create({
      data: {
        serviceJobId: input.serviceJobId,
        kind: "NOTIFICATION_SENT",
        note: input.note,
        actorUserId: input.actorUserId,
      },
    });
  }
}
