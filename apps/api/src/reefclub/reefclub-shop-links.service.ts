import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";

import { isPrismaErrorCode } from "../common/prisma-error.util.js";
import { reefClubNotFound } from "./reefclub-aquarium-access.js";
import { ReefClubDatabase } from "./reefclub-database.js";
import { hashLinkCode, normalizeLinkCode } from "./reefclub-link-code.js";
import { ReefClubRateLimits } from "./reefclub-rate-limits.js";

/**
 * THE SHOP LINK, FROM THE REEFCLUB SIDE (plan v6.1, 3.3; slice 5): redeeming
 * a code the shop issued, listing the active links, ending one.
 *
 * A REDEMPTION IS ONE TRANSACTION: the code is claimed with a conditional
 * update (unused, unexpired, issued to a private person), and the link is
 * written in the same transaction. Two redemptions of one code at the same
 * moment both find the row; the second claim matches nothing after the first
 * commits, and gets the same answer as an unknown code.
 *
 * EVERY WRONG CODE GETS ONE ANSWER (unknown, expired, used, a company's), so
 * a guess learns nothing about which codes exist. Five wrong ones in an hour
 * lock the account's redemption for the rest of the hour, twenty lock the
 * address; past the overall threshold the alarm is logged
 * (`REEFCLUB_LINK_ALARM`).
 *
 * The customer is told about every new link by e-mail, but not from here: the
 * internal process sends it (`ReefClubLinkNoticeSender`), because from slice 6
 * the ReefClub role cannot read a customer's e-mail address. The answer only
 * carries what the plan lets the ReefClub see of a customer: the display name.
 */
export interface ReefClubShopLink {
  id: string;
  customerName: string;
  createdAt: string;
}

const WRONG_CODE_MESSAGE = "A kód érvénytelen, lejárt vagy már felhasználták.";

@Injectable()
export class ReefClubShopLinksService {
  private readonly logger = new Logger(ReefClubShopLinksService.name);

  constructor(
    @Inject(ReefClubDatabase) private readonly database: ReefClubDatabase,
    private readonly limits: ReefClubRateLimits,
  ) {}

  async redeem(
    accountId: string,
    address: string,
    input: string,
  ): Promise<ReefClubShopLink> {
    if (
      this.limits.shopLinkFailuresByAccount.locked(accountId) ||
      this.limits.shopLinkFailuresByAddress.locked(address)
    )
      throw new HttpException(
        "Túl sok hibás kód. Próbáld újra egy óra múlva.",
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const normalized = normalizeLinkCode(input);
    const link = normalized
      ? await this.claimOnce(accountId, hashLinkCode(normalized))
      : null;
    if (!link) {
      this.limits.shopLinkFailuresByAccount.fail(accountId);
      this.limits.shopLinkFailuresByAddress.fail(address);
      const overall = this.limits.shopLinkFailuresOverall.fail("all");
      if (this.limits.shopLinkFailuresOverall.locked("all"))
        this.logger.error(
          `REEFCLUB_LINK_ALARM: ${overall} hibás összerendelési kód az elmúlt órában (minden hívó együtt).`,
        );
      throw new BadRequestException(WRONG_CODE_MESSAGE);
    }
    return link;
  }

  async list(accountId: string): Promise<ReefClubShopLink[]> {
    const rows = await this.database.reefClubCustomerLink.findMany({
      where: { accountId, status: "ACTIVE" },
      select: {
        id: true,
        createdAt: true,
        customer: { select: { displayName: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toShopLink);
  }

  /** Ends the account's own active link; anything else is the one 404. */
  async end(accountId: string, linkId: string): Promise<void> {
    const { count } = await this.database.reefClubCustomerLink.updateMany({
      where: { id: linkId, accountId, status: "ACTIVE" },
      data: { status: "ENDED", endedAt: new Date(), endedBy: "ACCOUNT" },
    });
    if (count === 0) throw reefClubNotFound();
  }

  /**
   * Two codes of one customer redeemed by one account at the same moment
   * both find no active link; the second insert then meets the partial
   * unique index (`ReefClubCustomerLink_active_key`) and its transaction,
   * the claim included, rolls back. One retry finds the link the first one
   * wrote.
   */
  private async claimOnce(
    accountId: string,
    codeHash: string,
  ): Promise<ReefClubShopLink | null> {
    try {
      return await this.claim(accountId, codeHash);
    } catch (error) {
      // Any unique violation in this transaction is that index: the code
      // row is only updated, and a claimed code has no second link. Its
      // target names the index, not the columns, since Prisma's schema does
      // not know a partial index.
      if (!isPrismaErrorCode(error, "P2002")) throw error;
      return this.claim(accountId, codeHash);
    }
  }

  /**
   * The claim and the link. An active link of the same account and customer
   * already there (a second code for the same customer) is answered with
   * that link; the code is spent either way.
   */
  private async claim(
    accountId: string,
    codeHash: string,
  ): Promise<ReefClubShopLink | null> {
    return this.database.$transaction(async (tx) => {
      const now = new Date();
      const code = await tx.reefClubLinkCode.findUnique({
        where: { codeHash },
        select: { id: true, customerId: true },
      });
      if (!code) return null;
      const claimed = await tx.reefClubLinkCode.updateMany({
        where: {
          id: code.id,
          usedAt: null,
          expiresAt: { gt: now },
          customer: { type: "PERSON", isActive: true },
        },
        data: { usedAt: now, usedByAccountId: accountId },
      });
      if (claimed.count === 0) return null;

      const existing = await tx.reefClubCustomerLink.findFirst({
        where: { accountId, customerId: code.customerId, status: "ACTIVE" },
        select: {
          id: true,
          createdAt: true,
          customer: { select: { displayName: true } },
        },
      });
      if (existing) return toShopLink(existing);
      const created = await tx.reefClubCustomerLink.create({
        data: { accountId, customerId: code.customerId, codeId: code.id },
        select: {
          id: true,
          createdAt: true,
          customer: { select: { displayName: true } },
        },
      });
      return toShopLink(created);
    });
  }
}

function toShopLink(row: {
  id: string;
  createdAt: Date;
  customer: { displayName: string };
}): ReefClubShopLink {
  return {
    id: row.id,
    customerName: row.customer.displayName,
    createdAt: row.createdAt.toISOString(),
  };
}
