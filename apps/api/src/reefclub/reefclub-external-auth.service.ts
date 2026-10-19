import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";

import { generateSessionToken } from "../auth/session-token.util.js";
import { ReefClubAccountRepository } from "./reefclub-account.repository.js";
import type { ReefClubIssuedSession } from "./reefclub-auth.service.js";
import {
  APPLE_ISSUERS,
  APPLE_JWKS_URL,
  appleNonceMatches,
  GOOGLE_ISSUERS,
  GOOGLE_JWKS_URL,
  type ReefClubIdClaims,
  ReefClubIdTokenError,
  type ReefClubKeyLookup,
  type ReefClubProvider,
  type ReefClubProviderConfig,
  verifyIdToken,
} from "./reefclub-id-token.js";
import { ReefClubSessionRepository } from "./reefclub-session.repository.js";

export const REEFCLUB_IDENTITY_KEYS = Symbol("REEFCLUB_IDENTITY_KEYS");
export const REEFCLUB_PROVIDER_CONFIGS = Symbol("REEFCLUB_PROVIDER_CONFIGS");

export type ReefClubProviderConfigs = Record<
  ReefClubProvider,
  ReefClubProviderConfig
>;

/**
 * Our client ids, from the ReefClub environment: a comma-separated list per
 * provider (web, iOS and Android clients each have their own id). An empty
 * list switches that sign-in off: every token is refused for its audience.
 */
export function reefClubProviderConfigs(
  environment: Record<string, string | undefined> = process.env,
): ReefClubProviderConfigs {
  const list = (value: string | undefined) =>
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  return {
    GOOGLE: {
      provider: "GOOGLE",
      issuers: GOOGLE_ISSUERS,
      audiences: list(environment.REEFCLUB_GOOGLE_CLIENT_IDS),
      jwksUrl: GOOGLE_JWKS_URL,
    },
    APPLE: {
      provider: "APPLE",
      issuers: APPLE_ISSUERS,
      audiences: list(environment.REEFCLUB_APPLE_CLIENT_IDS),
      jwksUrl: APPLE_JWKS_URL,
    },
  };
}

/** The provider's name with its article, lower and upper case ("a Google", "az Apple"). */
const NAMES: Record<ReefClubProvider, { name: string; a: string; A: string }> =
  {
    GOOGLE: { name: "Google", a: "a Google", A: "A Google" },
    APPLE: { name: "Apple", a: "az Apple", A: "Az Apple" },
  };

/**
 * SIGN-IN AND LINKING WITH GOOGLE AND APPLE (plan v6.1, 3.2; slice 3).
 *
 * NO MERGING BY E-MAIL (plan 3.2, [K]). An external account signs in to the
 * ReefClub account it is bound to, and to no other. A first sign-in whose
 * verified e-mail is free creates a new account; one whose e-mail belongs to
 * a VERIFIED account is refused with "sign in and add it there", because that
 * account's owner has not said this Google account is theirs. The answer
 * names the existing account only to someone the provider has just shown to
 * own the mailbox, so it tells them nothing they could not read in their
 * inbox.
 *
 * AN UNVERIFIED ACCOUNT ON THE ADDRESS IS TAKEN OVER (see
 * `ReefClubAccountRepository.takeOverUnverified`): its registration was never
 * confirmed, so nobody has shown it is theirs, and the person the provider
 * vouches for is the mailbox owner.
 *
 * EVERY REFUSED TOKEN GETS ONE ANSWER; the reason goes to the log as a code,
 * the token never does.
 */
@Injectable()
export class ReefClubExternalAuthService {
  private readonly logger = new Logger(ReefClubExternalAuthService.name);

  constructor(
    private readonly accounts: ReefClubAccountRepository,
    private readonly sessions: ReefClubSessionRepository,
    @Inject(REEFCLUB_IDENTITY_KEYS) private readonly keys: ReefClubKeyLookup,
    @Inject(REEFCLUB_PROVIDER_CONFIGS)
    private readonly configs: ReefClubProviderConfigs,
  ) {}

  async signIn(
    provider: ReefClubProvider,
    idToken: string,
    options: { nonce?: string; consentVersion?: string },
  ): Promise<ReefClubIssuedSession> {
    const claims = await this.claims(provider, idToken, options.nonce);
    // Twice at most: a parallel first sign-in can take the address or the
    // external account between our read and our write; the second round then
    // finds what it created.
    for (let round = 0; round < 2; round++) {
      // THE ADDRESS IS READ BEFORE THE BINDING, on purpose (measured: two
      // parallel first sign-ins, 2 of 5 runs answered 409 the other way round).
      // A parallel sign-in that commits between the two reads shows up in the
      // binding read, so it is a login; the other order would see "no binding"
      // first, then the other sign-in's fresh, verified account on the address,
      // and refuse the owner as "this address already has an account".
      const existing = claims.email
        ? await this.accounts.findByEmail(claims.email)
        : null;
      const bound = await this.accounts.findByIdentity(
        provider,
        claims.subject,
      );
      if (bound) return this.issue(bound.id);

      if (!claims.email)
        throw new UnprocessableEntityException(
          `${NAMES[provider].A}-fiók nem adott e-mail címet, így nem hozható létre ReefClub-fiók.`,
        );
      if (!claims.emailVerified)
        throw new UnprocessableEntityException(
          `${NAMES[provider].A}-fiók e-mail címe nincs megerősítve.`,
        );
      if (existing?.emailVerifiedAt)
        throw new ConflictException(
          `Ehhez az e-mail címhez már van ReefClub-fiók. Lépj be a megszokott módon, és a fiókodban kapcsold hozzá ${NAMES[provider].a}-belépést.`,
        );
      if (!options.consentVersion)
        throw new UnprocessableEntityException(
          "Az első belépéshez el kell fogadni az adatkezelési tájékoztatót.",
        );

      if (!existing) {
        const created = await this.accounts.createExternal({
          email: claims.email,
          provider,
          subject: claims.subject,
          consentVersion: options.consentVersion,
        });
        if (created) return this.issue(created);
        continue;
      }
      const taken = await this.accounts.takeOverUnverified({
        accountId: existing.id,
        provider,
        subject: claims.subject,
        consentVersion: options.consentVersion,
      });
      if (taken) return this.issue(existing.id);
    }
    throw new ConflictException("A belépés most nem sikerült, próbáld újra.");
  }

  /** Adds a Google or Apple account to the signed-in account. */
  async link(
    accountId: string,
    provider: ReefClubProvider,
    idToken: string,
    options: { nonce?: string },
  ): Promise<void> {
    const claims = await this.claims(provider, idToken, options.nonce);
    const result = await this.accounts.linkIdentity({
      accountId,
      provider,
      subject: claims.subject,
    });
    if (result === "BOUND_ELSEWHERE")
      throw new ConflictException(
        `${NAMES[provider].A}-fiók már egy másik ReefClub-fiókhoz tartozik.`,
      );
    if (result === "HAS_OTHER")
      throw new ConflictException(
        `A fiókodhoz már tartozik egy másik ${NAMES[provider].name}-fiók.`,
      );
  }

  private async claims(
    provider: ReefClubProvider,
    idToken: string,
    nonce: string | undefined,
  ): Promise<ReefClubIdClaims> {
    const config = this.configs[provider];
    if (config.audiences.length === 0)
      throw new ServiceUnavailableException(
        `${NAMES[provider].A}-belépés még nincs bekapcsolva.`,
      );
    const refused = new UnauthorizedException(
      `${NAMES[provider].A}-belépés nem sikerült.`,
    );
    let claims: ReefClubIdClaims;
    try {
      claims = await verifyIdToken(idToken, config, this.keys);
    } catch (error) {
      if (!(error instanceof ReefClubIdTokenError)) throw error;
      this.logger.warn(`${provider} ID-token elutasítva (${error.failure}).`);
      throw refused;
    }
    if (provider === "APPLE" && !(nonce && appleNonceMatches(claims, nonce))) {
      this.logger.warn("APPLE ID-token elutasítva (NONCE).");
      throw refused;
    }
    return claims;
  }

  private async issue(accountId: string): Promise<ReefClubIssuedSession> {
    const token = generateSessionToken();
    const expiresAt = await this.sessions.create(accountId, token);
    return { token, expiresAt };
  }
}
