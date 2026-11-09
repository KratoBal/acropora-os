import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * THE "WHEN DOES IT RUN OUT" REMINDER'S CONSENT (ReefClub V3.2, card cd94ed11, slice 2). A member turns the reminder on PER
 * PRODUCT, for one of their aquariums (the pack's days are counted from its litres); nothing is sent until the member has
 * done so, and every mail carries the unsubscribe link of that row.
 *
 * THREE THINGS KEEP IT OFF, and any one is enough (the first two today):
 *   1. the switch `REEFCLUB_RUNOUT_ENABLED` (exactly "true"; unset or anything else is off);
 *   2. the consent TEXT: `RUNOUT_CONSENT_TEXT` is `null` because Balázs (or the lawyer) has not given the words yet, and no
 *      consent can be recorded for text that does not exist. The day the text is given, it replaces the `null` here together
 *      with a NEW `RUNOUT_CONSENT_VERSION`, in one change, so a row always names the text its member saw;
 *   3. the unsubscribe secret `REEFCLUB_RUNOUT_UNSUBSCRIBE_SECRET` (at least 32 characters): without it no mail could carry a
 *      working link, so nothing is recorded.
 */

/** THE PLACEHOLDER: the text of the consent, not given yet. A string here is the text the member sees at the switch. */
export const RUNOUT_CONSENT_TEXT: string | null = null;

/** The version of the text, stored with every consent. Moves with the text, never alone. */
export const RUNOUT_CONSENT_VERSION = "kifogyas-emlekezteto-helyorzo";

export const RUNOUT_SWITCH = "REEFCLUB_RUNOUT_ENABLED";

export type RunOutAvailability =
  | { kind: "available"; text: string; version: string }
  | { kind: "off" }
  | { kind: "no-text" }
  | { kind: "no-secret" };

export function runOutAvailability(
  environment: Record<string, string | undefined> = process.env,
  text: string | null = RUNOUT_CONSENT_TEXT,
  version: string = RUNOUT_CONSENT_VERSION,
): RunOutAvailability {
  if (environment[RUNOUT_SWITCH] !== "true") return { kind: "off" };
  if (!text?.trim()) return { kind: "no-text" };
  // a consent whose mail cannot carry a working unsubscribe link must not be recorded
  if (!hasUsableSecret(environment[RUNOUT_SECRET_ENV]))
    return { kind: "no-secret" };
  return { kind: "available", text, version };
}

/**
 * THE UNSUBSCRIBE KEY IS COMPUTED, NOT STORED (acrobot, 44788): `<reminder id>.<HMAC-SHA256(secret, id)>`, base64url. Every mail
 * of a row carries the same key, and EVERY MAIL EVER SENT KEEPS A WORKING LINK (a stored, replaceable key would end the older
 * ones). The table holds nothing a copy could unsubscribe with; without the secret a key cannot be made, and one id's key says
 * nothing about another's. Changing the secret ends every link already sent, so it is set once and kept.
 */
export const RUNOUT_SECRET_ENV = "REEFCLUB_RUNOUT_UNSUBSCRIBE_SECRET";
export const MIN_SECRET_LENGTH = 32;

const hasUsableSecret = (secret: string | undefined): secret is string =>
  typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH;

const mac = (secret: string, reminderId: string): Buffer =>
  createHmac("sha256", secret)
    .update(`runout-unsubscribe:v1:${reminderId}`)
    .digest();

export function unsubscribeKeyFor(reminderId: string, secret: string): string {
  if (!hasUsableSecret(secret))
    throw new Error(
      `${RUNOUT_SECRET_ENV} is missing or shorter than ${MIN_SECRET_LENGTH} characters`,
    );
  if (!REMINDER_ID.test(reminderId)) throw new Error("not a reminder id");
  return `${reminderId}.${mac(secret, reminderId).toString("base64url")}`;
}

const REMINDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The row id a key belongs to, or null for anything that is not exactly a key made with this secret. */
export function reminderIdFromKey(key: string, secret: string): string | null {
  if (!hasUsableSecret(secret)) {
    throw new Error(
      `${RUNOUT_SECRET_ENV} is missing or shorter than ${MIN_SECRET_LENGTH} characters`,
    );
  }
  if (typeof key !== "string") return null;
  const dot = key.lastIndexOf(".");
  if (dot < 1) return null;
  const id = key.slice(0, dot);
  if (!REMINDER_ID.test(id)) return null;
  const given = Buffer.from(key.slice(dot + 1), "base64url");
  const expected = mac(secret, id);
  if (given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? id : null;
}
