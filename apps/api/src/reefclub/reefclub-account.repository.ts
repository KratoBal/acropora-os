import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@acropora/database";

import { hashSessionToken } from "../auth/session-token.util.js";
import { ReefClubDatabase } from "./reefclub-database.js";

export type ReefClubTokenPurpose = "EMAIL_VERIFICATION" | "PASSWORD_RESET";
export type ReefClubIdentityProvider = "GOOGLE" | "APPLE";

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

  /*
    AN ACCOUNT LOCKED FOR DELETION IS NOT FOUND (plan v6.1, 4.5; slice 6): the
    three lookups every sign-in path starts from leave it out, so a password,
    a Google or an Apple sign-in, a password reset and a registration on its
    address all behave as if there were no account (the registration's insert
    then meets the unique address and sends nothing). Its sessions are gone,
    and `ReefClubSessionRepository.findActive` refuses one anyway.
  */
  findByEmail(email: string): Promise<ReefClubAccountRecord | null> {
    return this.database.reefClubAccount.findFirst({
      where: { email, deletionRequestedAt: null },
      select: ACCOUNT_FIELDS,
    });
  }

  findById(id: string): Promise<ReefClubAccountRecord | null> {
    return this.database.reefClubAccount.findFirst({
      where: { id, deletionRequestedAt: null },
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
      if (isUniqueViolation(error)) return null;
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

  /** The account a Google or Apple account is bound to, if any. */
  async findByIdentity(
    provider: ReefClubIdentityProvider,
    subject: string,
  ): Promise<ReefClubAccountRecord | null> {
    const identity = await this.database.reefClubIdentity.findUnique({
      where: { provider_subject: { provider, subject } },
      select: {
        account: {
          select: { ...ACCOUNT_FIELDS, deletionRequestedAt: true },
        },
      },
    });
    if (!identity || identity.account.deletionRequestedAt) return null;
    const { deletionRequestedAt: _locked, ...account } = identity.account;
    return account;
  }

  async providersOf(accountId: string): Promise<ReefClubIdentityProvider[]> {
    const rows = await this.database.reefClubIdentity.findMany({
      where: { accountId },
      select: { provider: true },
      orderBy: { provider: "asc" },
    });
    return rows.map((row) => row.provider);
  }

  /**
   * A new account from a Google or Apple sign-in: no password, the e-mail
   * verified by the provider, the external account bound to it. Null when the
   * e-mail or the external account was taken in the meantime (a parallel
   * sign-in); the caller looks again.
   */
  async createExternal(input: {
    email: string;
    provider: ReefClubIdentityProvider;
    subject: string;
    consentVersion: string;
  }): Promise<string | null> {
    try {
      return await this.database.$transaction(async (tx) => {
        const now = new Date();
        const account = await tx.reefClubAccount.create({
          data: {
            email: input.email,
            emailVerifiedAt: now,
            consentVersion: input.consentVersion,
            consentAt: now,
          },
          select: { id: true },
        });
        await tx.reefClubIdentity.create({
          data: {
            accountId: account.id,
            provider: input.provider,
            subject: input.subject,
          },
        });
        return account.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  /**
   * THE OWNER OF AN ADDRESS TAKES OVER AN UNVERIFIED ACCOUNT ON IT (slice 3,
   * the same rule as `replaceUnverifiedCredentials`). Somebody may have
   * registered the address first and never confirmed it; the provider has now
   * verified that the person signing in owns the mailbox. So, in one
   * transaction and only while the account is still unverified: the stranger's
   * password goes, every open e-mail link of the account goes, EVERY session of
   * the account goes (an unverified account cannot log in, so none should
   * exist; deleting them makes that a guarantee, not an assumption), the
   * address becomes verified, the consent becomes the owner's, and the
   * external account is bound. False when the account got verified in the
   * meantime or the external account is bound elsewhere: then nothing changed.
   */
  async takeOverUnverified(input: {
    accountId: string;
    provider: ReefClubIdentityProvider;
    subject: string;
    consentVersion: string;
  }): Promise<boolean> {
    try {
      return await this.database.$transaction(async (tx) => {
        const now = new Date();
        const updated = await tx.reefClubAccount.updateMany({
          where: { id: input.accountId, emailVerifiedAt: null },
          data: {
            passwordHash: null,
            emailVerifiedAt: now,
            consentVersion: input.consentVersion,
            consentAt: now,
          },
        });
        if (updated.count !== 1) return false;
        await tx.reefClubAccountToken.deleteMany({
          where: { accountId: input.accountId, usedAt: null },
        });
        await tx.reefClubSession.deleteMany({
          where: { accountId: input.accountId },
        });
        await tx.reefClubIdentity.create({
          data: {
            accountId: input.accountId,
            provider: input.provider,
            subject: input.subject,
          },
        });
        return true;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  /**
   * Binds an external account to a signed-in account. Binding the same one
   * again is a no-op. "BOUND_ELSEWHERE": it belongs to another ReefClub
   * account. "HAS_OTHER": this account already has a different account of the
   * same provider (one per provider, by the unique index).
   */
  async linkIdentity(input: {
    accountId: string;
    provider: ReefClubIdentityProvider;
    subject: string;
  }): Promise<"LINKED" | "BOUND_ELSEWHERE" | "HAS_OTHER"> {
    try {
      await this.database.reefClubIdentity.create({ data: input });
      return "LINKED";
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const owner = await this.database.reefClubIdentity.findUnique({
        where: {
          provider_subject: {
            provider: input.provider,
            subject: input.subject,
          },
        },
        select: { accountId: true },
      });
      if (owner?.accountId === input.accountId) return "LINKED";
      return owner ? "BOUND_ELSEWHERE" : "HAS_OTHER";
    }
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

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
