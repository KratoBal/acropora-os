/**
 * THE APPLE NONCE (apps/api reefclub-id-token.ts, `appleNonceMatches`): the
 * client keeps a RAW random value and gives Apple its SHA-256 as lowercase hex;
 * the ID token then carries that hash, and the server is sent the raw value
 * and hashes it itself. 32 random bytes, hex: 64 characters (the server takes
 * 16 to 128).
 */
export function newRawNonce(cryptoImpl: Crypto = globalThis.crypto): string {
  const bytes = new Uint8Array(32);
  cryptoImpl.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(
  text: string,
  cryptoImpl: Crypto = globalThis.crypto,
): Promise<string> {
  const digest = await cryptoImpl.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
