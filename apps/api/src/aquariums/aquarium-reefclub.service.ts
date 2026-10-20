import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import {
  NotificationLogRepository,
  type NotificationAttempt,
} from "../notifications/notification-log.repository.js";
import {
  MAIL_SENDER,
  type MailSender,
  type OutgoingMail,
} from "../notifications/mail/mail.port.js";
import { formatMailFrom } from "../notifications/mail/mime.js";
import {
  hashLinkCode,
  LINK_CODE_TTL_MS,
  newLinkCode,
  normalizeLinkCode,
} from "../reefclub/reefclub-link-code.js";
import { reefClubWebUrl } from "../reefclub/reefclub-mail.js";
import { requireInternalWriter } from "../worksheets/worksheet-internal-write.js";
import {
  linkCodeMail,
  linkNoticeMail,
  releaseMail,
} from "./reefclub-shop-mail.js";

/**
 * THE OS SIDE OF THE REEFCLUB SHOP LINK (ReefClub plan v6.1, 3.3 and 3.5;
 * slice 5): the colleague issues a code to a private-person customer, sees and
 * ends that customer's links, and the process tells the customer about every
 * new link and the linked accounts about every release.
 *
 * Every step is internal (`requireInternalWriter`): a partner-portal user
 * cannot issue a code, end a link or release a measurement.
 *
 * THE NOTICE OF A NEW LINK IS SENT FROM HERE, NOT FROM THE REEFCLUB: the link
 * is made in the ReefClub process, but from slice 6 that process cannot read
 * the customer's e-mail address (the column-level role, plan 2.1). So the
 * link row carries `customerNoticeAt`, and this process sends the notice for
 * every row where it is empty, once a minute (`sweepLinkNotices`).
 *
 * THE NOTICE MUST NOT BE LOST QUIETLY (barracuda, #1725 review): it is what
 * makes a code in the wrong hands noticeable. So:
 *   - the claim is a LEASE (`customerNoticeClaimedAt`), taken with a
 *     conditional update so two processes do not both send; a claim older
 *     than `LINK_NOTICE_LEASE_MS` is taken again, so a process that stopped
 *     between claim and send (deploy, OOM) does not leave the row looking
 *     sent;
 *   - `customerNoticeAt` is written only after a successful send;
 *   - a failed send gives the lease back and counts an attempt; the last one
 *     writes an error line (`REEFCLUB_LINK_NOTICE_FAILED`, with the link id),
 *     and the internal link list shows `noticeFailed`.
 * At least once, not exactly once: a process that stops after the send and
 * before the mark sends it again after the lease.
 */
export const LINK_NOTICE_INTERVAL_MS = 60_000;
export const LINK_NOTICE_MAX_ATTEMPTS = 5;
export const LINK_NOTICE_LEASE_MS = 10 * 60_000;

/**
 * The shop's measurement sender (Balázs, 2026-09-24: the water-measurement
 * e-mail goes from info@), the same variables as
 * `AquariumMeasurementMailService`. Unset: the sender's own default.
 */
function fromShop(
  mail: OutgoingMail,
  environment: NodeJS.ProcessEnv = process.env,
): OutgoingMail {
  const address = environment.AQUARIUM_MEASUREMENT_MAIL_FROM?.trim();
  if (!address) return mail;
  return {
    ...mail,
    from: formatMailFrom(
      environment.AQUARIUM_MEASUREMENT_MAIL_FROM_NAME?.trim() ||
        "Acropora Kft.",
      address,
    ),
  };
}

export interface IssuedLinkCode {
  code: string;
  expiresAt: string;
  emailedTo?: string;
}

export interface CustomerReefClubLink {
  id: string;
  accountEmail: string;
  status: "ACTIVE" | "ENDED";
  createdAt: string;
  endedAt?: string;
  endedBy?: "ACCOUNT" | "SHOP";
  /** When the customer was told about this link; missing: not yet. */
  noticeSentAt?: string;
  /** Every attempt failed: the customer was NOT told, and no more tries come. */
  noticeFailed: boolean;
}

@Injectable()
export class AquariumReefClubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AquariumReefClubService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly log: NotificationLogRepository,
    @Optional()
    @Inject(MAIL_SENDER)
    private readonly sender: MailSender | null = null,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.sweepLinkNotices().catch((error: unknown) =>
        this.logger.warn(
          `A ReefClub-összerendelés értesítése elbukott: ${error instanceof Error ? error.message : "ismeretlen hiba"}`,
        ),
      );
    }, LINK_NOTICE_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * A NEW CODE FOR A PRIVATE-PERSON CUSTOMER (plan 3.3). The customer must
   * have an e-mail address: every link made with the code is told there, and
   * without it a code in the wrong hands would go unnoticed. The raw code is
   * in this answer once (and in the e-mail when asked); only its hash is
   * stored.
   */
  async issueCode(
    customerId: string,
    sendEmail: boolean,
    user: AuthenticatedUser,
  ): Promise<IssuedLinkCode> {
    requireInternalWriter(user, "ReefClub-kód kiadása");
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        type: true,
        isActive: true,
        displayName: true,
        email: true,
      },
    });
    if (!customer || !customer.isActive)
      throw new NotFoundException("Az ügyfél nem található.");
    if (customer.type !== "PERSON")
      throw new BadRequestException(
        "ReefClub-kód csak magánszemély vevőnek adható ki: egy cég akváriumai nem kerülhetnek magánfiókba.",
      );
    const email = customer.email?.trim();
    if (!email)
      throw new BadRequestException(
        "A vevőnek nincs e-mail címe. ReefClub-kód csak e-mail címmel adható ki, mert minden új összekapcsolásról értesítést kap.",
      );

    const code = newLinkCode();
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    await prisma.reefClubLinkCode.create({
      data: {
        customerId: customer.id,
        codeHash: hashLinkCode(normalizeLinkCode(code)!),
        expiresAt,
        issuedById: user.id,
      },
    });
    if (!sendEmail) return { code, expiresAt: expiresAt.toISOString() };

    if (!this.sender)
      throw new BadRequestException(
        "Az e-mail küldés jelenleg nincs beállítva; a kód a képernyőn érvényes.",
      );
    await this.sender.send(
      fromShop(
        linkCodeMail({
          to: email,
          customerName: customer.displayName,
          code,
          expiresAt,
          webUrl: reefClubWebUrl(),
        }),
      ),
    );
    return { code, expiresAt: expiresAt.toISOString(), emailedTo: email };
  }

  async links(
    customerId: string,
    user: AuthenticatedUser,
  ): Promise<CustomerReefClubLink[]> {
    requireInternalWriter(user, "ReefClub-összekapcsolások megtekintése");
    const rows = await prisma.reefClubCustomerLink.findMany({
      where: { customerId },
      select: {
        id: true,
        status: true,
        createdAt: true,
        endedAt: true,
        endedBy: true,
        customerNoticeAt: true,
        customerNoticeAttempts: true,
        account: { select: { email: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    return rows.map((row) => ({
      id: row.id,
      accountEmail: row.account.email,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      ...(row.endedAt ? { endedAt: row.endedAt.toISOString() } : {}),
      ...(row.endedBy ? { endedBy: row.endedBy } : {}),
      ...(row.customerNoticeAt
        ? { noticeSentAt: row.customerNoticeAt.toISOString() }
        : {}),
      noticeFailed:
        !row.customerNoticeAt &&
        row.customerNoticeAttempts >= LINK_NOTICE_MAX_ATTEMPTS,
    }));
  }

  /** The shop ends a link (for example because the customer did not make it). */
  async endLink(
    customerId: string,
    linkId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    requireInternalWriter(user, "ReefClub-összekapcsolás megszüntetése");
    const { count } = await prisma.reefClubCustomerLink.updateMany({
      where: { id: linkId, customerId, status: "ACTIVE" },
      data: {
        status: "ENDED",
        endedAt: new Date(),
        endedBy: "SHOP",
        endedByUserId: user.id,
      },
    });
    if (count === 0)
      throw new NotFoundException("Az aktív összekapcsolás nem található.");
  }

  /**
   * THE RELEASE E-MAIL (plan 3.5): to every account with an active link to
   * the customer that asked for it and has a confirmed address. No value in
   * it, only a link. Each send is tried on its own; the outcome goes to the
   * notification log.
   */
  async notifyRelease(input: {
    aquariumId: string;
    aquariumName: string;
    customerId: string;
  }): Promise<void> {
    const accounts = await prisma.reefClubAccount.findMany({
      where: {
        notifyOnRelease: true,
        emailVerifiedAt: { not: null },
        customerLinks: {
          some: { customerId: input.customerId, status: "ACTIVE" },
        },
      },
      select: { id: true, email: true },
    });
    const attempts: NotificationAttempt[] = [];
    for (const account of accounts) {
      if (!this.sender) {
        attempts.push({
          userId: account.id,
          delivered: false,
          reason: "MAIL_NOT_CONFIGURED",
        });
        continue;
      }
      try {
        await this.sender.send(
          fromShop(
            releaseMail({
              to: account.email,
              aquariumName: input.aquariumName,
              aquariumId: input.aquariumId,
              webUrl: reefClubWebUrl(),
            }),
          ),
        );
        attempts.push({ userId: account.id, delivered: true });
      } catch (error) {
        attempts.push({
          userId: account.id,
          delivered: false,
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    await this.log.recordReefClubRelease({
      aquariumId: input.aquariumId,
      attempts,
    });
  }

  /** One pass over the links whose customer has not been told yet. */
  async sweepLinkNotices(now = new Date()): Promise<number> {
    const pending = await prisma.reefClubCustomerLink.findMany({
      where: claimableNotice(now),
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    let sent = 0;
    for (const { id } of pending)
      if (await this.sendLinkNotice(id, now)) sent++;
    return sent;
  }

  private async sendLinkNotice(linkId: string, now: Date): Promise<boolean> {
    const claimed = await prisma.reefClubCustomerLink.updateMany({
      where: { id: linkId, ...claimableNotice(now) },
      data: { customerNoticeClaimedAt: now },
    });
    if (claimed.count === 0) return false;
    const link = await prisma.reefClubCustomerLink.findUniqueOrThrow({
      where: { id: linkId },
      select: {
        customerId: true,
        createdAt: true,
        account: { select: { email: true } },
        customer: { select: { displayName: true, email: true } },
      },
    });
    const to = link.customer.email?.trim();
    let attempt: NotificationAttempt;
    try {
      if (!to) throw new Error("A vevőnek nincs e-mail címe.");
      if (!this.sender) throw new Error("MAIL_NOT_CONFIGURED");
      await this.sender.send(
        fromShop(
          linkNoticeMail({
            to,
            customerName: link.customer.displayName,
            accountEmail: link.account.email,
            linkedAt: link.createdAt,
            shopAddress: process.env.AQUARIUM_MEASUREMENT_MAIL_FROM?.trim(),
          }),
        ),
      );
      await prisma.reefClubCustomerLink.update({
        where: { id: linkId },
        data: { customerNoticeAt: new Date() },
      });
      attempt = { userId: link.customerId, delivered: true };
    } catch (error) {
      // The lease goes back, with one more attempt counted.
      const after = await prisma.reefClubCustomerLink.update({
        where: { id: linkId },
        data: {
          customerNoticeClaimedAt: null,
          customerNoticeAttempts: { increment: 1 },
        },
        select: { customerNoticeAttempts: true },
      });
      if (after.customerNoticeAttempts >= LINK_NOTICE_MAX_ATTEMPTS)
        this.logger.error(
          `REEFCLUB_LINK_NOTICE_FAILED link=${linkId}: az új összekapcsolásról a vevő ${after.customerNoticeAttempts} próbálkozás után sem kapott értesítést (${error instanceof Error ? error.message : "ismeretlen hiba"}). Több próba nem lesz.`,
        );
      attempt = {
        userId: link.customerId,
        delivered: false,
        reason: error instanceof Error ? error.message : "unknown",
      };
    }
    await this.log.recordReefClubLinkNotice({ linkId, attempts: [attempt] });
    return attempt.delivered;
  }
}

/** A notice not sent yet, with tries left, and no live lease on it. */
function claimableNotice(now: Date) {
  return {
    customerNoticeAt: null,
    customerNoticeAttempts: { lt: LINK_NOTICE_MAX_ATTEMPTS },
    OR: [
      { customerNoticeClaimedAt: null },
      {
        customerNoticeClaimedAt: {
          lt: new Date(now.getTime() - LINK_NOTICE_LEASE_MS),
        },
      },
    ],
  };
}
