import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { AuthenticatedUser, Session } from "@acropora/types";

import { DEVELOPMENT_USERS } from "./development-users.js";
import { developmentLoginRefusal } from "./development-login.guard.js";
import { AuthUserResolver } from "./auth-user-resolver.js";
import { SessionRepository } from "./session.repository.js";
import { generateSessionToken } from "./session-token.util.js";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: AuthUserResolver,
    private readonly sessions: SessionRepository,
  ) {}

  /**
   * KÉT FÜGGETLEN ZÁR VÉDI, ÉS EZ NEM ÓVATOSSÁG. Ez a metódus a jelszó
   * ismerete nélkül ad munkamenetet, és a `resolveDevelopmentIdentity`
   * LÉTRE IS HOZZA a hiányzó felhasználót, `OWNER` szerepkörrel. Ha éles
   * példányon fut le, nem csak belépés történik: keletkezik egy tulajdonosi
   * fiók az éles adatbázisban.
   *
   * A két feltétel külön változón áll (`AUTH_PROVIDER` és `NODE_ENV`) --
   * lásd a `development-login.guard.ts` jegyzetét arról, miért nem elég egy.
   */
  async loginWithDevelopmentUser(email: string): Promise<Session> {
    const refusal = developmentLoginRefusal();
    if (refusal) {
      // AZ OK A NAPLÓBA, A VÁLASZBA CSAK ANNYI, HOGY NINCS ENGEDÉLYEZVE: a
      // hívó nincs hitelesítve, és a pontos ok megmondaná neki, melyik
      // beállítást kell megszereznie.
      this.logger.warn(`A development login megtagadva: ${refusal}.`);
      throw new ForbiddenException(
        "A development login ezen a példányon nincs engedélyezve.",
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
    return this.issueSession(internalUser, "dev_");
  }

  /**
   * The real, production login path: verifies a password against the
   * stored `passwordHash` (via AuthUserResolver.resolveByEmailAndPassword)
   * and issues a session through the exact same persisted-session /
   * `Session`/`AuthenticatedUser` contract the development login uses —
   * only the credential check differs.
   *
   * Unlike the development login's `dev_`-prefixed token, this session's
   * token reaches the *web* client exclusively via an httpOnly cookie (see
   * AuthController.loginWithPassword) — it is never present in that
   * endpoint's JSON response body. The mobile login endpoint
   * (`AuthController.loginMobileWithPassword`) calls this same method but
   * returns the token directly in the JSON body instead, since mobile has
   * no shared browser cookie jar to rely on.
   */
  async loginWithPassword(email: string, password: string): Promise<Session> {
    const internalUser = await this.users.resolveByEmailAndPassword(
      email,
      password,
    );
    return this.issueSession(internalUser);
  }

  /**
   * Resolves a raw Bearer/cookie token against the persisted `Session`
   * table (via SessionRepository, SHA-256-hashed lookup) — unlike the old
   * in-memory `Map`, this works identically regardless of which API
   * process/replica issued the token, and survives an API restart.
   */
  async resolveToken(token: string): Promise<AuthenticatedUser> {
    const session = await this.sessions.findActive(token);

    if (!session) {
      throw new UnauthorizedException("Érvénytelen vagy lejárt munkamenet.");
    }

    return this.users.resolveById(session.userId);
  }

  async logout(token: string): Promise<void> {
    await this.sessions.deleteByToken(token);
  }

  private async issueSession(
    user: AuthenticatedUser,
    tokenPrefix = "",
  ): Promise<Session> {
    const token = generateSessionToken(tokenPrefix);
    const stored = await this.sessions.create(user.id, token, SESSION_TTL_MS);
    return {
      id: stored.id,
      user,
      token,
      expiresAt: stored.expiresAt.toISOString(),
    };
  }
}
