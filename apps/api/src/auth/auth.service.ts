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

/**
 * WEB 8 ORA, MOBIL 30 NAP, MINDKETTO CSUSZO -- Balazs kerese es jovahagyasa
 * (2026-09-24 08:10 es 08:15, mobil szal). Az elso kor (csak a belepeskor
 * kapott hossz) NEM volt eleg: a tunet ("napkozben kileptet") azert marad
 * fenn csuszas nelkul is, ha valaki egy hosszu, de VEGES ablakon at
 * hasznalja az appot -- a valodi javitas az, hogy minden hitelesitett keres
 * a lejaratot MOST+hossz-ra tolja, lasd `resolveToken` es
 * `SessionRepository.findActive`.
 *
 * MIERT EXPORTALT MOST: a webre es a mobilra KULON ertek kell, es a hivo
 * (`AuthController`) donti el, melyiket adja at az `issueSession`-nek --
 * lasd `loginWithPassword` sajat jegyzeteben, miert a hivo oldalan dol el,
 * nem itt.
 */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const MOBILE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A MOBIL TOKEN SAJAT ELOTAGJA -- ELDONTI, MELYIK HOSSZ CSUSZIK.
 *
 * Balazs 3. pontja: "a csuszasnak tudnia kell, melyik hossz jar az adott
 * sessionnek... ha a token-elotagbol vagy mas meglevo adatbol levezetheto,
 * az a jobb." A `Session` tabla csak a token HASH-et tarolja (lasd
 * `session.repository.ts` sajat jegyzeteben), a NYERS tokent viszont MINDEN
 * hiteleisitett keres magaval hozza (Authorization fejlec vagy suti) --
 * tehat az elotag mindig elerheto `resolveToken`-ben, uj oszlop NELKUL.
 *
 * EZ VALTOZTAT A `generateSessionToken` sajat jegyzetenek egyik allitasan:
 * a `dev_` elotagot korabban "purely cosmetic... carries no security
 * meaning"-kent irtuk le. Ez a `dev_`-re TOVABBRA is igaz (a fejlesztoi/
 * eles hatart a `developmentLoginRefusal` adja, nem az elotag). A
 * `mobile_`-ra viszont MAR NEM: ez most VISELKEDEST valaszt
 * (`ttlMsForToken`), tehat a helyes olvasat: az elotag azonositasra
 * hasznalhato info, de SOHA nem hitelesitesi vagy jogosultsagi dontes --
 * azt a token SHA-256 hash-enek egyezese adja, a `Session` tablaban.
 */
export const MOBILE_TOKEN_PREFIX = "mobile_";

export type LoginClient = "web" | "mobile";

function sessionConfigForClient(client: LoginClient): {
  ttlMs: number;
  tokenPrefix: string;
} {
  return client === "mobile"
    ? { ttlMs: MOBILE_SESSION_TTL_MS, tokenPrefix: MOBILE_TOKEN_PREFIX }
    : { ttlMs: SESSION_TTL_MS, tokenPrefix: "" };
}

/** Melyik hossz csuszik egy MAR KIADOTT, nyers tokenre -- lasd MOBILE_TOKEN_PREFIX. */
export function ttlMsForToken(token: string): number {
  return token.startsWith(MOBILE_TOKEN_PREFIX)
    ? MOBILE_SESSION_TTL_MS
    : SESSION_TTL_MS;
}

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
   *
   * `client` DEFAULTS TO `"web"`, AND THE CALLER DECIDES, NOT THIS METHOD:
   * the credential check is identical for both clients, only the session
   * length AND token prefix differ, and the controller is the one place
   * that already knows which endpoint it is (web vs mobile) — duplicating
   * that knowledge here would just move the same decision one layer down
   * for no benefit. See `AuthController.loginMobileWithPassword`, which
   * passes `"mobile"` explicitly. `sessionConfigForClient` ties the ttl and
   * the token prefix together on purpose — they must always agree, so a
   * caller cannot pass one without the other.
   */
  async loginWithPassword(
    email: string,
    password: string,
    client: LoginClient = "web",
  ): Promise<Session> {
    const internalUser = await this.users.resolveByEmailAndPassword(
      email,
      password,
    );
    const { ttlMs, tokenPrefix } = sessionConfigForClient(client);
    return this.issueSession(internalUser, tokenPrefix, ttlMs);
  }

  /**
   * Resolves a raw Bearer/cookie token against the persisted `Session`
   * table (via SessionRepository, SHA-256-hashed lookup) — unlike the old
   * in-memory `Map`, this works identically regardless of which API
   * process/replica issued the token, and survives an API restart.
   *
   * CSUSZO LEJARAT: `findActive` a token sajat elotagjabol levezetett
   * `ttlMs`-t kapja, es MAGA donti el (debounce-szal), hosszabbit-e --
   * lasd ott. A visszaadott `expiresAt` es `extended` a hivonak szol
   * (`AuthGuard`): a suti-maxAge-et csak akkor kell ujra beallitani, ha
   * TENYLEG tortent hosszabbitas, kulonben minden keres felesleges
   * `Set-Cookie` fejlecet kapna.
   */
  async resolveToken(token: string): Promise<{
    user: AuthenticatedUser;
    expiresAt: string;
    extended: boolean;
  }> {
    const result = await this.sessions.findActive(token, ttlMsForToken(token));

    if (!result) {
      throw new UnauthorizedException("Érvénytelen vagy lejárt munkamenet.");
    }

    const user = await this.users.resolveById(result.session.userId);
    return {
      user,
      expiresAt: result.session.expiresAt.toISOString(),
      extended: result.extended,
    };
  }

  async logout(token: string): Promise<void> {
    await this.sessions.deleteByToken(token);
  }

  private async issueSession(
    user: AuthenticatedUser,
    tokenPrefix = "",
    ttlMs: number = SESSION_TTL_MS,
  ): Promise<Session> {
    const token = generateSessionToken(tokenPrefix);
    const stored = await this.sessions.create(user.id, token, ttlMs);
    return {
      id: stored.id,
      user,
      token,
      expiresAt: stored.expiresAt.toISOString(),
    };
  }
}
