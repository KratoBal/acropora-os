import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";
import { createHash } from "node:crypto";

@Injectable()
export class AuthUserResolver {
  private readonly logger = new Logger(AuthUserResolver.name);

  async resolveDevelopmentIdentity(
    identity: AuthenticatedUser,
  ): Promise<AuthenticatedUser> {
    try {
      const user = await prisma.user.upsert({
        where: { email: identity.email.trim().toLowerCase() },
        update: {
          displayName: identity.displayName,
          role: identity.role,
          isActive: true,
        },
        create: {
          email: identity.email.trim().toLowerCase(),
          displayName: identity.displayName,
          role: identity.role,
          isActive: true,
        },
      });
      return this.toAuthenticatedUser(user);
    } catch (error) {
      this.logger.error(
        `A development identity nem oldható fel belső User rekordra: subject=${identity.id}, emailHash=${this.emailHash(identity.email)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        "A development felhasználó adatbázis-rekordja nem készíthető el.",
      );
    }
  }

  async resolveExistingIdentity(
    identity: AuthenticatedUser,
  ): Promise<AuthenticatedUser> {
    const normalizedEmail = identity.email.trim().toLowerCase();
    const user =
      (await prisma.user.findUnique({ where: { id: identity.id } })) ??
      (await prisma.user.findUnique({ where: { email: normalizedEmail } }));
    if (!user || !user.isActive) {
      this.logger.warn(
        `Az autentikált identityhez nincs aktív belső User: subject=${identity.id}, emailHash=${this.emailHash(normalizedEmail)}`,
      );
      throw new UnauthorizedException(
        "Az autentikált felhasználóhoz nem tartozik aktív belső User rekord.",
      );
    }
    return this.toAuthenticatedUser(user);
  }

  private toAuthenticatedUser(user: {
    id: string;
    email: string;
    displayName: string;
    role: AuthenticatedUser["role"];
    avatarUrl: string | null;
  }): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      avatarUrl: user.avatarUrl,
    };
  }

  private emailHash(email: string): string {
    return createHash("sha256")
      .update(email.trim().toLowerCase())
      .digest("hex")
      .slice(0, 12);
  }
}
