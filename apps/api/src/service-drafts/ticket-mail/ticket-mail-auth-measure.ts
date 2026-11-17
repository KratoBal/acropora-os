import { createHash } from "node:crypto";

import {
  authenticationVerdict,
  parseAuthenticationResults,
  skipReason,
  type AuthenticationReason,
  type SkipReason,
  type TicketMailHeaders,
} from "./ticket-mail-message.js";

/**
 * THE PURE PART OF THE `AUTHENTICATION-RESULTS` MEASUREMENT (task t-20261117-authres-mero, card ec7b947b). The intake believes a sender only from
 * Gmail's `Authentication-Results` header (`authenticationVerdict`), and the form of that header for the ticket@ mailbox was never measured: the
 * rule was built from the RFC and from Gmail's documented form, and the real test mail at the end of S2 is the measurement. This turns one message's
 * headers into what a person needs to see: how many headers there are, whose authserv-id each carries, which methods said what, what the rule
 * makes of it, and whether the mail would be skipped as a machine's.
 *
 * NOTHING PERSONAL LEAVES THIS FUNCTION: a message is identified by a short hash of its id, the sender only by the DOMAIN of its address, the
 * header text only with every e-mail address and IP address masked (Gmail writes the envelope sender and the connecting IP into the header's
 * comments). No subject, no text, no attachment name, no token is ever passed in.
 */
export interface HeaderShape {
  /** The authserv-id (`mx.google.com`), or null when the header is malformed (it is then never believed). */
  authservId: string | null;
  /** Each result entry: the method, its result, and the domain it names for `header.from` / `header.d` (domains only). */
  entries: Array<{
    method: string;
    result: string;
    headerFrom: string | null;
    headerD: string | null;
  }>;
  /** The header text, addresses and IPs masked, cut at 700 characters. */
  masked: string;
}

export interface MessageMeasure {
  /** A short hash of the Gmail message id: enough to tell two mails apart, no way back. */
  idHash: string;
  fromDomain: string | null;
  headerCount: number;
  headers: HeaderShape[];
  verdict: { verified: boolean; reason: AuthenticationReason };
  skip: SkipReason | null;
}

// the local part is either a quoted string (it may hold spaces: `"anna kovacs"@acropora.hu`) or a run of plain characters
const EMAIL = /(?:"[^"]*"|[^\s@<>()[\]",;:]+)@([^\s<>()[\]",;:]+)/g;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
// an IPv6 address (hex groups with colons, at least two colons), and the compressed forms
const IPV6 = /\b(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\b/gi;

/** The header text with every e-mail address (local part masked, domain kept) and every IP address masked, and at most 700 characters. */
export function maskHeader(header: string): string {
  return header
    .replace(/\s+/g, " ")
    .replace(EMAIL, "***@$1")
    .replace(IPV4, "[ip]")
    .replace(IPV6, "[ip]")
    .slice(0, 700);
}

const domainOf = (value: string | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.replace(/^@/, "").replace(/"/g, "").toLowerCase();
  // a value that holds an `@` is an address: only the domain part is kept
  const at = trimmed.lastIndexOf("@");
  const domain = at >= 0 ? trimmed.slice(at + 1) : trimmed;
  return /^[a-z0-9.-]+$/.test(domain) ? domain : null;
};

export function headerShape(header: string): HeaderShape {
  const parsed = parseAuthenticationResults(header);
  return {
    // the authserv-id is the first word of a header ANY sender's relay may have written: masked and cut like the header text
    authservId: parsed ? maskHeader(parsed.authservId).slice(0, 100) : null,
    entries: (parsed?.results ?? []).map((entry) => ({
      method: entry.method,
      result: entry.result,
      headerFrom: domainOf(entry.props.get("header.from")),
      headerD: domainOf(entry.props.get("header.d")),
    })),
    masked: maskHeader(header),
  };
}

export function measureMessage(input: {
  id: string;
  fromAddress: string | null;
  ownAddress: string;
  headers: TicketMailHeaders;
}): MessageMeasure {
  const { headers } = input;
  return {
    idHash: createHash("sha256").update(input.id).digest("hex").slice(0, 8),
    fromDomain: input.fromAddress
      ? input.fromAddress.slice(input.fromAddress.lastIndexOf("@") + 1)
      : null,
    headerCount: headers.authenticationResults.length,
    headers: headers.authenticationResults.map(headerShape),
    verdict: authenticationVerdict(
      headers.authenticationResults,
      input.fromAddress,
    ),
    skip: skipReason({
      fromAddress: input.fromAddress,
      ownAddress: input.ownAddress,
      headers,
    }),
  };
}

export interface RunSummary {
  messages: number;
  verified: number;
  byReason: Record<string, number>;
  /** How many messages had how many `Authentication-Results` headers: the form of the mailbox in one line. */
  byHeaderCount: Record<string, number>;
  /** The distinct authserv-ids seen, with how many headers carried each (`mx.google.com` is the one the rule believes). */
  authservIds: Record<string, number>;
}

export function summarizeRun(items: readonly MessageMeasure[]): RunSummary {
  const summary: RunSummary = {
    messages: items.length,
    verified: 0,
    byReason: {},
    byHeaderCount: {},
    authservIds: {},
  };
  for (const item of items) {
    if (item.verdict.verified) summary.verified++;
    summary.byReason[item.verdict.reason] =
      (summary.byReason[item.verdict.reason] ?? 0) + 1;
    const count = String(item.headerCount);
    summary.byHeaderCount[count] = (summary.byHeaderCount[count] ?? 0) + 1;
    for (const header of item.headers) {
      const id = header.authservId ?? "(malformed)";
      summary.authservIds[id] = (summary.authservIds[id] ?? 0) + 1;
    }
  }
  return summary;
}
