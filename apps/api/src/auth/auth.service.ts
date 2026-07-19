import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { AuthenticatedUser, Session } from "@acropora/types";
import { randomUUID } from "node:crypto";

import { DEVELOPMENT_USERS } from "./development-users.js";
import { AuthUserResolver } from "./auth-user-resolver.js";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly users: AuthUserResolver) {}

  async loginWithDevelopmentUser(email: string): Promise<Session> {
    if (process.env.NODE_ENV === "production") {
      throw new ForbiddenException(
        "A development login production környezetben nem használható.",
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = DEVELOPMENT_USERS.find(
      (candidate) => candidate.email === normalizedEmail,
    );

    if (!user) {
      throw new NotFoundException("Ismeretlen development felhasználó.");
    }

    const internalUser = await this.users.resolveDevelopmentIdentity(user);
    const token = `dev_${randomUUID()}`;
    const session: Session = {
      id: randomUUID(),
      user: internalUser,
      token,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    };

    this.sessions.set(token, session);
    return session;
  }

  async resolveToken(token: string): Promise<AuthenticatedUser> {
    const session = this.sessions.get(token);

    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
      this.sessions.delete(token);
      throw new UnauthorizedException("Érvénytelen vagy lejárt munkamenet.");
    }

    const internalUser = await this.users.resolveExistingIdentity(session.user);
    session.user = internalUser;
    return internalUser;
  }

  logout(token: string): void {
    this.sessions.delete(token);
  }
}
