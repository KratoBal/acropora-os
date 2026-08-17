import { Injectable } from "@nestjs/common";
import { Repository, prisma, type ServiceToken } from "@acropora/database";

// Reused deliberately rather than reimplemented: service tokens and session
// tokens must be stored the same way (SHA-256 of the raw value, never the
// value itself), and a second hashing helper would be a second place to get
// that wrong.
import { hashSessionToken } from "../auth/session-token.util.js";

export interface ServiceTokenSummary {
  id: string;
  name: string;
  slug: string;
  dailyLimit: number;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

@Injectable()
export class ServiceTokenRepository extends Repository {
  constructor() {
    super(prisma);
  }

  /**
   * Resolves a raw bearer value to a live service token, or `null` if it is
   * unknown or revoked. Revoked tokens are indistinguishable from unknown
   * ones to the caller, so a leaked-then-revoked token yields no signal
   * that it was ever valid.
   */
  async findActive(rawToken: string): Promise<ServiceToken | null> {
    const token = await this.database.serviceToken.findUnique({
      where: { tokenHash: hashSessionToken(rawToken) },
    });
    if (!token || token.revokedAt) return null;
    return token;
  }

  async touch(id: string): Promise<void> {
    await this.database.serviceToken.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  async create(input: {
    name: string;
    slug: string;
    rawToken: string;
    dailyLimit: number;
  }): Promise<ServiceTokenSummary> {
    const token = await this.database.serviceToken.create({
      data: {
        name: input.name,
        slug: input.slug,
        tokenHash: hashSessionToken(input.rawToken),
        dailyLimit: input.dailyLimit,
      },
    });
    return toSummary(token);
  }

  async revoke(slug: string): Promise<ServiceTokenSummary | null> {
    const token = await this.database.serviceToken.findUnique({
      where: { slug },
    });
    if (!token) return null;
    if (token.revokedAt) return toSummary(token);
    return toSummary(
      await this.database.serviceToken.update({
        where: { slug },
        data: { revokedAt: new Date() },
      }),
    );
  }

  async list(): Promise<ServiceTokenSummary[]> {
    const tokens = await this.database.serviceToken.findMany({
      orderBy: [{ createdAt: "asc" }],
    });
    return tokens.map((token) => toSummary(token));
  }
}

/** Never exposes `tokenHash` - a listing has no legitimate use for it. */
export function toSummary(token: ServiceToken): ServiceTokenSummary {
  return {
    id: token.id,
    name: token.name,
    slug: token.slug,
    dailyLimit: token.dailyLimit,
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
    createdAt: token.createdAt.toISOString(),
  };
}
