import type { Server } from "node:http";

/**
 * How long the API keeps an idle connection open, and why the default is wrong
 * for us.
 *
 * Node closes an idle keep-alive connection after five seconds. A proxy in
 * front holds its own pooled connections for far longer - Traefik's default
 * idle timeout is measured in minutes - so the two disagree about when a
 * socket is dead. The failure that produces is the worst kind to debug: the
 * proxy picks a pooled socket, the server closes it in the same instant, and
 * the request dies with a connection reset. It is rare, it never reproduces on
 * demand, and it looks like a fault in whatever endpoint happened to be called.
 *
 * The fix is an ordering, not a number: **the server has to outlast the
 * proxy.** Whoever closes the connection first must be the side that is not
 * about to send a request on it.
 *
 * Sixty-five seconds is the usual choice for exactly this reason - it clears
 * the sixty second idle timeout most proxies and load balancers default to. It
 * stays configurable because the number in front of us is not ours: if the
 * Traefik configuration is ever measured and turns out to be longer, this has
 * to move with it.
 */
export const KEEP_ALIVE_TIMEOUT_ENV = "API_KEEP_ALIVE_TIMEOUT_MS";

export const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 65_000;

/**
 * `headersTimeout` must stay ABOVE `keepAliveTimeout`, and this margin is why.
 *
 * Node measures headersTimeout from the moment the connection is idle, not
 * from the first byte of the request. If it were the shorter of the two, it
 * would fire on a connection that is merely waiting, and the reset would come
 * back at the caller as the same unexplained failure this file exists to
 * remove.
 */
export const HEADERS_TIMEOUT_MARGIN_MS = 5_000;

const MINIMUM_MS = 1_000;
const MAXIMUM_MS = 600_000;

/**
 * Reads the configured value, or falls back to the default.
 *
 * It falls back rather than throwing: a typo in an environment variable must
 * not stop the API from booting, because a deploy that fails for a reason
 * nobody connects to the number they mistyped is worse than a documented
 * default.
 */
export const keepAliveTimeoutMs = (
  environment: NodeJS.ProcessEnv = process.env,
): number => {
  const raw = environment[KEEP_ALIVE_TIMEOUT_ENV]?.trim();
  const value = Number(raw);

  if (
    !raw ||
    !Number.isInteger(value) ||
    value < MINIMUM_MS ||
    value > MAXIMUM_MS
  ) {
    return DEFAULT_KEEP_ALIVE_TIMEOUT_MS;
  }

  return value;
};

export const headersTimeoutMs = (
  environment: NodeJS.ProcessEnv = process.env,
): number => keepAliveTimeoutMs(environment) + HEADERS_TIMEOUT_MARGIN_MS;

/**
 * Applies both limits to the running server.
 *
 * Written as a function over the server rather than inline in `main.ts` so
 * that a test can hand it a real `http.Server` and read the values back. A
 * limit that is computed and never applied is the shape of defect that leaves
 * every unit test green while the running process keeps the default.
 */
export const applyHttpTimeouts = (
  server: Server,
  environment: NodeJS.ProcessEnv = process.env,
): void => {
  server.keepAliveTimeout = keepAliveTimeoutMs(environment);
  server.headersTimeout = headersTimeoutMs(environment);
};
