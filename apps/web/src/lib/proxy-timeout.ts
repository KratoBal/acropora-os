/**
 * How long the Next.js rewrite proxy waits for the API before giving up.
 *
 * This is the only limit in the request chain that nobody chose. Next's
 * default is 30 000 ms, and it sits in front of every `/api/*` call the
 * browser makes, so it decides the ceiling for anything slow - an AI chat
 * answer above all. Worse than its length is its shape: when it fires, the
 * browser receives a bare `500 Internal Server Error` with nothing in it that
 * says a timeout happened or which hop gave up (measured, 2026-08-26: 25 s
 * passes, 31 s comes back as a 500 at 30.03 s).
 *
 * The agreed ladder is inner-strictest, loosening outwards: the model call
 * gives up at 40 s with a named error, the AI service's socket net is at 45 s,
 * and this proxy sits above both at 50 s. That ordering is the whole point -
 * whoever gives up first must be the one that can explain why.
 *
 * **This value is read when the image is BUILT, not when it runs.** Next
 * evaluates `next.config.ts` during the build and bakes the result into the
 * standalone bundle, exactly as it does for `API_URL`. Setting the variable on
 * a running container changes nothing, silently - so it belongs in the build
 * arguments, next to `API_URL`.
 */
export const PROXY_TIMEOUT_ENV = "NEXT_PROXY_TIMEOUT_MS";

/** Fifty seconds: above the 45 s socket net, which is above the 40 s model call. */
const DEFAULT_PROXY_TIMEOUT_MS = 50_000;

const MINIMUM_MS = 1_000;
const MAXIMUM_MS = 600_000;

/**
 * Returns the configured value, or the default when it is missing or unusable.
 *
 * It falls back rather than throwing on purpose. `next.config.ts` runs during
 * the image build, and a typo in a build argument that stops the build is a
 * worse outcome than a documented default: the deploy fails for a reason that
 * looks unrelated to the number somebody mistyped.
 */
export function proxyTimeoutMs(
  // A plain string map rather than NodeJS.ProcessEnv: Next augments that type
  // with a required NODE_ENV, and a test that has to invent one just to ask
  // about a timeout is a test about the wrong thing.
  environment: Record<string, string | undefined> = process.env,
): number {
  const raw = environment[PROXY_TIMEOUT_ENV]?.trim();
  if (!raw) return DEFAULT_PROXY_TIMEOUT_MS;

  const value = Number(raw);
  if (!Number.isInteger(value)) return DEFAULT_PROXY_TIMEOUT_MS;
  if (value < MINIMUM_MS || value > MAXIMUM_MS) return DEFAULT_PROXY_TIMEOUT_MS;

  return value;
}
