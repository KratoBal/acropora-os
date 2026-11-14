import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, vi } from "vitest";

import { SLOW_MOCK_MS } from "./slow-mock-ms.js";
import { beszurLathatosagShim } from "./visibility-shim.js";

/**
 * A REJTO OSZTALYOK STILUSA, MINDEN TESZT ELE.
 *
 * A `happy-dom` nem tolt be stiluslapot, tehat egy `hidden` osztallyal rejtett
 * elem szamitott stilus nelkul LATHATONAK szamit -- merve 2026-09-22.
 * A shim indoka es a hatara a `visibility-shim.ts` fejlecen all.
 */
// Server route tests use real Node Request/Response (including Cookie headers).
// The visibility shim applies only to browser component tests.
beforeAll(() => {
  if (typeof document !== "undefined") beszurLathatosagShim();
});

/**
 * THE THEME STORE LIVES IN THE MODULE (card 302951c0): every view shares one state, read from the cache once. Without
 * this reset a test that puts "dark" into the cache would still see the state an earlier test in the same file read.
 * Browser tests only: the server route tests never load the store.
 */
afterEach(async () => {
  cleanup();
  if (typeof document !== "undefined")
    (await import("@acropora/ui")).resetThemeStateForTests();
});

/**
 * EVERY MOCKED ANSWER ARRIVES LATE (card e91dc528). A `vi.fn()` / `vi.spyOn()` given `mockResolvedValue`,
 * `mockRejectedValue` or their `Once` forms settles its value after a short real-time delay, not at once.
 *
 * WHY: with an instant answer a test may wait for the CALL (`toHaveBeenCalled`) or for a FIELD (`findByLabelText`) and
 * then act as if the ANSWER had arrived too: click a button the component disables while the call runs, pick an option
 * the list has not brought yet, assert a navigation that follows the answer. Locally that passes; on a busy runner it
 * flakes (#970, 2026-09-22, a sticker-code change held up by an unrelated test). With the answer late, the same test
 * fails EVERY time, on every machine. Wait for the answer instead: `answered(mock)` (src/test/answered.ts), the option
 * (`listedSelect`, src/test/listed-option.ts), or the effect itself inside `waitFor`.
 *
 * THE LIMITS, said so nobody reads more into a green run: `mockReturnValue(Promise.resolve(x))` and a hand-written
 * `mockImplementation(async () => x)` are NOT slowed; under fake timers nothing is (a test that drives time by hand
 * cannot wait for real time, and its failure would be this file's, not the test's). The guard over this file:
 * src/test/slow-mock.component.test.tsx. The delay: SLOW_MOCK_MS (src/test/slow-mock-ms.ts).
 */
if (SLOW_MOCK_MS > 0) {
  // NOT 0 ms: Testing Library's async wrapper waits one macrotask after every waitFor/findBy, and that absorbs a
  // 0 ms delay (measured on the guard's control, 2026-11-14). 10 ms stays behind it on an idle machine, NOT on a loaded
  // one (#2552: the answer came first two runs of three), so a test that skips the wait may still go green here and
  // red on the CI. The guard's own checks use microtask turns only, outside act (act always ends with a macrotask).
  const ms = SLOW_MOCK_MS;
  // the REAL timer, taken before any test can fake it
  const realSetTimeout = globalThis.setTimeout;
  // every answer still on its way, so a test does not end with one in flight
  const pending = new Set<Promise<void>>();
  const later = () => {
    if (vi.isFakeTimers()) return Promise.resolve();
    const answer = new Promise<void>((done) => realSetTimeout(done, ms));
    pending.add(answer);
    void answer.then(() => pending.delete(answer));
    return answer;
  };
  /**
   * A LATE ANSWER MUST NOT OUTLIVE ITS TEST. Without this, an answer a test never waited for lands in the NEXT test (its
   * call counters, its screen), or after the file's environment is gone, where React's setState throws "window is not
   * defined" as an unhandled rejection and the whole run exits 1 with every test green (measured 2026-11-14:
   * pos-terminal-page, pilot-worksheet-list-page). The screen is unmounted first, then the answers drain; an answer may
   * start another call, hence the loop.
   */
  afterEach(async () => {
    cleanup();
    for (let round = 0; round < 20 && pending.size > 0; round++) {
      await Promise.allSettled([...pending]);
      await new Promise((done) => realSetTimeout(done, 0));
    }
  });
  const slow = <M extends ReturnType<typeof vi.fn>>(mock: M): M => {
    mock.mockResolvedValue = ((value: unknown) =>
      mock.mockImplementation(() => later().then(() => value))) as never;
    mock.mockResolvedValueOnce = ((value: unknown) =>
      mock.mockImplementationOnce(() => later().then(() => value))) as never;
    mock.mockRejectedValue = ((error: unknown) =>
      mock.mockImplementation(() =>
        later().then(() => Promise.reject(error)),
      )) as never;
    mock.mockRejectedValueOnce = ((error: unknown) =>
      mock.mockImplementationOnce(() =>
        later().then(() => Promise.reject(error)),
      )) as never;
    return mock;
  };
  const fn = vi.fn.bind(vi);
  const spyOn = vi.spyOn.bind(vi);
  (vi as { fn: unknown }).fn = (...args: Parameters<typeof vi.fn>) =>
    slow(fn(...args) as never);
  (vi as { spyOn: unknown }).spyOn = (...args: Parameters<typeof vi.spyOn>) =>
    slow((spyOn as never as (...a: unknown[]) => never)(...args));
}
