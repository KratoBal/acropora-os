import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";

import { verifyPassword } from "../users/password.util.js";
import { ReefClubDatabase } from "./reefclub-database.js";
import { ReefClubExternalAuthService } from "./reefclub-external-auth.service.js";

/**
 * ACCOUNT DELETION (ReefClub plan v6.1, 4.5; slice 6).
 *
 * THE REQUEST needs a fresh sign-in: the password, or a Google or Apple token
 * of the account's own external account issued in the last ten minutes. A
 * stolen session alone cannot delete an account. Then, in one transaction:
 *   - the account is locked (`deletionRequestedAt`): no sign-in path finds it
 *     (`ReefClubAccountRepository`), and its sessions and e-mail tokens go;
 *   - its shop links end (the shop's own records stay: the customer, the shop
 *     aquariums and the shop measurements are the shop's, plan 4.5);
 *   - its shared aquariums are revoked, logged, so the shop stops seeing them
 *     at once;
 *   - the request is logged in `ReefClubAccountDeletion`.
 *
 * THE DELETION runs `REEFCLUB_DELETION_GRACE_MS` (30 days) later, from the
 * hourly sweep: the account row goes, and with it (Cascade) its own
 * aquariums, their measurements and targets, its external sign-ins and its
 * links. The log row stays, with the moment of the deletion.
 */
export const REEFCLUB_DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
export const REEFCLUB_DELETION_SWEEP_MS = 60 * 60 * 1000;
/** How old a Google or Apple token may be to count as a fresh sign-in. */
export const REEFCLUB_DELETION_REAUTH_MAX_AGE_SECONDS = 10 * 60;

export type ReefClubReauth =
  | { method: "PASSWORD"; password: string }
  | { method: "GOOGLE"; idToken: string }
  | { method: "APPLE"; idToken: string; nonce: string };

const REAUTH_REFUSED = "A megerősítés nem sikerült.";

@Injectable()
export class ReefClubAccountDeletionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ReefClubAccountDeletionService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ReefClubDatabase) private readonly database: ReefClubDatabase,
    private readonly external: ReefClubExternalAuthService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.sweep().catch((error: unknown) =>
        this.logger.warn(
          `A ReefClub-fiókok végleges törlése elbukott: ${error instanceof Error ? error.message : "ismeretlen hiba"}`,
        ),
      );
    }, REEFCLUB_DELETION_SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async request(accountId: string, reauth: ReefClubReauth): Promise<void> {
    await this.confirm(accountId, reauth);
    const now = new Date();
    await this.database.$transaction(async (tx) => {
      const locked = await tx.reefClubAccount.updateMany({
        where: { id: accountId, deletionRequestedAt: null },
        data: { deletionRequestedAt: now },
      });
      // A second request (two tabs) finds the account already locked.
      if (locked.count === 0) return;
      await tx.reefClubSession.deleteMany({ where: { accountId } });
      await tx.reefClubAccountToken.deleteMany({ where: { accountId } });
      await tx.reefClubCustomerLink.updateMany({
        where: { accountId, status: "ACTIVE" },
        data: { status: "ENDED", endedAt: now, endedBy: "ACCOUNT" },
      });
      const shared = await tx.aquarium.findMany({
        where: { ownerAccountId: accountId, sharedWithShopAt: { not: null } },
        select: { id: true },
      });
      if (shared.length > 0) {
        await tx.aquarium.updateMany({
          where: { id: { in: shared.map((row) => row.id) } },
          data: { sharedWithShopAt: null, shareConsentVersion: null },
        });
        await tx.aquariumShareEvent.createMany({
          data: shared.map((row) => ({
            aquariumId: row.id,
            kind: "REVOKED" as const,
            accountId,
          })),
        });
      }
      await tx.reefClubAccountDeletion.create({
        data: { accountId, requestedAt: now },
      });
    });
  }

  /**
   * The final deletion of every account whose grace period is over. Returns
   * how many went. The condition is read again in the delete, so an account
   * whose lock was lifted by hand in the meantime is not deleted.
   */
  async sweep(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - REEFCLUB_DELETION_GRACE_MS);
    const due = await this.database.reefClubAccount.findMany({
      where: { deletionRequestedAt: { lte: before } },
      select: { id: true },
      take: 100,
    });
    let deleted = 0;
    for (const { id } of due) {
      const gone = await this.database.$transaction(async (tx) => {
        const { count } = await tx.reefClubAccount.deleteMany({
          where: { id, deletionRequestedAt: { lte: before } },
        });
        if (count === 1)
          await tx.reefClubAccountDeletion.updateMany({
            where: { accountId: id, completedAt: null },
            data: { completedAt: now },
          });
        return count;
      });
      deleted += gone;
    }
    if (deleted > 0)
      this.logger.log(`Véglegesen törölt ReefClub-fiók: ${deleted}.`);
    return deleted;
  }

  private async confirm(
    accountId: string,
    reauth: ReefClubReauth,
  ): Promise<void> {
    if (reauth.method === "PASSWORD") {
      const account = await this.database.reefClubAccount.findFirst({
        where: { id: accountId, deletionRequestedAt: null },
        select: { passwordHash: true },
      });
      if (
        !account?.passwordHash ||
        !(await verifyPassword(reauth.password, account.passwordHash))
      )
        throw new UnauthorizedException(REAUTH_REFUSED);
      return;
    }
    await this.external.confirmOwn(accountId, reauth.method, reauth.idToken, {
      nonce: reauth.method === "APPLE" ? reauth.nonce : undefined,
      maxAgeSeconds: REEFCLUB_DELETION_REAUTH_MAX_AGE_SECONDS,
    });
  }
}
