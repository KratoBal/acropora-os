import { createTransport } from "nodemailer";

import type {
  MailSender,
  OutgoingMail,
} from "../notifications/mail/mail.port.js";

/**
 * THE REEFCLUB'S SMTP SENDER (Brevo relay, acropora.hu domain: Balázs's
 * decision, memory 2422 — not a Gmail password). It follows the Caparium's
 * sender: the settings come from the environment ONLY, a missing one is named
 * and never a value, the password never appears in a message, and port 587
 * requires STARTTLS (no plain-text fallback), port 465 is TLS from the start.
 *
 *   REEFCLUB_SMTP_HOST      e.g. smtp-relay.brevo.com
 *   REEFCLUB_SMTP_PORT      587 or 465
 *   REEFCLUB_SMTP_USER      the SMTP login
 *   REEFCLUB_SMTP_PASSWORD  the SMTP key (a secret; under the REEFCLUB_ prefix
 *                           the process environment guard lets it in)
 *   REEFCLUB_MAIL_FROM      the sender address, an acropora.hu one
 *   REEFCLUB_MAIL_FROM_NAME optional display name (default "Acropora ReefClub")
 *
 * SMTP is used as soon as ANY `REEFCLUB_SMTP_*` name is set. All of them are
 * then required: a half-set configuration stops the start
 * (`assertReefClubSmtpComplete`) instead of quietly falling back to the Gmail
 * sender or failing at the first registration e-mail.
 */
export const REEFCLUB_SMTP_PREFIX = "REEFCLUB_SMTP_";

export const REEFCLUB_SMTP_NAMES = [
  "REEFCLUB_SMTP_HOST",
  "REEFCLUB_SMTP_PORT",
  "REEFCLUB_SMTP_USER",
  "REEFCLUB_SMTP_PASSWORD",
  "REEFCLUB_MAIL_FROM",
] as const;

const DEFAULT_FROM_NAME = "Acropora ReefClub";

type Environment = Record<string, string | undefined>;

export interface ReefClubSmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  fromName: string;
}

/** Whether the SMTP sender is chosen: any `REEFCLUB_SMTP_*` name has a value. */
export function reefClubSmtpRequested(
  environment: Environment = process.env,
): boolean {
  return Object.keys(environment).some(
    (name) =>
      name.startsWith(REEFCLUB_SMTP_PREFIX) && !!environment[name]?.trim(),
  );
}

/** The names that are missing or unusable; names only, never a value. */
export function reefClubSmtpProblems(
  environment: Environment = process.env,
): string[] {
  const problems: string[] = REEFCLUB_SMTP_NAMES.filter(
    (name) => !environment[name]?.trim(),
  );
  const port = Number(environment.REEFCLUB_SMTP_PORT);
  if (
    !problems.includes("REEFCLUB_SMTP_PORT") &&
    !(Number.isInteger(port) && port > 0 && port < 65536)
  )
    problems.push("REEFCLUB_SMTP_PORT");
  return problems;
}

/** The process start refuses a half-set SMTP configuration. */
export function assertReefClubSmtpComplete(
  environment: Environment = process.env,
): void {
  if (!reefClubSmtpRequested(environment)) return;
  const problems = reefClubSmtpProblems(environment);
  if (problems.length > 0)
    throw new Error(
      "A ReefClub folyamat nem indul: az SMTP-beállítás hiányos vagy hibás: " +
        `${problems.join(", ")}.`,
    );
}

export function reefClubSmtpConfig(
  environment: Environment = process.env,
): ReefClubSmtpConfig {
  const problems = reefClubSmtpProblems(environment);
  if (problems.length > 0)
    throw new Error(
      `A ReefClub levélküldése nincs beállítva: hiányzik vagy hibás: ${problems.join(", ")}.`,
    );
  return {
    host: environment.REEFCLUB_SMTP_HOST!.trim(),
    port: Number(environment.REEFCLUB_SMTP_PORT),
    user: environment.REEFCLUB_SMTP_USER!.trim(),
    password: environment.REEFCLUB_SMTP_PASSWORD!,
    from: environment.REEFCLUB_MAIL_FROM!.trim(),
    fromName: environment.REEFCLUB_MAIL_FROM_NAME?.trim() || DEFAULT_FROM_NAME,
  };
}

/** 587: STARTTLS is required, never a plain-text fallback; 465: TLS from the start. */
export function reefClubSmtpTransportOptions(config: ReefClubSmtpConfig) {
  return {
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.password },
  };
}

/** What the sender needs of a transport: one call. A test passes its own, nothing leaves the machine. */
export interface SmtpTransport {
  sendMail(options: Record<string, unknown>): Promise<unknown>;
}

export type SmtpTransportFactory = (
  options: ReturnType<typeof reefClubSmtpTransportOptions>,
) => SmtpTransport;

/**
 * The send failed. The message carries the error's code (EAUTH, ECONNECTION,
 * ...) and nothing else of the original: a transport error can quote the
 * server's reply or the request, and the SMTP key must never end up in a log.
 */
export class ReefClubMailSendError extends Error {
  constructor(readonly code: string) {
    super(`A ReefClub levele nem ment ki (SMTP: ${code}).`);
    this.name = "ReefClubMailSendError";
  }
}

export class ReefClubSmtpMailSender implements MailSender {
  private readonly transport: SmtpTransport;

  constructor(
    private readonly config: ReefClubSmtpConfig,
    createSmtpTransport: SmtpTransportFactory = (options) =>
      createTransport(options),
  ) {
    this.transport = createSmtpTransport(reefClubSmtpTransportOptions(config));
  }

  async send(mail: OutgoingMail): Promise<void> {
    try {
      await this.transport.sendMail({
        // The sender is the configured one. `mail.from` is ignored on purpose:
        // no caller of the public process may choose the identity it sends as.
        from: { name: this.config.fromName, address: this.config.from },
        to: [...mail.to],
        ...(mail.cc ? { cc: [...mail.cc] } : {}),
        ...(mail.bcc ? { bcc: [...mail.bcc] } : {}),
        subject: mail.subject,
        text: mail.text,
        ...(mail.html ? { html: mail.html } : {}),
        attachments: [
          ...(mail.attachments ?? []).map((attachment) => ({
            filename: attachment.filename,
            contentType: attachment.contentType,
            content: Buffer.from(attachment.bytes),
          })),
          ...(mail.inlineImages ?? []).map((image) => ({
            filename: image.filename,
            contentType: image.contentType,
            content: Buffer.from(image.bytes),
            cid: image.contentId,
          })),
        ],
      });
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      throw new ReefClubMailSendError(
        typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code)
          ? code
          : "UNKNOWN",
      );
    }
  }
}
