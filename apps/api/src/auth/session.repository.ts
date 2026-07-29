import { Injectable } from "@nestjs/common";
import { Repository } from "@acropora/database";

import { hashSessionToken } from "./session-token.util.js";

export interface StoredSession {
  id: string;
  userId: string;
  expiresAt: Date;
}

/**
 * Persistent, database-backed replacement for the old `Map<string,
 * Session>` in `AuthService` — sessions issued by one API process/replica
 * are resolvable by any other, and survive a restart, because they live in
 * the `Session` table (via the shared Prisma client) rather than process
 * memory. Only a SHA-256 hash of the token is ever read or written here;
 * the raw token exists solely on the client and in the response issued at
 * login time.
 */
@Injectable()
export class SessionRepository extends Repository {
  // Repository's own constructor is `protected` (Prisma-client injection is
  // an implementation detail, not something callers should override) — a
  // subclass has to re-declare its own constructor to make instantiation
  // public again, exactly like PurchaseInvoiceRepository and the other
  // existing Repository subclasses do.
  constructor() {
    super();
  }

  async create(
    userId: string,
    token: string,
    ttlMs: number,
  ): Promise<StoredSession> {
    const session = await this.database.session.create({
      data: {
        userId,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    return {
      id: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Resolves a raw token to its session, or `null` if no such session
   * exists or it has expired. An expired match is deleted as a side effect
   * — from the caller's point of view it is indistinguishable from "never
   * existed", but this keeps stale rows from accumulating indefinitely.
   */
  async findActive(token: string): Promise<StoredSession | null> {
    const session = await this.database.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
    });
    if (!session) return null;

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.database.session
        .delete({ where: { id: session.id } })
        .catch(() => undefined); // Already gone (e.g. a concurrent logout) — fine.
      return null;
    }

    return {
      id: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
    };
  }

  /** Idempotent: deleting an already-invalid token is a no-op, not an error. */
  async deleteByToken(token: string): Promise<void> {
    await this.database.session.deleteMany({
      where: { tokenHash: hashSessionToken(token) },
    });
  }
}
