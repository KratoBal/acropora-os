import { Injectable } from "@nestjs/common";

import { UnasApiError } from "./unas-api.client.js";

// UNAS documents API-key login tokens as valid for two hours. A five-minute
// upper tolerance covers clock skew without accepting arbitrary future dates.
export const UNAS_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
export const UNAS_TOKEN_EXPIRY_TOLERANCE_MS = 5 * 60 * 1000;
export const UNAS_TOKEN_MIN_REMAINING_MS = 60 * 1000;

@Injectable()
export class UnasClock {
  nowMs(): number {
    return Date.now();
  }
}

export function assertValidUnasLoginExpiry(
  expireTimeSeconds: number,
  nowMs: number,
): void {
  if (!Number.isSafeInteger(expireTimeSeconds) || expireTimeSeconds <= 0)
    throw new UnasApiError("RESPONSE_SHAPE_INVALID");
  const expiresAtMs = expireTimeSeconds * 1000;
  const remainingMs = expiresAtMs - nowMs;
  if (
    !Number.isSafeInteger(expiresAtMs) ||
    remainingMs < UNAS_TOKEN_MIN_REMAINING_MS ||
    remainingMs > UNAS_TOKEN_TTL_MS + UNAS_TOKEN_EXPIRY_TOLERANCE_MS
  )
    throw new UnasApiError("RESPONSE_SHAPE_INVALID");
}
