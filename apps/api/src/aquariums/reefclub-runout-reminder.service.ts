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
export const RUNOUT_BATCH = 200;
/** The sending window, Budapest hours: from 09:00 up to 20:00 (acrobot 45563). */
export const RUNOUT_WINDOW = { from: 9, until: 20 } as const;
/** The business statuses that mean the order left the shop (or waits at the counter). */
const LEFT_THE_SHOP = ["SHIPPING", "READY_FOR_PICKUP", "CLOSED"] as const;

export interface RunOutSweep {
  /** Why nothing was read: a closed lock, no ReefClub sender on this process, or outside the sending window. */
  closed:
    "off" | "no-text" | "no-secret" | "no-sender" | "outside-window" | null;
  sent: number;
  failed: number;
  late: number;
  /** Rows the reminder cannot count now (no countable product, no litres). */
  uncountable: number;
  /** Due rows whose attempts for this run-out day are used up. */
  givenUp: number;
}

type SweepRow = {
  id: string;
  accountId: string;
  productId: string;
  consentAt: Date;
  remindedForRunOut: Date | null;
  remindAttempts: number;
  remindAttemptsFor: Date | null;
  account: { email: string };
  aquarium: { name: string; systemVolumeLiters: unknown };
};

const dayOf = (moment: Date | null): string | null =>
  moment ? moment.toISOString().slice(0, 10) : null;

/** Whether the moment is inside the sending window, in Budapest hours. */
export function inSendingWindow(moment: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Budapest",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(moment),
  );
  return hour >= RUNOUT_WINDOW.from && hour < RUNOUT_WINDOW.until;
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
 * and the last one writes `REEFCLUB_RUNOUT_REMINDER_FAILED`; the attempts count for one run-out day, so a new cycle starts with
 * a full set. At least once, not exactly once. It sends only between 09:00 and 20:00 Budapest time (acrobot 45563); a reminder
 * due at night goes in the next window.
 */
@Injectable()
export class ReefClubRunOutReminderService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ReefClubRunOutReminderService.name);
  private timer: NodeJS.Timeout | null = null;
  /** The test replaces it; production reads the process environment. */
  environment: Record<string, string | undefined> = process.env;
  /** The page size; the test makes it small, to measure the paging. */
  batch = RUNOUT_BATCH;
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
      givenUp: 0,
    };
    const availability = this.availability();
    if (availability.kind !== "available")
      return { ...result, closed: availability.kind };
    if (!this.sender) return { ...result, closed: "no-sender" };
    // not at night (acrobot 45563): a reminder due outside the window goes in the next one
    if (!inSendingWindow(now)) return { ...result, closed: "outside-window" };

    const today = budapestDay(now);
    // EVERY ROW, PAGE BY PAGE (barracuda, #2349): a row that sends nothing this round (waiting, sent, late, uncountable) stays
    // in the query, so one fixed page would bring back the same rows every hour and the ones after them would never be reached.
    let after: string | null = null;
    for (;;) {
      const rows = await prisma.reefClubRunOutReminder.findMany({
        where: {
          ...(after ? { id: { gt: after } } : {}),
          unsubscribedAt: null,
          account: {
            deletionRequestedAt: null,
            emailVerifiedAt: { not: null },
          },
          OR: [
            { remindClaimedAt: null },
            {
              remindClaimedAt: {
                lt: new Date(now.getTime() - RUNOUT_LEASE_MS),
              },
            },
          ],
        },
        select: {
          id: true,
          accountId: true,
          productId: true,
          consentAt: true,
          remindedForRunOut: true,
          remindAttempts: true,
          remindAttemptsFor: true,
          account: { select: { email: true } },
          aquarium: { select: { name: true, systemVolumeLiters: true } },
        },
        orderBy: { id: "asc" },
        take: this.batch,
      });
      if (rows.length > 0) await this.sendPage(rows, today, now, result);
      if (rows.length < this.batch) break;
      after = rows[rows.length - 1]!.id;
    }
    if (result.late > 0)
      this.logger.warn(
        `${result.late} kifogyási emlékeztető késve: a kifogyás napja már elmúlt vagy ma van, levél nem ment.`,
      );
    return result;
  }

  private async sendPage(
    rows: readonly SweepRow[],
    today: string,
    now: Date,
    result: RunOutSweep,
  ): Promise<void> {
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
        remindedForRunOut: dayOf(row.remindedForRunOut),
      });
      if (step.kind === "LATE") result.late++;
      if (step.kind !== "DUE") continue;
      // the attempts count for ONE run-out day (barracuda, #2349): a new cycle starts with a full set
      const attempts =
        dayOf(row.remindAttemptsFor) === step.runsOutOn
          ? row.remindAttempts
          : 0;
      if (attempts >= RUNOUT_MAX_ATTEMPTS) {
        result.givenUp++;
        continue;
      }

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
        await this.sender!.send(
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
            remindAttemptsFor: null,
          },
        });
        result.sent++;
      } catch (error) {
        result.failed++;
        const failed = attempts + 1;
        await prisma.reefClubRunOutReminder.update({
          where: { id: row.id },
          data: {
            remindClaimedAt: null,
            remindAttempts: failed,
            remindAttemptsFor: new Date(`${step.runsOutOn}T00:00:00Z`),
          },
        });
        if (failed >= RUNOUT_MAX_ATTEMPTS)
          this.logger.error(
            `REEFCLUB_RUNOUT_REMINDER_FAILED reminder=${row.id} runsOutOn=${step.runsOutOn}: a kifogyási emlékeztető ${failed} próbálkozás után sem ment ki (${error instanceof Error ? error.message : "ismeretlen hiba"}). Erre a kifogyási napra több próba nem lesz.`,
          );
      }
    }
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
