import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
export async function hashPassword(password) {
    const salt = randomBytes(16).toString("hex");
    const derived = (await scrypt(password, salt, KEY_LENGTH));
    return `${salt}:${derived.toString("hex")}`;
}
export async function verifyPassword(password, stored) {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash)
        return false;
    const derived = (await scrypt(password, salt, KEY_LENGTH));
    const hashBuffer = Buffer.from(hash, "hex");
    if (hashBuffer.length !== derived.length)
        return false;
    return timingSafeEqual(hashBuffer, derived);
}
//# sourceMappingURL=password.util.js.map