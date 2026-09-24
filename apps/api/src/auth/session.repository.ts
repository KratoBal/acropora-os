import { Injectable } from "@nestjs/common";
import { Repository } from "@acropora/database";

import { hashSessionToken } from "./session-token.util.js";

export interface StoredSession {
  id: string;
  userId: string;
  expiresAt: Date;
}

export interface ActiveSessionLookup {
  session: StoredSession;
  /** Igaz, ha EBBEN a hivasban tenylegesen hosszabbitottunk (irtunk). */
  extended: boolean;
}

/**
 * NE IRJUNK ADATBAZIST MINDEN KERESKOR -- Balazs 2. pontja (2026-09-24
 * 08:15, mobil szal). Egy sessiont csak akkor hosszabbitunk (es irunk), ha
 * az UTOLSO hosszabbitas ota eltelt legalabb ennyi ido. Az "utolso
 * hosszabbitas" idejet NEM kulon oszlop tarolja: a MEGLEVO `expiresAt`-bol
 * es a hivo altal atadott `ttlMs`-bol visszaszamolhato
 * (`expiresAt - ttlMs`), mert egy frissen (ki)adott vagy hosszabbitott
 * session pontosan `most + ttlMs` lejaratot kap -- lasd `findActive`.
 */
export const SLIDING_EXTEND_DEBOUNCE_MS = 5 * 60 * 1000;

/**
 * A CSUSZTATAS DONTESE, KULON FUGGVENYKENT -- kiemelve `findActive`-bol,
 * hogy VALODI ADATBAZIS NELKUL is mérheto legyen (a repo sajat
 * `.test.js`-e Postgres nélkül fut). `session.repository.integration.spec.ts`
 * azt bizonyitja, hogy `findActive` TENYLEG ir, ha ez `true`-t ad; ez a
 * fuggveny azt, hogy MIKOR kellene.
 */
export function shouldExtend(
  expiresAt: Date,
  ttlMs: number,
  now: number,
): boolean {
  const impliedLastExtensionAt = expiresAt.getTime() - ttlMs;
  return now - impliedLastExtensionAt >= SLIDING_EXTEND_DEBOUNCE_MS;
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
   *
   * CSUSZO LEJARAT -- Balazs kerese (2026-09-24 08:15, mobil szal): a
   * hivo (`AuthService.resolveToken`) a token sajat elotagjabol levezetett
   * `ttlMs`-t adja at (`ttlMsForToken` -- web es dev 8 ora, mobil 30 nap).
   * Ha az UTOLSO hosszabbitas ota (levezetve: `expiresAt - ttlMs`) eltelt
   * legalabb `SLIDING_EXTEND_DEBOUNCE_MS`, a lejaratot `most + ttlMs`-re
   * toljuk, es irunk -- egyebkent a MEGLEVO sort adjuk vissza, iras nelkul.
   * `extended` jelzi a hivonak, TORTENT-E iras: az `AuthGuard` ez alapjan
   * dont arrol, kell-e ujra beallitania a suti `maxAge`-et (csak akkor,
   * kulonben minden keres felesleges `Set-Cookie` fejlecet kapna).
   */
  async findActive(
    token: string,
    ttlMs: number,
  ): Promise<ActiveSessionLookup | null> {
    const session = await this.database.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
    });
    if (!session) return null;

    const now = Date.now();
    if (session.expiresAt.getTime() <= now) {
      await this.database.session
        .delete({ where: { id: session.id } })
        .catch(() => undefined); // Already gone (e.g. a concurrent logout) — fine.
      return null;
    }

    if (!shouldExtend(session.expiresAt, ttlMs, now)) {
      return {
        session: {
          id: session.id,
          userId: session.userId,
          expiresAt: session.expiresAt,
        },
        extended: false,
      };
    }

    const expiresAt = new Date(now + ttlMs);
    await this.database.session.update({
      where: { id: session.id },
      data: { expiresAt },
    });

    return {
      session: { id: session.id, userId: session.userId, expiresAt },
      extended: true,
    };
  }

  /** Idempotent: deleting an already-invalid token is a no-op, not an error. */
  async deleteByToken(token: string): Promise<void> {
    await this.database.session.deleteMany({
      where: { tokenHash: hashSessionToken(token) },
    });
  }
}
