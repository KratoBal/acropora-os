import { Injectable } from "@nestjs/common";
import {
  Prisma,
  Repository,
  prisma,
  type ServiceToken,
} from "@acropora/database";
import type { UserRole } from "@acropora/types";

import { hashSessionToken } from "../auth/session-token.util.js";
import { bindingRefusal } from "./service-token-admin.rules.js";

/** The token as the admin sees it. No hash, ever: a listing has no use for it. */
export interface ServiceTokenAdminView {
  id: string;
  name: string;
  slug: string;
  dailyLimit: number;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  user: { id: string; email: string; role: UserRole } | null;
}

export type ServiceTokenCreateResult =
  | { kind: "created"; token: ServiceTokenAdminView }
  | { kind: "refused"; reason: string }
  | { kind: "slug-taken" };

export type ServiceTokenRevokeResult =
  | { kind: "not-found" }
  | { kind: "revoked"; token: ServiceTokenAdminView; changed: boolean };

type StoredToken = ServiceToken & {
  user: { id: string; email: string; role: UserRole } | null;
};

const withUser = {
  user: { select: { id: true, email: true, role: true } },
} as const;

export function toAdminView(token: StoredToken): ServiceTokenAdminView {
  return {
    id: token.id,
    name: token.name,
    slug: token.slug,
    dailyLimit: token.dailyLimit,
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
    createdAt: token.createdAt.toISOString(),
    user: token.user,
  };
}

/**
 * THE SERVICE TOKENS' ADMIN STORE (card c5a8e6d6).
 *
 * Every write is ONE transaction with its audit row (who, which token, which account): a token that exists has its
 * creation on record, and a revocation is on record only when the state really changed. The audit metadata never carries
 * the raw token or its hash.
 */
@Injectable()
export class ServiceTokenAdminRepository extends Repository {
  /**
   * NO constructor parameter on purpose: with `emitDecoratorMetadata` a typed parameter is a dependency Nest must resolve,
   * and nothing provides the database client (the app.bootstrap spec failed on exactly this on #2391). The unit spec swaps
   * the client by assigning `database`.
   */
  constructor() {
    super(prisma);
  }

  async list(): Promise<ServiceTokenAdminView[]> {
    const tokens = await this.database.serviceToken.findMany({
      orderBy: [{ createdAt: "asc" }],
      include: withUser,
    });
    return tokens.map(toAdminView);
  }

  /** `rawToken` is hashed here and goes no further: the caller returns it once and keeps nothing. */
  async create(
    input: {
      name: string;
      slug: string;
      userEmail: string;
      dailyLimit: number;
      rawToken: string;
    },
    actorUserId: string,
  ): Promise<ServiceTokenCreateResult> {
    try {
      return await this.database.$transaction(async (transaction) => {
        const user = await transaction.user.findUnique({
          where: { email: input.userEmail.trim().toLowerCase() },
          select: { id: true, isActive: true, role: true },
        });
        const reason = bindingRefusal(user);
        if (reason !== null || user === null)
          return { kind: "refused", reason: reason ?? "" } as const;

        const created = await transaction.serviceToken.create({
          data: {
            name: input.name,
            slug: input.slug,
            tokenHash: hashSessionToken(input.rawToken),
            dailyLimit: input.dailyLimit,
            userId: user.id,
          },
          include: withUser,
        });
        await transaction.auditLog.create({
          data: {
            userId: actorUserId,
            action: "service_token.created",
            entityType: "ServiceToken",
            entityId: created.id,
            metadata: {
              slug: created.slug,
              name: created.name,
              boundUserId: user.id,
              boundRole: user.role,
              dailyLimit: created.dailyLimit,
            } satisfies Prisma.JsonObject,
          },
        });
        return { kind: "created", token: toAdminView(created) } as const;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return { kind: "slug-taken" };
      throw error;
    }
  }

  /** Revoking a revoked token answers the same and writes nothing: the audit row is the state change's, not the call's. */
  async revoke(
    slug: string,
    actorUserId: string,
  ): Promise<ServiceTokenRevokeResult> {
    return this.database.$transaction(async (transaction) => {
      const stored = await transaction.serviceToken.findUnique({
        where: { slug },
        include: withUser,
      });
      if (!stored) return { kind: "not-found" } as const;
      if (stored.revokedAt)
        return {
          kind: "revoked",
          token: toAdminView(stored),
          changed: false,
        } as const;

      // `revokedAt: null` in the condition: two revocations racing write ONE audit row (the loser's count is 0).
      const updated = await transaction.serviceToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const current = await transaction.serviceToken.findUniqueOrThrow({
        where: { id: stored.id },
        include: withUser,
      });
      if (updated.count === 1)
        await transaction.auditLog.create({
          data: {
            userId: actorUserId,
            action: "service_token.revoked",
            entityType: "ServiceToken",
            entityId: stored.id,
            metadata: {
              slug: stored.slug,
              name: stored.name,
              boundUserId: stored.userId,
            } satisfies Prisma.JsonObject,
          },
        });
      return {
        kind: "revoked",
        token: toAdminView(current),
        changed: updated.count === 1,
      } as const;
    });
  }
}
