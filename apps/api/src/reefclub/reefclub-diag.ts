/**
 * THE CLIENT-ADDRESS DIAGNOSTIC OF `/rc/v1/health` (ReefClub; opening
 * precondition, card 3a8b5bde). `REEFCLUB_TRUSTED_PROXY_HOPS` is to be set from
 * a MEASUREMENT of the proxy chain, and the ReefClub API's log is not visible
 * from outside. With this switch on, the health answer shows what the process
 * computes for the caller: the address it would limit by, and the chain it read
 * it from, so the chain can be measured from outside with a plain request.
 *
 * OFF BY DEFAULT, AND SELF-CLOSING (acrobot's request plus one safeguard):
 *
 *  - it is on only if the variable is EXACTLY `true` (not `1`, not `yes`, not
 *    `TRUE`: a stray value is off);
 *  - and then only for ONE HOUR after the process started. A forgotten switch
 *    closes by itself, which a restart-free flag cannot do, and the variable
 *    cannot be made "not enable-able under production NODE_ENV" without
 *    defeating its purpose (the stack the chain is measured on runs with
 *    production settings too). Measuring again means a restart, which a
 *    changed variable is anyway;
 *  - what it shows is the addresses and nothing else: the entries of
 *    `X-Forwarded-For` (each kept only if it looks like an address, at most
 *    ten), the socket address, the computed caller address and the hop count.
 *    No other header, no cookie, no body. The answer is the caller's own chain
 *    shown to the caller.
 *
 * The process says it at the start when the switch is on (`main-reefclub.ts`).
 */
export const DIAG_ENV = "REEFCLUB_DIAG_CLIENT_ADDRESS";
export const DIAG_WINDOW_MS = 60 * 60 * 1000;
export const PROCESS_STARTED_AT = Date.now();

export function diagOpen(
  environment: Record<string, string | undefined> = process.env,
  startedAt: number = PROCESS_STARTED_AT,
  now: number = Date.now(),
): boolean {
  return (
    environment[DIAG_ENV] === "true" &&
    now >= startedAt &&
    now - startedAt <= DIAG_WINDOW_MS
  );
}

const NOT_AN_ADDRESS = "(nem cím)";
const ADDRESS_SHAPE = /^[0-9A-Fa-f:.]{2,45}$/;
const MAX_ENTRIES = 10;

export interface ClientAddressDiag {
  /** What the rate limits key on. */
  callerAddress: string;
  /** The hop count the computation used. */
  trustedProxyHops: number;
  /** The `X-Forwarded-For` entries, in order, left (client-written) to right (nearest proxy). */
  forwardedFor: string[];
  /** The address of the connection the process itself saw. */
  socketAddress: string;
}

export function clientAddressDiag(
  request: {
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
  },
  computed: { callerAddress: string; trustedProxyHops: number },
): ClientAddressDiag {
  const raw = request.headers["x-forwarded-for"];
  const entries = (Array.isArray(raw) ? raw.join(",") : (raw ?? ""))
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, MAX_ENTRIES)
    .map((entry) => (ADDRESS_SHAPE.test(entry) ? entry : NOT_AN_ADDRESS));
  const socket = request.ip ?? "";
  return {
    callerAddress: computed.callerAddress,
    trustedProxyHops: computed.trustedProxyHops,
    forwardedFor: entries,
    socketAddress: ADDRESS_SHAPE.test(socket) ? socket : NOT_AN_ADDRESS,
  };
}
