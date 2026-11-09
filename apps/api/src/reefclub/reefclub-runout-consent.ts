import { randomBytes } from "node:crypto";

/**
 * THE "WHEN DOES IT RUN OUT" REMINDER'S CONSENT (ReefClub V3.2, card cd94ed11, slice 2). A member turns the reminder on PER
 * PRODUCT, for one of their aquariums (the pack's days are counted from its litres); nothing is sent until the member has
 * done so, and every mail carries the unsubscribe link of that row.
 *
 * TWO THINGS KEEP IT OFF TODAY, and either one is enough:
 *   1. the switch `REEFCLUB_RUNOUT_ENABLED` (exactly "true"; unset or anything else is off);
 *   2. the consent TEXT: `RUNOUT_CONSENT_TEXT` is `null` because Balázs (or the lawyer) has not given the words yet, and no
 *      consent can be recorded for text that does not exist. The day the text is given, it replaces the `null` here together
 *      with a NEW `RUNOUT_CONSENT_VERSION`, in one change, so a row always names the text its member saw.
 */

/** THE PLACEHOLDER: the text of the consent, not given yet. A string here is the text the member sees at the switch. */
export const RUNOUT_CONSENT_TEXT: string | null = null;

/** The version of the text, stored with every consent. Moves with the text, never alone. */
export const RUNOUT_CONSENT_VERSION = "kifogyas-emlekezteto-helyorzo";

export const RUNOUT_SWITCH = "REEFCLUB_RUNOUT_ENABLED";

export type RunOutAvailability =
  | { kind: "available"; text: string; version: string }
  | { kind: "off" }
  | { kind: "no-text" };

export function runOutAvailability(
  environment: Record<string, string | undefined> = process.env,
  text: string | null = RUNOUT_CONSENT_TEXT,
  version: string = RUNOUT_CONSENT_VERSION,
): RunOutAvailability {
  if (environment[RUNOUT_SWITCH] !== "true") return { kind: "off" };
  if (!text?.trim()) return { kind: "no-text" };
  return { kind: "available", text, version };
}

/** The unsubscribe link's key: 32 random bytes, base64url (a bearer key for ONE action, the unsubscribe, nothing else). */
export const newUnsubscribeToken = (): string =>
  randomBytes(32).toString("base64url");
