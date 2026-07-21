import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

/**
 * Jelszó hash-elés Node beépített scrypt implementációjával, saltolva.
 * Külső függőség (bcrypt/argon2) helyett a repo minimál-dependency
 * konvencióját követi (lásd UnasCredentialCryptoService).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const hashBuffer = Buffer.from(hash, "hex");
  if (hashBuffer.length !== derived.length) return false;
  return timingSafeEqual(hashBuffer, derived);
}
