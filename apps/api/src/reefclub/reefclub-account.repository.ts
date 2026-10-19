import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@acropora/database";

import { hashSessionToken } from "../auth/session-token.util.js";
import { ReefClubDatabase } from "./reefclub-database.js";

export type ReefClubTokenPurpose = "EMAIL_VERIFICATION" | "PASSWORD_RESET";

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export interface ReefClubAccountRecord {
  id: string;
  email: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  notifyOnRelease: boolean;
  consentVersion: string;
}

const ACCOUNT_FIELDS = {
  id: true,
  email: true,
  passwordHash: true,
  emailVerifiedAt: true,
  notifyOnRelease: true,
  consentVersion: true,
} as const;

function ttlFor(purpose: ReefClubTokenPurpose): number {
  return purpose === "EMAIL_VERIFICATION"
    ? EMAIL_VERIFICATION_TTL_MS
    : PASSWORD_RESET_TTL_MS;
}

/**
 * The ReefClub account and its single-use e-mail tokens.
 *
 * A TOKEN IS CONSUMED AND ITS EFFECT APPLIED IN ONE TRANSACTION, and the claim
 * is a conditional update (`usedAt` still empty), not a read followed by a
 * write. Two clicks on the same link at the same moment both find the row; the
 * second update waits for the first to commit, then matches nothing, and that
 * click gets the same answer as an unknown token.
 */
@Injectable()
export class ReefClubAccountRepository {
  constructor(
    @Inject(ReefClubDatabase) private readonly database: ReefClubDatabase,
  ) {}

  findByEmail(email: string): Promise<ReefClubAccountRecord | null> {
    return this.database.reefClubAccount.findUnique({
      where: { email },
      select: ACCOUNT_FIELDS,
    });
  }

  findById(id: string): Promise<ReefClubAccountRecord | null> {
    return this.database.reefClubAccount.findUnique({
      where: { id },
      select: ACCOUNT_FIELDS,
    });
  }

  /**
   * A new, unverified account with its first verification token. Null when the
   * e-mail was taken in the meantime (two registrations racing): the caller
   * treats that as "already exists", which it is.
   */
  async createUnverified(input: {
    email: string;
    passwordHash: string;
    consentVersion: string;
    token: string;
  }): Promise<string | null> {
    try {
      return await this.database.$transaction(async (tx) => {
        const account = await tx.reefClubAccount.create({
          data: {
            email: input.email,
            passwordHash: input.passwordHash,
            consentVersion: input.consentVersion,
            consentAt: new Date(),
          },
          select: { id: true },
        });
        await tx.reefClubAccountToken.create({
          data: tokenRow(account.id, "EMAIL_VERIFICATION", input.token),
        });
        return account.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return null;
      throw error;
    }
  }

  /**
   * A SECOND REGISTRATION ON AN UNVERIFIED ACCOUNT replaces the password and
   * the consent, and voids every earlier verification link. Without this, a
   * stranger who registered someone else's address first would set the
   * password that the owner's click then confirms. With it, only the latest
   * registration's link works. The residue is a race between two people who
   * both keep registering the same address; the rate limits bound it.
   *
   * Verified accounts are never touched here (`emailVerifiedAt: null` is part
   * of the condition): a registration cannot reset a working account's password.
   */
  async replaceUnverifiedCredentials(input: {
    accountId: string;
    passwordHash: string;
    consentVersion: string;
    token: string;
  }): Promise<boolean> {
    return this.database.$transaction(async (tx) => {
      const updated = await tx.reefClubAccount.updateMany({
        where: { id: input.accountId, emailVerifiedAt: null },
        data: {
          passwordHash: input.passwordHash,
          consentVersion: input.consentVersion,
          consentAt: new Date(),
        },
      });
      if (updated.count !== 1) return false;
      await tx.reefClubAccountToken.deleteMany({
        where: {
          accountId: input.accountId,
          purpose: "EMAIL_VERIFICATION",
          usedAt: null,
        },
      });
      await tx.reefClubAccountToken.create({
        data: tokenRow(input.accountId, "EMAIL_VERIFICATION", input.token),
      });
      return true;
    });
  }

  /** A fresh reset token; every earlier unused one is voided. */
  async issuePasswordReset(accountId: string, token: string): Promise<void> {
    await this.database.$transaction(async (tx) => {
      await tx.reefClubAccountToken.deleteMany({
        where: { accountId, purpose: "PASSWORD_RESET", usedAt: null },
      });
      await tx.reefClubAccountToken.create({
        data: tokenRow(accountId, "PASSWORD_RESET", token),
      });
    });
  }

  /** Marks the e-mail verified. False for an unknown, used or expired token. */
  verifyEmail(token: string): Promise<boolean> {
    return this.consume(token, "EMAIL_VERIFICATION", async (tx, accountId) => {
      await tx.reefClubAccount.updateMany({
        where: { id: accountId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
    });
  }

  /**
   * Sets the new password and ends EVERY session of the account (plan 3.2).
   * A reset link proves control of the mailbox, so an unverified address
   * becomes verified by it.
   */
  resetPassword(token: string, passwordHash: string): Promise<boolean> {
    return this.consume(token, "PASSWORD_RESET", async (tx, accountId) => {
      const now = new Date();
      await tx.reefClubAccount.update({
        where: { id: accountId },
        data: { passwordHash },
      });
      await tx.reefClubAccount.updateMany({
        where: { id: accountId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
      await tx.reefClubSession.deleteMany({ where: { accountId } });
    });
  }

  async updateNotifyOnRelease(
    accountId: string,
    notifyOnRelease: boolean,
  ): Promise<ReefClubAccountRecord> {
    return this.database.reefClubAccount.update({
      where: { id: accountId },
      data: { notifyOnRelease },
      select: ACCOUNT_FIELDS,
    });
  }

  private async consume(
    token: string,
    purpose: ReefClubTokenPurpose,
    effect: (tx: Prisma.TransactionClient, accountId: string) => Promise<void>,
  ): Promise<boolean> {
    const tokenHash = hashSessionToken(token);
    return this.database.$transaction(async (tx) => {
      const now = new Date();
      const row = await tx.reefClubAccountToken.findUnique({
        where: { tokenHash },
        select: { id: true, accountId: true },
      });
      if (!row) return false;
      const claimed = await tx.reefClubAccountToken.updateMany({
        where: {
          id: row.id,
          purpose,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) return false;
      await effect(tx, row.accountId);
      // The other open links of the same kind die with this one.
      await tx.reefClubAccountToken.deleteMany({
        where: { accountId: row.accountId, purpose, usedAt: null },
      });
      return true;
    });
  }
}

function tokenRow(
  accountId: string,
  purpose: ReefClubTokenPurpose,
  token: string,
) {
  return {
    accountId,
    purpose,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + ttlFor(purpose)),
  };
}
