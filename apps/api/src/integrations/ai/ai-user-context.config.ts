/**
 * The one token record this endpoint accepts.
 *
 * The `ServiceToken` model has no scope or audience column, so the allowlist
 * lives in configuration rather than in the schema: a single record id, named
 * by `ACROPORA_AI_USER_CONTEXT_TOKEN_ID`. Every other service token in the
 * table stays exactly as powerful as it was before this endpoint existed.
 *
 * The reader takes the environment as a parameter rather than closing over
 * `process.env` at import time. The reason is not style: the "missing
 * configuration rejects everything" property has to be provable in a test,
 * and a value baked in at import time cannot be varied by one.
 */
export const AI_USER_CONTEXT_TOKEN_ID_ENV = "ACROPORA_AI_USER_CONTEXT_TOKEN_ID";

/**
 * Injection token for the environment the guard reads.
 *
 * Nest resolves constructor parameters by their emitted type, and
 * `NodeJS.ProcessEnv` erases to `Object`, which is not a provider. A default
 * parameter value does not save it: the container never reaches the default,
 * it fails to resolve first and the whole application refuses to boot. This
 * mirrors `StockDiagnosticsRepository`, which faces the same problem with the
 * Prisma client: an optional token, and the real value as a fallback in the
 * constructor body.
 */
export const AI_USER_CONTEXT_ENVIRONMENT = Symbol(
  "AI_USER_CONTEXT_ENVIRONMENT",
);

/**
 * Returns the configured token record id, or `null` when it is absent or
 * blank. `null` means "accept nothing", never "accept anything": an empty
 * allowlist that opens the gate is the failure mode this endpoint exists to
 * avoid.
 */
export function aiUserContextTokenId(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = environment[AI_USER_CONTEXT_TOKEN_ID_ENV]?.trim();
  return value ? value : null;
}
