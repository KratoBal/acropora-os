import { Logger } from "@nestjs/common";

import type {
  ReefClubJwk,
  ReefClubKeyLookup,
  ReefClubProviderConfig,
} from "./reefclub-id-token.js";

/** How long a fetched key set is used without asking again, by default. */
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;
/** An unknown `kid` refetches at most this often: a flood of made-up ids is not a flood of requests. */
const REFETCH_MIN_INTERVAL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

interface CachedSet {
  keys: ReefClubJwk[];
  expiresAt: number;
  fetchedAt: number;
}

export type ReefClubFetch = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

/**
 * THE PROVIDERS' PUBLIC KEYS, FETCHED AND KEPT (Google and Apple rotate them;
 * both publish a JWK set and a Cache-Control max-age).
 *
 * A set is kept until its max-age (an hour if none is given). A token whose
 * `kid` is not in the kept set triggers one refetch, because that is what a
 * rotation looks like, but not more often than once a minute per provider.
 * A failed fetch keeps the old set and answers "unknown key" for the new id:
 * the login fails closed, it never falls back to skipping the check.
 */
export class ReefClubIdentityKeys {
  private readonly logger = new Logger(ReefClubIdentityKeys.name);
  private readonly sets = new Map<string, CachedSet>();

  constructor(
    private readonly fetcher: ReefClubFetch = fetch as unknown as ReefClubFetch,
    private readonly clock: () => number = Date.now,
  ) {}

  readonly lookup: ReefClubKeyLookup = async (config, kid) => {
    const now = this.clock();
    let set = this.sets.get(config.jwksUrl);
    if (!set || set.expiresAt <= now) set = (await this.fetch(config)) ?? set;
    let key = findKey(set, kid);
    if (!key && set && now - set.fetchedAt >= REFETCH_MIN_INTERVAL_MS) {
      set = (await this.fetch(config)) ?? set;
      key = findKey(set, kid);
    }
    return key;
  };

  private async fetch(
    config: ReefClubProviderConfig,
  ): Promise<CachedSet | undefined> {
    const now = this.clock();
    try {
      const response = await this.fetcher(config.jwksUrl, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { keys?: unknown };
      if (!Array.isArray(body.keys)) throw new Error("no keys");
      const set: CachedSet = {
        keys: body.keys.filter(
          (key): key is ReefClubJwk => !!key && typeof key === "object",
        ),
        fetchedAt: now,
        expiresAt: now + maxAge(response.headers.get("cache-control")),
      };
      this.sets.set(config.jwksUrl, set);
      return set;
    } catch (error) {
      const code = error instanceof Error ? error.message : "UNKNOWN";
      this.logger.warn(`A ${config.provider} kulcsai nem jöttek le (${code}).`);
      // A failed attempt still counts for the once-a-minute limit.
      const old = this.sets.get(config.jwksUrl);
      if (old) old.fetchedAt = now;
      return undefined;
    }
  }
}

function findKey(set: CachedSet | undefined, kid: string): ReefClubJwk | null {
  return set?.keys.find((key) => key.kid === kid) ?? null;
}

function maxAge(cacheControl: string | null): number {
  const match = /max-age=(\d+)/i.exec(cacheControl ?? "");
  const seconds = match ? Number(match[1]) : NaN;
  // Bounded both ways: a zero would refetch on every login, a year would miss
  // a revoked key for a year.
  return Number.isFinite(seconds)
    ? Math.min(Math.max(seconds * 1000, 5 * 60 * 1000), 24 * 60 * 60 * 1000)
    : DEFAULT_MAX_AGE_MS;
}
