import { Logger } from "@nestjs/common";

import type {
  MailSender,
  OutgoingMail,
} from "../notifications/mail/mail.port.js";

/**
 * THE TEST ENVIRONMENT'S MAIL GATE FOR THE REEFCLUB PROCESS (acrobot 34165,
 * task reefclub-teszt-level-kapu).
 *
 * The ReefClub process sends its own mails (confirmation, "already
 * registered", password reset) straight to the address typed in, through its
 * own sender, not through the internal API's redirecting wrapper. The test
 * site is public, so anybody could make it mail any address. With
 * `REEFCLUB_MAIL_ALLOW` set, a mail goes out only to the listed domains and
 * addresses; every other recipient is dropped and only COUNTED in the log,
 * never named. The caller is not told: a registration goes on as before, only
 * the mail stays behind (the reply must not reveal anything either, plan 7.2).
 *
 * UNSET IS OFF, and that is the production state: the variable is set on the
 * test site only. A value that lists nothing usable blocks every recipient
 * (a typo must not open the gate).
 *
 *   REEFCLUB_MAIL_ALLOW=acropora.hu                    a whole domain
 *   REEFCLUB_MAIL_ALLOW=acropora.hu,tester@example.com a domain and one address
 *
 * A domain matches exactly, not its subdomains or look-alikes
 * (`evil-acropora.hu`, `mail.acropora.hu`): list those separately.
 */
export const REEFCLUB_MAIL_ALLOW = "REEFCLUB_MAIL_ALLOW";

export type ReefClubMailAllow =
  | { kind: "off" }
  | {
      kind: "on";
      domains: ReadonlySet<string>;
      addresses: ReadonlySet<string>;
    };

const DOMAIN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export function reefClubMailAllow(
  environment: Record<string, string | undefined> = process.env,
): ReefClubMailAllow {
  const raw = environment[REEFCLUB_MAIL_ALLOW]?.trim() ?? "";
  if (!raw) return { kind: "off" };
  const domains = new Set<string>();
  const addresses = new Set<string>();
  for (const part of raw.split(",")) {
    const entry = part.trim().toLowerCase();
    const at = entry.lastIndexOf("@");
    if (at === -1) {
      if (DOMAIN.test(entry)) domains.add(entry);
    } else if (at === 0) {
      if (DOMAIN.test(entry.slice(1))) domains.add(entry.slice(1));
    } else if (DOMAIN.test(entry.slice(at + 1)) && !/\s/.test(entry)) {
      addresses.add(entry);
    }
  }
  return { kind: "on", domains, addresses };
}

/** Whether one recipient may get a mail under the gate. */
export function reefClubMailAllowed(
  allow: ReefClubMailAllow,
  address: string,
): boolean {
  if (allow.kind === "off") return true;
  const normalized = address.trim().toLowerCase();
  if (allow.addresses.has(normalized)) return true;
  const at = normalized.lastIndexOf("@");
  return at > 0 && allow.domains.has(normalized.slice(at + 1));
}

export class ReefClubAllowlistMailSender implements MailSender {
  constructor(
    private readonly inner: MailSender,
    private readonly allow: Extract<ReefClubMailAllow, { kind: "on" }>,
    private readonly logger: Pick<Logger, "warn"> = new Logger(
      ReefClubAllowlistMailSender.name,
    ),
  ) {}

  async send(mail: OutgoingMail): Promise<void> {
    const keep = (list: readonly string[] | undefined) =>
      list?.filter((address) => reefClubMailAllowed(this.allow, address));
    const to = keep(mail.to) ?? [];
    const cc = keep(mail.cc);
    const bcc = keep(mail.bcc);
    const dropped =
      mail.to.length -
      to.length +
      (mail.cc?.length ?? 0) -
      (cc?.length ?? 0) +
      (mail.bcc?.length ?? 0) -
      (bcc?.length ?? 0);
    if (dropped > 0)
      this.logger.warn(
        `A ReefClub-levél ${dropped} címzettje nincs a ${REEFCLUB_MAIL_ALLOW} listáján, neki nem ment ki (teszt levél-kapu).`,
      );
    if (to.length === 0) return;
    await this.inner.send({
      ...mail,
      to,
      ...(cc ? { cc } : {}),
      ...(bcc ? { bcc } : {}),
    });
  }
}
