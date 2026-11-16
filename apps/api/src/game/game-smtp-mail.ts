import type { MailSender } from "../notifications/mail/mail.port.js";
import { RedirectingMailSender } from "../notifications/mail/redirecting-mail.sender.js";
import {
  ReefClubSmtpMailSender,
  type ReefClubSmtpConfig,
  type SmtpTransportFactory,
} from "../reefclub/reefclub-smtp-mail.js";

/**
 * THE GIVEAWAY'S OWN MAIL SENDER (acrobot 44556, Balázs 2026-11-06 19:24 UTC): the confirmation mail and the test mail go on
 * Brevo SMTP from jatek@acropora.hu as "Acropora Nyereményjáték", NOT from the ticket desk's Gmail (ticket@). The acropora.hu
 * domain is authenticated on Brevo (DKIM). The transport is the ReefClub's (`ReefClubSmtpMailSender`: STARTTLS required on
 * 587, TLS on 465, the error carries only its code, the identity is the configured one whatever a caller asks); only the
 * names differ. The settings come from the environment ONLY, a missing one is named and never a value:
 *
 *   JATEK_SMTP_HOST        e.g. smtp-relay.brevo.com
 *   JATEK_SMTP_PORT        587 or 465
 *   JATEK_SMTP_USER        the SMTP login
 *   JATEK_SMTP_PASS        the SMTP key (a secret)
 *   JATEK_MAIL_FROM        the From header: Acropora Nyereményjáték <jatek@acropora.hu>
 *   JATEK_MAIL_REPLY_TO    optional Reply-To: the contact address of the privacy notice (info@acropora.hu)
 *
 * WITHOUT THEM THE MAIL DOES NOT GO, and does not fall back to the ticket desk's sender: `createGameMailSender` answers `null`,
 * the service's gate closes with `no-game-sender` and the admin's test button says so. The stage redirect
 * (TICKET_MAIL_REDIRECT_TO) stays: the sender is wrapped in the same `RedirectingMailSender` as the shared one, so a stage
 * never mails a player; TICKET_MAIL_MODE and TICKET_MAIL_GAME stay in the service.
 */
export const GAME_SMTP_NAMES = [
  "JATEK_SMTP_HOST",
  "JATEK_SMTP_PORT",
  "JATEK_SMTP_USER",
  "JATEK_SMTP_PASS",
  "JATEK_MAIL_FROM",
] as const;

type Environment = Record<string, string | undefined>;

const ADDRESS = /^[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@"]+$/;

/** "Név <cím@x.hu>" or a bare address, as a name and an address; null when it is neither. */
export function parseMailFrom(
  value: string,
): { name: string; address: string } | null {
  const text = value.trim();
  const bracket = /^(.*?)\s*<([^<>]+)>$/.exec(text);
  if (bracket) {
    const address = bracket[2]!.trim();
    const name = bracket[1]!.trim().replace(/^"(.*)"$/, "$1");
    return ADDRESS.test(address) ? { name, address } : null;
  }
  return ADDRESS.test(text) ? { name: "", address: text } : null;
}

/** The names that are missing or unusable; names only, never a value. */
export function gameSmtpProblems(environment: Environment): string[] {
  const problems: string[] = GAME_SMTP_NAMES.filter(
    (name) => !environment[name]?.trim(),
  );
  const port = Number(environment.JATEK_SMTP_PORT);
  if (
    !problems.includes("JATEK_SMTP_PORT") &&
    !(Number.isInteger(port) && port > 0 && port < 65536)
  )
    problems.push("JATEK_SMTP_PORT");
  if (
    !problems.includes("JATEK_MAIL_FROM") &&
    !parseMailFrom(environment.JATEK_MAIL_FROM!)
  )
    problems.push("JATEK_MAIL_FROM");
  const replyTo = environment.JATEK_MAIL_REPLY_TO?.trim();
  if (replyTo && !ADDRESS.test(replyTo)) problems.push("JATEK_MAIL_REPLY_TO");
  return problems;
}

export function gameSmtpConfig(
  environment: Environment,
): ReefClubSmtpConfig | null {
  if (gameSmtpProblems(environment).length > 0) return null;
  const from = parseMailFrom(environment.JATEK_MAIL_FROM!)!;
  const replyTo = environment.JATEK_MAIL_REPLY_TO?.trim();
  return {
    host: environment.JATEK_SMTP_HOST!.trim(),
    port: Number(environment.JATEK_SMTP_PORT),
    user: environment.JATEK_SMTP_USER!.trim(),
    password: environment.JATEK_SMTP_PASS!,
    from: from.address,
    fromName: from.name || "Acropora Nyereményjáték",
    ...(replyTo ? { replyTo } : {}),
  };
}

/** The game's sender, behind the stage redirect; null when the settings are missing or unusable. */
export function createGameMailSender(
  environment: NodeJS.ProcessEnv = process.env,
  createSmtpTransport?: SmtpTransportFactory,
): MailSender | null {
  const config = gameSmtpConfig(environment);
  if (!config) return null;
  return new RedirectingMailSender(
    new ReefClubSmtpMailSender(config, createSmtpTransport),
    environment,
  );
}
