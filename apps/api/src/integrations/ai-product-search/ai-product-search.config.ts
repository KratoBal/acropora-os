/**
 * The one token record this endpoint accepts - and deliberately NOT the one
 * the user-context endpoint accepts.
 *
 * `AiUserContextGuard` states the rule in its own file: it is used on exactly
 * one controller, and adding it to a second one "would silently widen what
 * every existing token can do, so do not - mint a separate mechanism
 * instead". This is that separate mechanism.
 *
 * The reason is not symmetry. The two endpoints open two different doors: one
 * to a customer's own data, one to the catalogue. If a single token opened
 * both, a leaked token would carry two systems instead of one, and nothing in
 * either response would show which door it came through.
 *
 * The reader takes the environment as a parameter rather than closing over
 * `process.env` at import time, for the same reason as its sibling: the
 * "missing configuration rejects everything" property has to be provable in a
 * test, and a value baked in at import time cannot be varied by one.
 */
export const AI_PRODUCT_SEARCH_TOKEN_ID_ENV =
  "ACROPORA_AI_PRODUCT_SEARCH_TOKEN_ID";

/**
 * Injection token for the environment the guard reads.
 *
 * Nest resolves constructor parameters by their emitted type, and
 * `NodeJS.ProcessEnv` erases to `Object`, which is not a provider. A default
 * parameter value does not save it: the container fails to resolve before it
 * ever reaches the default, and the whole API refuses to boot. That exact
 * shape stopped `AiUserContextGuard` booting when it was first written, and
 * `app.bootstrap.spec.ts` caught it twice in one day.
 */
export const AI_PRODUCT_SEARCH_ENVIRONMENT = Symbol(
  "AI_PRODUCT_SEARCH_ENVIRONMENT",
);

/**
 * How many products one search may return.
 *
 * A ceiling rather than a preference: the result travels into a model
 * context, and an unbounded list would push out the conversation itself. The
 * caller may ask for fewer, never for more.
 */
export const AI_PRODUCT_SEARCH_MAX_HITS = 10;

/**
 * The shape version of the projection this endpoint returns.
 *
 * Balazs's decision asks for a VERSIONED search projection, and the version
 * has to travel with the data rather than live in a document: a stored
 * judgement about an answer is only interpretable if we know what the answer
 * was built from. When the projection changes shape, this changes with it.
 */
export const AI_PRODUCT_SEARCH_PROJECTION_VERSION = "2026-08-27.1";

/**
 * Returns the configured token record id, or `null` when it is absent or
 * blank. `null` means "accept nothing", never "accept anything": an empty
 * allowlist that opens the gate is the failure mode this endpoint exists to
 * avoid.
 */
export function aiProductSearchTokenId(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = environment[AI_PRODUCT_SEARCH_TOKEN_ID_ENV]?.trim();
  return value ? value : null;
}
