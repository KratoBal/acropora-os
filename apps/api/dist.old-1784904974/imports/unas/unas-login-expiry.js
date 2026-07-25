var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable } from "@nestjs/common";
import { UnasApiError } from "./unas-api.client.js";
export const UNAS_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
export const UNAS_TOKEN_EXPIRY_TOLERANCE_MS = 5 * 60 * 1000;
export const UNAS_TOKEN_MIN_REMAINING_MS = 60 * 1000;
let UnasClock = class UnasClock {
    nowMs() {
        return Date.now();
    }
};
UnasClock = __decorate([
    Injectable()
], UnasClock);
export { UnasClock };
export function assertValidUnasLoginExpiry(expireTimeSeconds, nowMs) {
    if (!Number.isSafeInteger(expireTimeSeconds) || expireTimeSeconds <= 0)
        throw new UnasApiError("RESPONSE_SHAPE_INVALID");
    const expiresAtMs = expireTimeSeconds * 1000;
    const remainingMs = expiresAtMs - nowMs;
    if (!Number.isSafeInteger(expiresAtMs) ||
        remainingMs < UNAS_TOKEN_MIN_REMAINING_MS ||
        remainingMs > UNAS_TOKEN_TTL_MS + UNAS_TOKEN_EXPIRY_TOLERANCE_MS)
        throw new UnasApiError("RESPONSE_SHAPE_INVALID");
}
//# sourceMappingURL=unas-login-expiry.js.map