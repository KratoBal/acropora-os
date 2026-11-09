import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { prisma } from "@acropora/database";
import {
  permissionsWithOverrides,
  type AuthenticatedUser,
  type ThemePreference,
} from "@acropora/types";

import { createHash } from "node:crypto";

import { hashPassword, verifyPassword } from "../users/password.util.js";

/** A személyes jog-eltérések, minden felhasználó-lekérdezéshez. */
const WITH_OVERRIDES = {
  permissionOverrides: { select: { permission: true, effect: true } },
} as const;

/**
 * Deliberately identical, generic message for "no such user", "user has no
 * password set yet" and "wrong password" — distinguishing them in the
 * response would let an attacker enumerate valid e-mail addresses.
 */
const INVALID_CREDENTIALS_MESSAGE = "Hibás e-mail cím vagy jelszó.";

// Lazily computed once and reused: when there's no real stored hash to
// compare against (unknown e-mail, or a user that has never had a
// password set), still run a real scrypt computation against *some* hash
// rather than short-circuiting immediately — otherwise "unknown e-mail"
// responds measurably faster than "wrong password for a real e-mail",
// which is a timing side-channel an attacker could use to enumerate
// valid accounts.
let dummyHashPromise: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("timing-attack-mitigation-placeholder");
  return dummyHashPromise;
}

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
        include: WITH_OVERRIDES,
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
      (await prisma.user.findUnique({
        where: { id: identity.id },
        include: WITH_OVERRIDES,
      })) ??
      (await prisma.user.findUnique({
        where: { email: normalizedEmail },
        include: WITH_OVERRIDES,
      }));
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

  /**
   * Same "must resolve to an active internal User" contract as
   * `resolveExistingIdentity`, but keyed purely by `User.id` — used by
   * `AuthService.resolveToken`, where the persisted `Session` row only
   * stores `userId` (no cached e-mail/displayName/role to fall back on).
   */
  /**
   * THE PERSON'S OWN THEME, on the account (Balázs, 2026-11-09: the phone's browser forgot it every time). Only the
   * caller's own row; the value is one of the three, checked by the DTO before it comes here.
   */
  async setThemePreference(
    userId: string,
    preference: ThemePreference,
  ): Promise<ThemePreference> {
    const saved = await prisma.user.update({
      where: { id: userId },
      data: {
        themePreference: preference.toUpperCase() as
          "LIGHT" | "DARK" | "SYSTEM",
      },
      select: { themePreference: true },
    });
    return (saved.themePreference?.toLowerCase() ??
      preference) as ThemePreference;
  }

  async resolveById(userId: string): Promise<AuthenticatedUser> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: WITH_OVERRIDES,
    });
    if (!user || !user.isActive) {
      this.logger.warn(
        `Az autentikált sessionhöz nincs aktív belső User: userId=${userId}`,
      );
      throw new UnauthorizedException(
        "Az autentikált felhasználóhoz nem tartozik aktív belső User rekord.",
      );
    }
    return this.toAuthenticatedUser(user);
  }

  async resolveByEmailAndPassword(
    email: string,
    password: string,
  ): Promise<AuthenticatedUser> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: WITH_OVERRIDES,
    });

    const storedHash = user?.passwordHash ?? (await getDummyHash());
    const passwordMatches = await verifyPassword(password, storedHash);

    if (!user || !user.isActive || !user.passwordHash || !passwordMatches) {
      this.logger.warn(
        `Sikertelen jelszavas bejelentkezési kísérlet: emailHash=${this.emailHash(normalizedEmail)}`,
      );
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    return this.toAuthenticatedUser(user);
  }

  /**
   * The partner columns are REQUIRED in the parameter type, not optional.
   *
   * Every caller here hands over a row read straight from the database, so
   * they are always present in practice - but an optional parameter would let
   * a future caller pass a narrower `select` that leaves them out, and the
   * result would silently be an account belonging to nobody, which is what an
   * internal colleague looks like. The compiler is the only thing that can
   * catch that before it ships.
   */
  private toAuthenticatedUser(user: {
    id: string;
    email: string;
    displayName: string;
    nickname?: string | null;
    role: AuthenticatedUser["role"];
    avatarUrl: string | null;
    /** optional: a narrower test row may leave it out, which reads as "not chosen" */
    themePreference?: "LIGHT" | "DARK" | "SYSTEM" | null;
    customerId: string | null;
    supplierId: string | null;
    /** KÖTELEZŐ: a fordító minden lekérdezésen számon kéri az eltéréseket. */
    permissionOverrides: readonly { permission: string; effect: string }[];
  }): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      nickname: user.nickname ?? null,
      role: user.role,
      avatarUrl: user.avatarUrl,
      // the theme chosen on the account (Balázs, 2026-11-09), lower case as the clients use it; null: not chosen
      themePreference: user.themePreference
        ? (user.themePreference.toLowerCase() as ThemePreference)
        : null,
      customerId: user.customerId,
      supplierId: user.supplierId,
      /*
        A SZEMÉLY JOGAI, EGY HELYEN: minden belépés és minden kérés ezen a
        függvényen át kapja a felhasználót. A szerep sablonja plusz a
        személyes eltérései (Balázs döntése, 2026-10-06: szerepkör-sablon +
        egyéni eltérés). Minden kérésnél frissen az adatbázisból, tehát egy
        módosítás a következő kérésnél hat, kiléptetés nélkül.
      */
      permissions: permissionsWithOverrides(
        user.role,
        user.permissionOverrides,
      ),
    };
  }

  private emailHash(email: string): string {
    return createHash("sha256")
      .update(email.trim().toLowerCase())
      .digest("hex")
      .slice(0, 12);
  }
}
