/**
 * THE PURE RULES OF AN INCOMING TICKET@ MAIL (card ec7b947b, S2a): who wrote it, whether that can be believed, whether it is a machine's mail, and
 * what the report text is. No database, no network: everything here is a function of the message, so the fixtures in the spec decide it.
 *
 * THE MAIL'S TEXT IS FOREIGN TEXT. These functions only cut and count it; nothing here follows an instruction in it.
 */

/** The headers the rules read, as the Gmail client collects them (names compared case-insensitively there). */
export interface TicketMailHeaders {
  autoSubmitted: string | null;
  precedence: string | null;
  listId: string | null;
  /** EVERY `Authentication-Results` header, in message order: the topmost is the one our own receiving server added. */
  authenticationResults: string[];
}

const ADDRESS =
  /^[^\s@<>,;"()[\]\\]+@[^\s@<>,;"()[\]\\]+\.[^\s@<>,;"()[\]\\]+$/;

/**
 * The ONE address of a `From` header, lower case, or null. A header with several addresses (or none) is no sender: a report is one person's,
 * and an address list is how a mailing list or a forged header looks.
 */
export function parseSingleAddress(
  from: string | null | undefined,
): string | null {
  if (!from) return null;
  const angled = [...from.matchAll(/<([^<>]*)>/g)].map((m) => m[1]!.trim());
  const candidates = angled.length
    ? angled
    : from.includes(",") || from.includes(";")
      ? []
      : [from.trim()];
  if (candidates.length !== 1) return null;
  const address = candidates[0]!.toLowerCase();
  return ADDRESS.test(address) ? address : null;
}

export type AuthenticationReason =
  | "DMARC_PASS"
  | "NO_HEADER"
  | "FOREIGN_AUTHSERV"
  | "DMARC_NOT_PASS"
  | "FROM_DOMAIN_MISMATCH"
  | "NO_FROM";

/**
 * WHETHER THE `From` CAN BE BELIEVED. A `From` header is written by the sender, so on its own it says nothing about who sent the mail; a forged
 * mail "from" a switched-on colleague would otherwise be filed as theirs.
 *
 * The rule is narrow on purpose:
 * - ONLY THE TOPMOST `Authentication-Results` header counts. A sender can put its own header at the bottom of the message; the one our receiving
 *   server added is above it. A passing header lower down never rescues a failing one on top.
 * - Its authserv-id must be Gmail's (`mx.google.com`): a header another system wrote is not our verdict.
 * - It must say `dmarc=pass`, and its `header.from` must be the domain of the `From` address that is about to be trusted.
 *
 * Anything else is "not verified", and the caller treats the mail as from an unknown sender (no name, no place, no AI).
 */
export function authenticationVerdict(
  results: readonly string[],
  fromAddress: string | null,
): { verified: boolean; reason: AuthenticationReason } {
  if (!fromAddress) return { verified: false, reason: "NO_FROM" };
  const top = results[0];
  if (!top) return { verified: false, reason: "NO_HEADER" };
  const authservId = top.split(";")[0]?.trim().toLowerCase() ?? "";
  if (authservId !== "mx.google.com")
    return { verified: false, reason: "FOREIGN_AUTHSERV" };
  const dmarc = /(?:^|[\s;])dmarc=([a-z]+)/i.exec(top)?.[1]?.toLowerCase();
  if (dmarc !== "pass") return { verified: false, reason: "DMARC_NOT_PASS" };
  const headerFrom = /header\.from=([^\s;)]+)/i.exec(top)?.[1]?.toLowerCase();
  const domain = fromAddress.slice(fromAddress.lastIndexOf("@") + 1);
  if (!headerFrom || headerFrom !== domain)
    return { verified: false, reason: "FROM_DOMAIN_MISMATCH" };
  return { verified: true, reason: "DMARC_PASS" };
}

export type SkipReason =
  | "NO_FROM"
  | "OWN_ADDRESS"
  | "NO_REPLY"
  | "AUTO_SUBMITTED"
  | "PRECEDENCE"
  | "LIST";

const NO_REPLY_LOCAL =
  /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer-daemon|postmaster)/i;
const AUTOMATIC_PRECEDENCE = /^(bulk|list|junk|auto_reply)$/i;

/**
 * WHY A MAIL IS A MACHINE'S AND NEVER A REPORT (the loop and spam guard of the plan): our own address (the mailbox mails itself), a no-reply or bounce
 * sender, `Auto-Submitted` other than `no`, `Precedence: bulk|list|junk|auto_reply`, or a `List-Id`. A skipped mail is still recorded as seen by the
 * caller, so it is not read again; it just never becomes a draft.
 */
export function skipReason(input: {
  fromAddress: string | null;
  ownAddress: string;
  headers: Pick<TicketMailHeaders, "autoSubmitted" | "precedence" | "listId">;
}): SkipReason | null {
  const { fromAddress, ownAddress, headers } = input;
  if (!fromAddress) return "NO_FROM";
  if (fromAddress === ownAddress.trim().toLowerCase()) return "OWN_ADDRESS";
  if (NO_REPLY_LOCAL.test(fromAddress.slice(0, fromAddress.indexOf("@"))))
    return "NO_REPLY";
  const auto = headers.autoSubmitted?.trim().toLowerCase();
  if (auto && auto !== "no") return "AUTO_SUBMITTED";
  if (
    headers.precedence &&
    AUTOMATIC_PRECEDENCE.test(headers.precedence.trim())
  )
    return "PRECEDENCE";
  if (headers.listId?.trim()) return "LIST";
  return null;
}

/** The subject as a ticket title: reply and forward prefixes off (repeated ones too), spaces collapsed, at most 300 characters. */
export function cleanSubject(
  subject: string | null | undefined,
): string | null {
  if (!subject) return null;
  let text = subject.replace(/[\r\n\u0000-\u001f\u007f]+/g, " ");
  for (;;) {
    const next = text.replace(
      /^\s*(?:re|fwd?|vs|válasz|továbbítás|tov|átv)\s*(?:\[\d+\])?\s*:\s*/i,
      "",
    );
    if (next === text) break;
    text = next;
  }
  text = text.replace(/\s+/g, " ").trim().slice(0, 300);
  return text || null;
}

const REPLY_MARKERS: RegExp[] = [
  /^On .{5,200} wrote:\s*$/i,
  /^.{3,200}\s(?:írta|ezt írta):\s*$/i,
  /^-{2,}\s*(?:Original Message|Eredeti üzenet|Forwarded message|Továbbított üzenet)\s*-{2,}\s*$/i,
  /^_{5,}\s*$/,
  /^--\s?$/,
  /^Sent from my /i,
  /^Get Outlook for /i,
  /^Elküldve (?:az|a) .{0,60}(?:iPhone|Android|eszközről)/i,
];
const HEADER_BLOCK_FOLLOWER = /^(?:Sent|Date|Küldve|Elküldve|Dátum):/i;

/**
 * THE REPORT TEXT OF A MAIL: the quoted reply, the signature and a phone's footer cut off, the quote lines (`>`) dropped, blank runs collapsed, at
 * most `maxChars`. It is NOT a redaction: names, addresses and numbers stay, because this text is the manager's reading copy. What reaches a
 * model is redacted separately and before the call (Balázs, 2026-11-16: the AI gets only filtered text).
 */
export function cleanMailBody(
  raw: string,
  maxChars = 4000,
): { text: string; truncated: boolean } {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (trimmed.startsWith(">")) continue;
    // a wrapped "On ... wrote:" (the clause breaks after the address)
    const joined = `${trimmed} ${lines[index + 1]?.trim() ?? ""}`;
    if (
      REPLY_MARKERS.some((marker) => marker.test(trimmed)) ||
      /^On .{5,200} wrote:\s*$/i.test(joined)
    )
      break;
    if (
      /^(?:From|Feladó):\s/i.test(trimmed) &&
      lines
        .slice(index + 1, index + 5)
        .some((next) => HEADER_BLOCK_FOLLOWER.test(next.trim()))
    )
      break;
    kept.push(line.replace(/\s+$/, ""));
  }
  const text = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > maxChars
    ? { text: text.slice(0, maxChars).trimEnd(), truncated: true }
    : { text, truncated: false };
}
