import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";

import { reefClubNotFound } from "./reefclub-aquarium-access.js";
import { ReefClubDatabase } from "./reefclub-database.js";
import { hashLinkCode, normalizeLinkCode } from "./reefclub-link-code.js";
import { ReefClubRateLimits } from "./reefclub-rate-limits.js";

/**
 * THE SHOP LINK, FROM THE REEFCLUB SIDE (plan v6.1, 3.3; slice 5): redeeming
 * a code the shop issued, listing the active links, ending one.
 *
 * A REDEMPTION IS ONE DATABASE FUNCTION (`reefclub_redeem_link_code`): the
 * code is claimed with a conditional update (unused, unexpired, issued to a
 * private person), and the link is written in the same call. Two redemptions
 * of one code at the same moment: the second claim matches nothing after the
 * first commits, and gets the same answer as an unknown code.
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
      ? await this.claim(accountId, hashLinkCode(normalized))
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
   * The claim and the link, in one database function
   * (`reefclub_redeem_link_code`, migration 20261021000000): the ReefClub
   * role neither reads nor writes the code table, so it cannot claim a code
   * whose hash it was not given (barracuda, #1748). The function claims an
   * unused, unexpired code of an active person customer once; an active link
   * of the same account and customer is answered with that link (the code is
   * spent either way), otherwise it writes one. Two redemptions at the same
   * moment meet on the partial unique index there, not here. No row: the one
   * wrong-code answer.
   */
  private async claim(
    accountId: string,
    codeHash: string,
  ): Promise<ReefClubShopLink | null> {
    const rows = await this.database.$queryRaw<
      { linkId: string; createdAt: Date; customerName: string }[]
    >`SELECT "linkId", "createdAt", "customerName" FROM "reefclub_redeem_link_code"(${codeHash}, ${accountId})`;
    const row = rows[0];
    return row
      ? {
          id: row.linkId,
          customerName: row.customerName,
          createdAt: row.createdAt.toISOString(),
        }
      : null;
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
