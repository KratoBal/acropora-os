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

  /**
   * The real, production login path: verifies a password against the
   * stored `passwordHash` (via AuthUserResolver.resolveByEmailAndPassword,
   * which already exists for user-management but was never wired to any
   * login endpoint) and issues a session through the exact same in-memory
   * `sessions` map and `Session`/`AuthenticatedUser` contract the
   * development login already uses — no new session storage, no new
   * identity model, per docs/AUTHENTICATION.md's own "Providercsere"
   * guidance that a real provider only needs to replace *this* piece.
   *
   * Unlike the development login's `dev_`-prefixed token, this session's
   * token is delivered to the client exclusively via an httpOnly cookie
   * (see AuthController) — it is never present in a JSON response body or
   * readable by client-side JS.
   */
  async loginWithPassword(email: string, password: string): Promise<Session> {
    const internalUser = await this.users.resolveByEmailAndPassword(
      email,
      password,
    );
    const token = randomUUID();
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
