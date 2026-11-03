/**
 * AN EXPENSIVE READ, CACHED FOR THE DASHBOARD (owner decision, PR #1379, 2026-10-02: a
 * 5-minute in-process cache is fine).
 *
 * The value is kept for `ttlMs`, in this process only. Concurrent loads share ONE run, and a
 * failure is never cached: the next load tries again. Used by the missing-invoice check and
 * the webshop order queue, which both rerun a whole page's work.
 */
export class SharedRunCache<T> {
  private cached: { at: number; value: T } | null = null;
  private inFlight: Promise<T> | null = null;

  constructor(
    private readonly load: () => Promise<T>,
    private readonly ttlMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  get(): Promise<T> {
    const now = this.clock();
    if (this.cached && now - this.cached.at < this.ttlMs)
      return Promise.resolve(this.cached.value);
    if (!this.inFlight)
      this.inFlight = this.load()
        .then((value) => {
          this.cached = { at: this.clock(), value };
          return value;
        })
        .finally(() => {
          this.inFlight = null;
        });
    return this.inFlight;
  }
}
