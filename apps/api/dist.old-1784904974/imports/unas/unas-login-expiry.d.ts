export declare const UNAS_TOKEN_TTL_MS: number;
export declare const UNAS_TOKEN_EXPIRY_TOLERANCE_MS: number;
export declare const UNAS_TOKEN_MIN_REMAINING_MS: number;
export declare class UnasClock {
    nowMs(): number;
}
export declare function assertValidUnasLoginExpiry(expireTimeSeconds: number, nowMs: number): void;
