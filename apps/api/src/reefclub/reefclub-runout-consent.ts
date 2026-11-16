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
 *
 * AND A FOURTH WHILE THE TEXT IS A DRAFT (acrobot 48513, 2026-11-12): the text below is the DRAFT from the card (cd94ed11,
 * 11-10), so the reminder can be tried on the test site; the final words are Balázs's (or the lawyer's) decision. A draft
 * counts as NO TEXT unless `REEFCLUB_RUNOUT_ALLOW_DRAFT_TEXT` is exactly "true", which only the test site sets. So the
 * code that goes out with it cannot record a consent to a draft anywhere else, even with the other three locks open; and
 * every row recorded on the test names the draft version. The final text comes with `RUNOUT_CONSENT_IS_DRAFT = false`
 * and a NEW version, in one change.
 */

/** The text the member sees at the switch: today the DRAFT (see above), `null` would mean none at all. */
export const RUNOUT_CONSENT_TEXT: string | null =
  "Kérem, hogy a ReefClub e-mailben szóljon, mielőtt a kiválasztott termékem a becslés szerint elfogy. A becsléshez a ReefClub a kiválasztott akváriumom térfogatát, a termék gyártói adagolását és kiszerelését, valamint – ha van ilyen – az Acropora webshopban ezt a terméket tartalmazó legutóbbi rendelésem feladásának napját használja. Az emlékeztető tájékoztató becslés, a tényleges fogyás ettől eltérhet. A hozzájárulásomat bármikor visszavonhatom a fiókomban, vagy a levelekben található leiratkozó hivatkozással.";

/** The version of the text, stored with every consent. Moves with the text, never alone. */
export const RUNOUT_CONSENT_VERSION =
  "kifogyas-emlekezteto-tervezet-2026-11-10";

/** True while the text is the draft: then only the test site (`REEFCLUB_RUNOUT_ALLOW_DRAFT_TEXT`) may use it. */
export const RUNOUT_CONSENT_IS_DRAFT = true;

export const RUNOUT_DRAFT_ENV = "REEFCLUB_RUNOUT_ALLOW_DRAFT_TEXT";

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
  // the draft mark belongs to THIS text: a caller's own text (a test) is not a draft
  isDraft: boolean = text === RUNOUT_CONSENT_TEXT && RUNOUT_CONSENT_IS_DRAFT,
): RunOutAvailability {
  if (environment[RUNOUT_SWITCH] !== "true") return { kind: "off" };
  if (!text?.trim()) return { kind: "no-text" };
  // a draft is no text where the draft is not allowed: the same answer, so no reader learns a new state
  if (isDraft && environment[RUNOUT_DRAFT_ENV] !== "true")
    return { kind: "no-text" };
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
