import { Inject, Injectable } from "@nestjs/common";

import { hashSessionToken } from "../auth/session-token.util.js";
import { ReefClubDatabase } from "./reefclub-database.js";

/**
 * A REEFCLUB SESSION LIVES 30 DAYS FROM LOGIN, without sliding. A customer app
 * that logs out monthly is a smaller cost than a write on every request; the
 * internal sliding rule (`session.repository.ts`) answers a different need, a
 * working day on the shop floor.
 */
export const REEFCLUB_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface ReefClubActiveSession {
  id: string;
  accountId: string;
  expiresAt: Date;
}

/**
 * The ReefClub session table, and only that. It never reads the internal
 * `Session` table, and the internal `SessionRepository` never reads this one:
 * a token issued on one side resolves to nothing on the other. That is the
 * whole of the "two worlds" rule at the storage level (plan v6.1, 4.1); the
 * guards only add that each side looks in its own cookie.
 */
@Injectable()
export class ReefClubSessionRepository {
  constructor(
    @Inject(ReefClubDatabase) private readonly database: ReefClubDatabase,
  ) {}

  async create(accountId: string, token: string): Promise<Date> {
    const expiresAt = new Date(Date.now() + REEFCLUB_SESSION_TTL_MS);
    await this.database.reefClubSession.create({
      data: { accountId, tokenHash: hashSessionToken(token), expiresAt },
    });
    return expiresAt;
  }

  /** The live session for a raw token, or null. An expired row is removed. */
  async findActive(token: string): Promise<ReefClubActiveSession | null> {
    const row = await this.database.reefClubSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      select: {
        id: true,
        accountId: true,
        expiresAt: true,
        account: { select: { deletionRequestedAt: true } },
      },
    });
    // A session of an account locked for deletion is no session (slice 6);
    // the request deletes them, this holds if one is left over.
    if (!row || row.account.deletionRequestedAt) return null;
    const session = {
      id: row.id,
      accountId: row.accountId,
      expiresAt: row.expiresAt,
    };
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.database.reefClubSession
        .deleteMany({ where: { id: session.id } })
        .catch(() => undefined);
      return null;
    }
    return session;
  }

  /** Idempotent: an unknown token is not an error. */
  async deleteByToken(token: string): Promise<void> {
    await this.database.reefClubSession.deleteMany({
      where: { tokenHash: hashSessionToken(token) },
    });
  }
}
