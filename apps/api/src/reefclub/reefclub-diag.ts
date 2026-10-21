/**
 * THE CLIENT-ADDRESS DIAGNOSTIC OF `/rc/v1/health` (ReefClub; opening
 * precondition, card 3a8b5bde). `REEFCLUB_TRUSTED_PROXY_HOPS` is to be set from
 * a MEASUREMENT of the proxy chain, and the ReefClub API's log is not visible
 * from outside. With the switch on, the health answer shows what the process
 * computes for the caller: the address it would limit by, and the chain it read
 * it from, so the chain can be measured from outside with a plain request.
 *
 * THE SWITCH IS AN ABSOLUTE EXPIRY, NOT A YES/NO (barracuda, #1761):
 * `REEFCLUB_DIAG_CLIENT_ADDRESS_UNTIL=<ISO time with a zone>`.
 *
 *  - it is open only while `now < UNTIL`, and only if UNTIL is at most TWO
 *    HOURS after the process started. A forgotten value therefore expires by
 *    the clock, not by the restarts: a window counted from the start would
 *    open again at every deploy, and the deploys are automatic;
 *  - a missing, malformed (a zone is required), already past or too far value
 *    is CLOSED, and a malformed or too distant one is named at the start;
 *  - what it shows is the addresses and nothing else: the entries of
 *    `X-Forwarded-For` (each kept only if it looks like an address, at most
 *    ten), the socket address, the computed caller address and the hop count.
 *    No other header, no cookie, no body.
 *
 * It is not tied to a production `NODE_ENV`: the stack the chain is measured
 * on runs with production settings too. The address in the answer is
 * personal data, so every health answer is `Cache-Control: no-store`.
 */
export const DIAG_UNTIL_ENV = "REEFCLUB_DIAG_CLIENT_ADDRESS_UNTIL";
export const DIAG_MAX_AHEAD_MS = 2 * 60 * 60 * 1000;
export const PROCESS_STARTED_AT = Date.now();

export type DiagState = "OFF" | "OPEN" | "EXPIRED" | "INVALID" | "TOO_FAR";

/** An ISO time WITH a zone: a bare local time would be read in the server's zone. */
const ISO_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function diagState(
  environment: Record<string, string | undefined> = process.env,
  startedAt: number = PROCESS_STARTED_AT,
  now: number = Date.now(),
): { state: DiagState; until: Date | null } {
  const raw = environment[DIAG_UNTIL_ENV];
  if (raw === undefined || raw === "") return { state: "OFF", until: null };
  if (!ISO_WITH_ZONE.test(raw)) return { state: "INVALID", until: null };
  const until = new Date(raw);
  if (Number.isNaN(until.getTime())) return { state: "INVALID", until: null };
  if (until.getTime() - startedAt > DIAG_MAX_AHEAD_MS)
    return { state: "TOO_FAR", until };
  return { state: now < until.getTime() ? "OPEN" : "EXPIRED", until };
}

export function diagOpen(
  environment: Record<string, string | undefined> = process.env,
  startedAt: number = PROCESS_STARTED_AT,
  now: number = Date.now(),
): boolean {
  return diagState(environment, startedAt, now).state === "OPEN";
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
