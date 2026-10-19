import { Injectable } from "@nestjs/common";

import { IpRateLimiter } from "../common/ip-rate-limit.js";

/**
 * THE CALLER'S ADDRESS, FROM THE HOP OUR OWN PROXY ADDED (barracuda, #1717
 * review, point B).
 *
 * The shared `callerAddress` takes the FIRST `X-Forwarded-For` entry. The
 * client writes that one; each proxy APPENDS the address it saw. So with that
 * reading every request can claim a new address, the per-address limit never
 * fills, and only the shared ceiling is left, which then locks EVERYBODY out:
 * a thousand forged logins a minute would stop every ReefClub login. On an
 * internal page that was an accepted trade (#1582 P4b); on a public customer
 * login it is a cheap lockout.
 *
 * Here the address is the entry `hops` places from the RIGHT, where
 * `REEFCLUB_TRUSTED_PROXY_HOPS` is the number of proxies in front of the
 * process that append to the header (default 1). Fewer entries than that, or
 * none, falls back to the socket address, never to a client-written entry.
 *
 * THE CHAIN IS NOT MEASURED YET: the gateway is slice 6. Until the hop count is
 * set from a measurement, a wrong value either trusts one client-written entry
 * (too high) or limits the proxy itself as one caller (too low); in both cases
 * the shared ceiling remains a lever to lock everybody out, and the PR says so.
 */
export function reefClubCallerAddress(
  request: {
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
  },
  hops: number = trustedProxyHops(),
): string {
  const raw = request.headers["x-forwarded-for"];
  const entries = (Array.isArray(raw) ? raw.join(",") : (raw ?? ""))
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (hops >= 1 && entries.length >= hops)
    return entries[entries.length - hops]!;
  return request.ip || "unknown";
}

export function trustedProxyHops(
  environment: Record<string, string | undefined> = process.env,
): number {
  const value = Number(environment.REEFCLUB_TRUSTED_PROXY_HOPS ?? "1");
  return Number.isInteger(value) && value >= 0 && value <= 5 ? value : 1;
}

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
