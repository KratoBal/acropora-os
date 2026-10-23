import type { MailSender } from "../notifications/mail/mail.port.js";
import { createReefClubMailSender } from "../reefclub/reefclub-mail.js";
import { reefClubSmtpRequested } from "../reefclub/reefclub-smtp-mail.js";

/**
 * THE SHOP-SIDE REEFCLUB LETTERS GO FROM THE REEFCLUB'S OWN SENDER, WHEN THE
 * INTERNAL API HAS ONE (reefclub-c3-ertesito-proba; Balázs 2026-10-20: the
 * ReefClub's letters go on Brevo from reefclub@acropora.hu, memory 2433).
 *
 * Three letters are written by the INTERNAL API, not by the ReefClub process:
 * the link code, the link notice and the measurement-release notice
 * (`aquarium-reefclub.service.ts`). They went on the shared `MAIL_SENDER`,
 * which on the test site redirects every letter to TICKET_MAIL_REDIRECT_TO,
 * on Gmail, from info@: so the release notice of the C3 run (2026-10-21) never
 * reached the ReefClub account, and it did not come from the ReefClub.
 *
 * The rule here: as soon as any `REEFCLUB_SMTP_*` name is set ON THE INTERNAL
 * API, these three letters go on the same sender the ReefClub process builds
 * (`createReefClubMailSender`: Brevo SMTP, its own From, and on the test site
 * the `REEFCLUB_MAIL_ALLOW` gate). A half-set configuration stops the start
 * with the missing names, exactly as in the ReefClub process.
 *
 * Unset (the production state today), the answer is `null` and the service
 * keeps the shared sender: nothing changes where nobody configured anything.
 * ONLY the SMTP route is taken here, never the ReefClub's Gmail fallback: the
 * internal API is not meant to hold the ReefClub mailbox's OAuth credentials.
 *
 * WHICH KEY (acrobot 35471): on the test site the existing Brevo SMTP key; in
 * production the internal API gets a SECOND, separately revocable Brevo SMTP
 * key, never the ReefClub process's own one.
 */
export const REEFCLUB_SHOP_MAIL_SENDER = Symbol("REEFCLUB_SHOP_MAIL_SENDER");

export function createReefClubShopMailSender(
  environment: Record<string, string | undefined> = process.env,
): MailSender | null {
  return reefClubSmtpRequested(environment)
    ? createReefClubMailSender(environment)
    : null;
}
