import { createHash, randomInt } from "node:crypto";

/**
 * THE SHOP-LINK CODE (ReefClub plan v6.1, 3.3; slice 5): random, ten
 * characters from an alphabet without the look-alikes (no I, O, 0, 1), valid
 * for 24 hours, used once. The shop hands it to an identified customer; that
 * hand-over is the confirmation, not an e-mail match.
 *
 * Pure functions, no database: the internal API mints and stores the hash,
 * the ReefClub process normalizes what the user typed and looks the hash up.
 * Both sides import this one file, so the two cannot disagree on the shape.
 *
 * 32^10 is about 1.1e15 codes; with five wrong tries per account an hour and
 * a per-address limit on top, guessing one is not a practical attack.
 */
export const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 10;
export const LINK_CODE_TTL_MS = 24 * 60 * 60 * 1000;

/** A new code in its display form, `XXXXX-XXXXX`. */
export function newLinkCode(): string {
  let raw = "";
  for (let index = 0; index < LINK_CODE_LENGTH; index++)
    raw += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/**
 * What the user typed, back to the stored form: upper case, without spaces
 * and dashes. Null when it cannot be a code at all (wrong length or a
 * character outside the alphabet); the caller answers that like any other
 * wrong code.
 */
export function normalizeLinkCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[\s-]/g, "");
  if (raw.length !== LINK_CODE_LENGTH) return null;
  for (const character of raw)
    if (!LINK_CODE_ALPHABET.includes(character)) return null;
  return raw;
}

/** The stored form: SHA-256 of the normalized code. */
export function hashLinkCode(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}
