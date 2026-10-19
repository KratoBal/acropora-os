import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  UnauthorizedException,
} from "@nestjs/common";

import { generateSessionToken } from "../auth/session-token.util.js";
import { hashPassword, verifyPassword } from "../users/password.util.js";
import type {
  MailSender,
  OutgoingMail,
} from "../notifications/mail/mail.port.js";
import {
  type ReefClubAccountRecord,
  ReefClubAccountRepository,
} from "./reefclub-account.repository.js";
import {
  alreadyRegisteredMail,
  passwordResetMail,
  REEFCLUB_MAIL_SENDER,
  reefClubWebUrl,
  verificationMail,
} from "./reefclub-mail.js";
import { ReefClubSessionRepository } from "./reefclub-session.repository.js";

export interface ReefClubIssuedSession {
  token: string;
  expiresAt: Date;
}

export interface ReefClubMe {
  email: string;
  loginMethods: "PASSWORD"[];
  notifyOnRelease: boolean;
  consentVersion: string;
}

/** One message for every failed login, whatever failed. */
const LOGIN_FAILED = "Hibás e-mail cím vagy jelszó.";

/**
 * Registration, e-mail verification, login, password reset (plan v6.1, 3.2).
 *
 * WHAT THE CALLER CAN LEARN ABOUT AN E-MAIL ADDRESS: nothing from register or
 * password-reset (always 202, and the work runs after the answer, so the
 * response time does not depend on whether an account exists either); from
 * login only "wrong" or "not yet verified", and the second only after the
 * correct password.
 */
@Injectable()
export class ReefClubAuthService implements OnModuleDestroy {
  private readonly logger = new Logger(ReefClubAuthService.name);
  private readonly pending = new Set<Promise<void>>();
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly accounts: ReefClubAccountRepository,
    private readonly sessions: ReefClubSessionRepository,
    @Inject(REEFCLUB_MAIL_SENDER) private readonly mail: MailSender,
  ) {}

  /** Answers at once; the account work and the e-mail run in the background. */
  register(email: string, password: string, consentVersion: string): void {
    this.background("register", () =>
      this.registerNow(normalizeEmail(email), password, consentVersion),
    );
  }

  /** Same shape as `register`: the answer never depends on the address. */
  requestPasswordReset(email: string): void {
    this.background("password-reset", () =>
      this.requestPasswordResetNow(normalizeEmail(email)),
    );
  }

  async verifyEmail(token: string): Promise<boolean> {
    return this.accounts.verifyEmail(token);
  }

  async confirmPasswordReset(
    token: string,
    password: string,
  ): Promise<boolean> {
    const passwordHash = await hashPassword(password);
    return this.accounts.resetPassword(token, passwordHash);
  }

  async login(email: string, password: string): Promise<ReefClubIssuedSession> {
    const account = await this.accounts.findByEmail(normalizeEmail(email));
    // An unknown address still pays for one scrypt, so the answer takes as long
    // as a wrong password on a real account.
    const stored = account?.passwordHash ?? (await this.dummyPasswordHash());
    const matches = await verifyPassword(password, stored);
    if (!account || !account.passwordHash || !matches)
      throw new UnauthorizedException(LOGIN_FAILED);
    if (!account.emailVerifiedAt)
      throw new ForbiddenException(
        "Előbb erősítsd meg az e-mail címedet: a regisztrációkor küldött levélben találod a linket.",
      );
    const token = generateSessionToken();
    const expiresAt = await this.sessions.create(account.id, token);
    return { token, expiresAt };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.sessions.deleteByToken(token);
  }

  async me(accountId: string): Promise<ReefClubMe> {
    const account = await this.accounts.findById(accountId);
    // The guard just resolved a session for this id; an account gone between
    // the two reads is a session that no longer has an owner.
    if (!account)
      throw new UnauthorizedException("Érvénytelen vagy lejárt munkamenet.");
    return toMe(account);
  }

  async updateMe(
    accountId: string,
    notifyOnRelease: boolean,
  ): Promise<ReefClubMe> {
    return toMe(
      await this.accounts.updateNotifyOnRelease(accountId, notifyOnRelease),
    );
  }

  /** Lets the in-flight background work finish before the database closes. */
  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  /** For tests: resolves when every background task started so far is done. */
  async settled(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  private async registerNow(
    email: string,
    password: string,
    consentVersion: string,
  ): Promise<void> {
    const passwordHash = await hashPassword(password);
    const token = generateSessionToken();
    const webUrl = reefClubWebUrl();
    const existing = await this.accounts.findByEmail(email);

    if (!existing) {
      const created = await this.accounts.createUnverified({
        email,
        passwordHash,
        consentVersion,
        token,
      });
      if (created) return this.send(verificationMail(email, token, webUrl));
      // Lost a race with a parallel registration: the other one sends the link.
      return;
    }

    if (!existing.emailVerifiedAt) {
      const replaced = await this.accounts.replaceUnverifiedCredentials({
        accountId: existing.id,
        passwordHash,
        consentVersion,
        token,
      });
      if (replaced) return this.send(verificationMail(email, token, webUrl));
    }
    return this.send(alreadyRegisteredMail(email, webUrl));
  }

  private async requestPasswordResetNow(email: string): Promise<void> {
    const account = await this.accounts.findByEmail(email);
    if (!account) return;
    const token = generateSessionToken();
    await this.accounts.issuePasswordReset(account.id, token);
    await this.send(passwordResetMail(email, token, reefClubWebUrl()));
  }

  private async send(mail: OutgoingMail): Promise<void> {
    try {
      await this.mail.send(mail);
    } catch (error) {
      // The address stays out of the log; the code says what went wrong.
      const code = error instanceof Error ? error.message : "UNKNOWN";
      this.logger.warn(`A ReefClub-levél nem ment ki (${code}).`);
    }
  }

  private background(label: string, work: () => Promise<void>): void {
    const task = work().catch((error: unknown) => {
      const code = error instanceof Error ? error.name : "UNKNOWN";
      this.logger.error(`A ReefClub ${label} háttérmunka elhasalt (${code}).`);
    });
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  }

  private dummyPasswordHash(): Promise<string> {
    this.dummyHash ??= hashPassword("reefclub-nincs-ilyen-fiok");
    return this.dummyHash;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toMe(account: ReefClubAccountRecord): ReefClubMe {
  return {
    email: account.email,
    loginMethods: account.passwordHash ? ["PASSWORD"] : [],
    notifyOnRelease: account.notifyOnRelease,
    consentVersion: account.consentVersion,
  };
}
