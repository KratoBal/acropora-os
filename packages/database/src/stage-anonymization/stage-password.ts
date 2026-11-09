import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

/** The same key length the application's `hashPassword` uses (apps/api/src/users/password.util.ts). */
const KEY_LENGTH = 64;

/** The shortest stage password the helper accepts: the stage is reachable by the team, and every account shares this one password. */
export const MIN_STAGE_PASSWORD_LENGTH = 10;

/**
 * THE STAGE-ONLY PASSWORD HASH (task stage-anonim-proba, second part). The anonymization replaces EVERY password hash with one hash,
 * the hash of the password the owner hands out (`STAGE_ANON_PASSWORD_HASH`). This makes it with the scheme the application checks:
 * `<salt hex>:<scrypt hex>`, 16 random salt bytes, scrypt with the node defaults and a 64 byte key. The scheme is written out here
 * because the database package cannot import from the API; a test in the API package makes the application's own `verifyPassword`
 * accept what this produces, and this accept what the application's `hashPassword` produces, so the two cannot drift apart unseen.
 */
export async function hashStagePassword(password: string): Promise<string> {
  if (password.length < MIN_STAGE_PASSWORD_LENGTH)
    throw new Error(
      `the stage password must be at least ${MIN_STAGE_PASSWORD_LENGTH} characters`,
    );
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

/** Whether a password matches a stored `<salt>:<hash>` (the application's check, written out for the compatibility test). */
export async function verifyStagePassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return (
    expected.length === derived.length && timingSafeEqual(expected, derived)
  );
}
