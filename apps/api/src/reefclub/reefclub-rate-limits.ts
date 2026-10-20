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
const HOUR = 60 * MINUTE;

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
  /** Google and Apple sign-in and linking: each one a signature check and maybe a key fetch. */
  readonly externalByAddress = new IpRateLimiter(20, 1_000, MINUTE);
  /**
   * Writes a public account can repeat (barracuda, #1724 review a): each new
   * aquarium also spends an internal aquarium number. The per-account ceiling
   * on the number of aquariums is `REEFCLUB_MAX_OWN_AQUARIUMS`.
   */
  readonly aquariumCreateByAccount = new IpRateLimiter(10, 1_000, HOUR);
  readonly measurementCreateByAccount = new IpRateLimiter(60, 10_000, HOUR);
  /** Every shop-link redemption attempt, right or wrong. */
  readonly shopLinkByAddress = new IpRateLimiter(20, 1_000, MINUTE);
  /**
   * The WRONG redemptions (plan 3.3): five per account in an hour lock that
   * account's redemption for the rest of the hour, a correct code included;
   * twenty per address do the same for the address, because one person can
   * open many accounts (barracuda, the v1 review).
   */
  readonly shopLinkFailuresByAccount = new FailureLock(5, HOUR);
  readonly shopLinkFailuresByAddress = new FailureLock(20, HOUR);
  /** All wrong redemptions together: past this, the alarm (plan 3.3). */
  readonly shopLinkFailuresOverall = new FailureLock(
    SHOP_LINK_ALARM_THRESHOLD,
    HOUR,
  );
}

/** The number of wrong redemptions in an hour, all callers together, that raises the alarm. */
export const SHOP_LINK_ALARM_THRESHOLD = 100;
/** How many own aquariums one account may have. */
export const REEFCLUB_MAX_OWN_AQUARIUMS = 20;

/**
 * FAILURES IN A ROLLING WINDOW, PER KEY, IN MEMORY. Unlike `IpRateLimiter`
 * it counts only what the caller reports as a failure, and asking whether a
 * key is locked does not count anything: a correct code must not use up the
 * budget, and a locked account must stay locked whatever it sends.
 *
 * Per process, like every limit here (plan 3.1). The map is bounded: past
 * `maxKeys` the keys with no failure left in the window are dropped, and if
 * that is not enough, the oldest keys go first.
 */
export class FailureLock {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 50_000,
  ) {}

  locked(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= this.limit;
  }

  /** Records one failure; returns how many the key has in the window now. */
  fail(key: string, now = Date.now()): number {
    const list = this.recent(key, now);
    list.push(now);
    this.failures.delete(key);
    this.failures.set(key, list);
    if (this.failures.size > this.maxKeys) this.prune(now);
    return list.length;
  }

  private recent(key: string, now: number): number[] {
    return (this.failures.get(key) ?? []).filter(
      (moment) => now - moment < this.windowMs,
    );
  }

  private prune(now: number): void {
    for (const [key, list] of this.failures)
      if (!list.some((moment) => now - moment < this.windowMs))
        this.failures.delete(key);
    for (const key of this.failures.keys()) {
      if (this.failures.size <= this.maxKeys) break;
      this.failures.delete(key);
    }
  }
}
