import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";

import type { TicketOpener } from "./ticket-mail.rules.js";

export interface TicketMailContext {
  readonly jobNumber: string;
  readonly title: string;
  readonly description: string | null;
  readonly openedById: string | null;
  readonly opener: TicketOpener | null;
}

export interface StoredMailTemplate {
  readonly subject: string;
  readonly body: string;
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
      },
    });
    if (!job) return null;

    const opener = job.openedById
      ? await prisma.user.findUnique({
          where: { id: job.openedById },
          select: { email: true, displayName: true, isActive: true },
        })
      : null;

    return { ...job, opener };
  }

  async template(id: string): Promise<StoredMailTemplate | null> {
    return prisma.ticketMailTemplate.findUnique({
      where: { id },
      select: { subject: true, body: true },
    });
  }

  async saveTemplate(input: {
    id: string;
    subject: string;
    body: string;
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
   * A `note` CIMET NEM TARTALMAZ -- a naplo atmegy a partner portalra
   * (fb945858 merese). Es a `toStatus` `null`: a jegy allapota nem valtozik
   * ettol az esemenytol, tehat a `STATUS_CHANGE` ala tenni hazugsag lenne.
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
