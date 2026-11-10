import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from "@nestjs/common";
import { prisma } from "@acropora/database";
import { runOutDays } from "@acropora/jev/product-enrichment";

import type { MailSender } from "../notifications/mail/mail.port.js";
import { reefClubWebUrl } from "../reefclub/reefclub-mail.js";
import {
  RUNOUT_SECRET_ENV,
  runOutAvailability,
  type RunOutAvailability,
  unsubscribeKeyFor,
} from "../reefclub/reefclub-runout-consent.js";
import {
  budapestDay,
  reminderStep,
  runOutMail,
  startDay,
} from "./reefclub-runout-reminder.rules.js";
import { REEFCLUB_SHOP_MAIL_SENDER } from "./reefclub-shop-mail-sender.js";

export const RUNOUT_SWEEP_INTERVAL_MS = 60 * 60_000;
export const RUNOUT_MAX_ATTEMPTS = 5;
export const RUNOUT_LEASE_MS = 10 * 60_000;
const BATCH = 200;
/** The business statuses that mean the order left the shop (or waits at the counter). */
const LEFT_THE_SHOP = ["SHIPPING", "READY_FOR_PICKUP", "CLOSED"] as const;

export interface RunOutSweep {
  /** Why nothing was read: a closed lock, or no ReefClub sender on this process. */
  closed: "off" | "no-text" | "no-secret" | "no-sender" | null;
  sent: number;
  failed: number;
  late: number;
  /** Rows the reminder cannot count now (no countable product, no litres). */
  uncountable: number;
}

/**
 * THE RUN-OUT REMINDER'S SENDER (ReefClub V3.2, card cd94ed11, slice 5), in the OS process: it reads what the ReefClub role
 * cannot (the member's shop orders for the start day, `reefclub-runout-reminder.rules.ts`), and once an hour sends the reminders
 * due today (Budapest).
 *
 * NOTHING IS READ OR SENT unless ALL of these hold, on THIS process's environment:
 *   - the three locks of the consent (`runOutAvailability`: the switch, the consent text, the unsubscribe secret; the secret must
 *     be the same as the ReefClub process's, or the links would not open);
 *   - the ReefClub's own sender (`REEFCLUB_SHOP_MAIL_SENDER`, set by `REEFCLUB_SMTP_*`). The shared sender (info@) is NEVER taken:
 *     a member's ReefClub reminder does not go from the shop's mailbox.
 *
 * The count is the manufacturer's dose and the pack from the projected product list (`ReefClubRunOutProduct`, the same list the
 * member got the button from), and the aquarium's litres today. One mail per run-out day (`remindedForRunOut`); the claim is a
 * lease like the shop link's notice, so two processes do not both send; a failed send gives the lease back and counts an attempt,
 * and the last one writes `REEFCLUB_RUNOUT_REMINDER_FAILED`. At least once, not exactly once.
 */
@Injectable()
export class ReefClubRunOutReminderService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ReefClubRunOutReminderService.name);
  private timer: NodeJS.Timeout | null = null;
  /** The test replaces it; production reads the process environment. */
  environment: Record<string, string | undefined> = process.env;
  availability: () => RunOutAvailability = () =>
    runOutAvailability(this.environment);

  constructor(
    @Optional()
    @Inject(REEFCLUB_SHOP_MAIL_SENDER)
    private readonly sender: MailSender | null = null,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.sweep().catch((error: unknown) =>
        this.logger.warn(
          `A kifogyási emlékeztetők köre elbukott: ${error instanceof Error ? error.message : "ismeretlen hiba"}`,
        ),
      );
    }, RUNOUT_SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(now = new Date()): Promise<RunOutSweep> {
    const result: RunOutSweep = {
      closed: null,
      sent: 0,
      failed: 0,
      late: 0,
      uncountable: 0,
    };
    const availability = this.availability();
    if (availability.kind !== "available")
      return { ...result, closed: availability.kind };
    if (!this.sender) return { ...result, closed: "no-sender" };

    const today = budapestDay(now);
    const rows = await prisma.reefClubRunOutReminder.findMany({
      where: {
        unsubscribedAt: null,
        remindAttempts: { lt: RUNOUT_MAX_ATTEMPTS },
        account: { deletionRequestedAt: null, emailVerifiedAt: { not: null } },
        OR: [
          { remindClaimedAt: null },
          {
            remindClaimedAt: { lt: new Date(now.getTime() - RUNOUT_LEASE_MS) },
          },
        ],
      },
      select: {
        id: true,
        accountId: true,
        productId: true,
        consentAt: true,
        remindedForRunOut: true,
        account: { select: { email: true } },
        aquarium: { select: { name: true, systemVolumeLiters: true } },
      },
      orderBy: { id: "asc" },
      take: BATCH,
    });
    if (rows.length === 0) return result;
    const products = new Map(
      (
        await prisma.reefClubRunOutProduct.findMany({
          where: { productId: { in: rows.map((row) => row.productId) } },
          select: {
            productId: true,
            productName: true,
            dose: true,
            packageText: true,
          },
        })
      ).map((product) => [product.productId, product]),
    );

    for (const row of rows) {
      const product = products.get(row.productId);
      const litres = Number(row.aquarium.systemVolumeLiters ?? 0);
      const counted =
        product && litres > 0
          ? runOutDays({
              dose: product.dose,
              packageText: product.packageText,
              aquariumLitres: litres,
            })
          : null;
      if (!product || !counted?.ok) {
        result.uncountable++;
        continue;
      }
      const start = startDay({
        orderDays: await this.orderDays(row.accountId, row.productId),
        consentDay: budapestDay(row.consentAt),
        days: counted.days,
      });
      const step = reminderStep({
        today,
        start,
        days: counted.days,
        remindedForRunOut:
          row.remindedForRunOut?.toISOString().slice(0, 10) ?? null,
      });
      if (step.kind === "LATE") result.late++;
      if (step.kind !== "DUE") continue;

      const claimed = await prisma.reefClubRunOutReminder.updateMany({
        where: {
          id: row.id,
          unsubscribedAt: null,
          OR: [
            { remindClaimedAt: null },
            {
              remindClaimedAt: {
                lt: new Date(now.getTime() - RUNOUT_LEASE_MS),
              },
            },
          ],
        },
        data: { remindClaimedAt: now },
      });
      if (claimed.count === 0) continue;
      try {
        await this.sender.send(
          runOutMail({
            to: row.account.email,
            productName: product.productName,
            packageText: product.packageText,
            aquariumName: row.aquarium.name,
            litres,
            start,
            runsOutOn: step.runsOutOn,
            webUrl: reefClubWebUrl(this.environment),
            unsubscribeKey: unsubscribeKeyFor(
              row.id,
              this.environment[RUNOUT_SECRET_ENV] ?? "",
            ),
          }),
        );
        await prisma.reefClubRunOutReminder.update({
          where: { id: row.id },
          data: {
            remindedForRunOut: new Date(`${step.runsOutOn}T00:00:00Z`),
            remindedAt: new Date(),
            remindStartSource: start.source,
            remindClaimedAt: null,
            remindAttempts: 0,
          },
        });
        result.sent++;
      } catch (error) {
        result.failed++;
        const after = await prisma.reefClubRunOutReminder.update({
          where: { id: row.id },
          data: { remindClaimedAt: null, remindAttempts: { increment: 1 } },
          select: { remindAttempts: true },
        });
        if (after.remindAttempts >= RUNOUT_MAX_ATTEMPTS)
          this.logger.error(
            `REEFCLUB_RUNOUT_REMINDER_FAILED reminder=${row.id}: a kifogyási emlékeztető ${after.remindAttempts} próbálkozás után sem ment ki (${error instanceof Error ? error.message : "ismeretlen hiba"}). Több próba nem lesz.`,
          );
      }
    }
    if (result.late > 0)
      this.logger.warn(
        `${result.late} kifogyási emlékeztető késve: a kifogyás napja már elmúlt vagy ma van, levél nem ment.`,
      );
    return result;
  }

  /**
   * The Budapest days the member's shop orders with the product left the shop: the orders of the customers the account is
   * actively linked to, not cancelled, with a live line of the product; a till sale's completion, else the first status event
   * that says it left the shop. An order that has not left yet has no day.
   */
  private async orderDays(
    accountId: string,
    productId: string,
  ): Promise<string[]> {
    const links = await prisma.reefClubCustomerLink.findMany({
      where: { accountId, status: "ACTIVE" },
      select: { customerId: true },
    });
    if (links.length === 0) return [];
    const orders = await prisma.salesOrder.findMany({
      where: {
        customerId: { in: links.map((link) => link.customerId) },
        status: { not: "CANCELLED" },
        lines: { some: { unasRemovedAt: null, variant: { productId } } },
      },
      select: {
        channel: true,
        completedAt: true,
        businessStatusEvents: {
          where: { toStatus: { in: [...LEFT_THE_SHOP] } },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    });
    const days: string[] = [];
    for (const order of orders) {
      const left =
        order.channel === "POS" && order.completedAt
          ? order.completedAt
          : order.businessStatusEvents[0]?.createdAt;
      if (left) days.push(budapestDay(left));
    }
    return days;
  }
}
