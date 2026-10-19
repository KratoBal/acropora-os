import { Injectable } from "@nestjs/common";

import { IpRateLimiter } from "../common/ip-rate-limit.js";

const MINUTE = 60_000;

/**
 * THE LIMITS ON THE ENDPOINTS ANYBODY CAN CALL (plan v6.1, 3.1: register,
 * login and password reset are limited per address AND per account).
 *
 * Each limit is the in-memory, fixed-window `IpRateLimiter`, keyed either by
 * the caller's address or by the normalized e-mail. Per process, as that class
 * says of itself: with one replica it holds, with more it needs a shared store
 * (plan 3.1 names this). The per-e-mail key is what stops spreading a password
 * guess over many addresses; the per-address key is what stops one machine
 * walking through many e-mails; the shared ceiling of each holds when both are
 * forged.
 */
@Injectable()
export class ReefClubRateLimits {
  readonly registerByAddress = new IpRateLimiter(10, 300, 10 * MINUTE);
  readonly registerByEmail = new IpRateLimiter(3, 10_000, 10 * MINUTE);
  readonly loginByAddress = new IpRateLimiter(20, 1_000, MINUTE);
  readonly loginByEmail = new IpRateLimiter(5, 10_000, 15 * MINUTE);
  readonly resetByAddress = new IpRateLimiter(5, 300, 10 * MINUTE);
  readonly resetByEmail = new IpRateLimiter(3, 10_000, 60 * MINUTE);
  readonly tokenByAddress = new IpRateLimiter(20, 1_000, MINUTE);
}
