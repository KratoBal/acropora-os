import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * A FIXED-WINDOW LIMIT PER CALLER, IN MEMORY (#1582 P4b: the first page the
 * house serves without a login). It bounds one caller's requests per window
 * and, separately, everybody's together, so a caller who forges its address
 * cannot buy more than the shared ceiling.
 *
 * WHAT IT DOES NOT DO, said rather than hidden: it is per API process (a
 * restart or a second replica starts from zero), and the caller's address
 * comes from `X-Forwarded-For` when present, because the API sits behind the
 * web's rewrite and sees only that hop otherwise. A forged header can spread
 * one caller over many keys; the shared ceiling is what still holds then.
 */
export class IpRateLimiter {
  private readonly counts = new Map<string, number>();
  /** how many callers it remembers now (for the test of the ceiling) */
  get size(): number {
    return this.counts.size;
  }
  private window = 0;
  private total = 0;

  constructor(
    private readonly perCaller: number,
    private readonly overall: number,
    private readonly windowMs = 60_000,
  ) {}

  /** True if this request may go on; counts it either way. */
  hit(caller: string, now = Date.now()): boolean {
    const window = Math.floor(now / this.windowMs);
    if (window !== this.window) {
      this.window = window;
      this.counts.clear();
      this.total = 0;
    }
    // once the shared ceiling is spent nothing more is remembered: forged
    // addresses must not grow the map without bound (acrobot 28224)
    if (this.total >= this.overall) return false;
    // a caller past its own limit is refused without spending the shared
    // ceiling: one machine must not use up everybody's (barracuda, 28231)
    const count = this.counts.get(caller) ?? 0;
    if (count >= this.perCaller) return false;
    this.counts.set(caller, count + 1);
    this.total += 1;
    return true;
  }

  /** The same, as a 429 the controller can let fly. */
  check(caller: string): void {
    if (!this.hit(caller))
      throw new HttpException(
        "Túl sok kérés. Próbáld újra egy perc múlva.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }
}

/** The caller's address: the first `X-Forwarded-For` hop, else the socket's. */
export function callerAddress(request: {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}): string {
  const forwarded = request.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
    ?.split(",")[0]
    ?.trim();
  return first || request.ip || "unknown";
}
