import { GmailMailSender } from "../notifications/mail/gmail-mail.sender.js";
import type {
  MailSender,
  OutgoingMail,
} from "../notifications/mail/mail.port.js";

export const REEFCLUB_MAIL_SENDER = Symbol("REEFCLUB_MAIL_SENDER");

const DEFAULT_WEB_URL = "http://localhost:3005";
const DEFAULT_FROM_NAME = "Acropora ReefClub";

/** The ReefClub web address the e-mail links point to, without a trailing slash. */
export function reefClubWebUrl(
  environment: Record<string, string | undefined> = process.env,
): string {
  return (environment.REEFCLUB_WEB_URL?.trim() || DEFAULT_WEB_URL).replace(
    /\/+$/,
    "",
  );
}

/**
 * THE REEFCLUB SENDS FROM ITS OWN MAILBOX, WITH ITS OWN CREDENTIALS (plan
 * v6.1, 2.1: "a levélküldés saját feladója"; the internal Gmail access is on
 * the forbidden list).
 *
 * The transport is the existing Gmail sender, not a second implementation of
 * it: that class reads its configuration from an injected environment object,
 * and here it gets one built ONLY from `REEFCLUB_MAIL_*` names. The process
 * environment never contains a `GMAIL_*` name (the start refuses it), so the
 * internal refresh tokens cannot be picked up even by mistake.
 *
 * Unconfigured is a state, not an error, the same as for the internal sender:
 * the process starts, and every send fails with `TICKET_MAIL_NOT_CONFIGURED`,
 * which the service logs. Which mailbox and domain (SPF, DKIM) is not decided
 * yet (plan 10, [N]); this only fixes that it is a separate one.
 */
export function reefClubMailEnvironment(
  environment: Record<string, string | undefined> = process.env,
): NodeJS.ProcessEnv {
  return {
    GMAIL_TICKET_CLIENT_ID: environment.REEFCLUB_MAIL_CLIENT_ID,
    GMAIL_TICKET_CLIENT_SECRET: environment.REEFCLUB_MAIL_CLIENT_SECRET,
    GMAIL_TICKET_REFRESH_TOKEN: environment.REEFCLUB_MAIL_REFRESH_TOKEN,
    GMAIL_TICKET_USER: environment.REEFCLUB_MAIL_FROM,
    GMAIL_TICKET_USER_NAME:
      environment.REEFCLUB_MAIL_FROM_NAME?.trim() || DEFAULT_FROM_NAME,
  };
}

export function createReefClubMailSender(
  environment: Record<string, string | undefined> = process.env,
): MailSender {
  return new GmailMailSender(fetch, reefClubMailEnvironment(environment));
}

/*
  THE TOKEN TRAVELS IN THE URL FRAGMENT (`#token=`), NOT IN THE QUERY. A browser
  never sends the fragment to a server, so the token stays out of access logs,
  proxies and the Referer header of whatever the page loads. The web page
  (slice 9) reads it from `location.hash` and posts it.
*/

export function verificationMail(
  to: string,
  token: string,
  webUrl: string,
): OutgoingMail {
  return {
    to: [to],
    subject: "Erősítsd meg a ReefClub-regisztrációdat",
    text: [
      "Szia!",
      "",
      "A ReefClub-fiókod megerősítéséhez nyisd meg ezt a linket 24 órán belül:",
      `${webUrl}/email-megerosites#token=${token}`,
      "",
      "Ha nem te regisztráltál, hagyd figyelmen kívül ezt a levelet: megerősítés nélkül a fiók nem használható.",
      "",
      "Acropora ReefClub",
    ].join("\n"),
  };
}

/**
 * Sent when someone registers an address that already has a working account.
 * The answer to the registration request is the same 202 either way (plan
 * 3.2); only the owner of the mailbox learns which case it was.
 */
export function alreadyRegisteredMail(
  to: string,
  webUrl: string,
): OutgoingMail {
  return {
    to: [to],
    subject: "ReefClub-regisztráció",
    text: [
      "Szia!",
      "",
      "Ezzel az e-mail címmel már van ReefClub-fiók, ezért nem hoztunk létre újat.",
      `Belépés: ${webUrl}/belepes`,
      `Ha elfelejtetted a jelszavadat, itt kérhetsz újat: ${webUrl}/jelszo-visszaallitas`,
      "",
      "Ha nem te próbáltál regisztrálni, nincs teendőd: a fiókod nem változott.",
      "",
      "Acropora ReefClub",
    ].join("\n"),
  };
}

export function passwordResetMail(
  to: string,
  token: string,
  webUrl: string,
): OutgoingMail {
  return {
    to: [to],
    subject: "ReefClub jelszó-visszaállítás",
    text: [
      "Szia!",
      "",
      "Új jelszót ezen a linken állíthatsz be, egy órán belül:",
      `${webUrl}/jelszo-visszaallitas#token=${token}`,
      "",
      "Az új jelszó beállítása után minden eszközön újra be kell lépned.",
      "Ha nem te kérted, hagyd figyelmen kívül ezt a levelet: a jelszavad nem változik.",
      "",
      "Acropora ReefClub",
    ].join("\n"),
  };
}
