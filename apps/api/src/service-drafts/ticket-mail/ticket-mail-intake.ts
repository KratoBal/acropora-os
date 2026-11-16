import { createHash } from "node:crypto";

import type { ServiceDraftIntakeState } from "@acropora/types";

import { budapestDayKey } from "../../dashboard/budapest-day.js";
import {
  cleanMailBody,
  cleanSubject,
  type SkipReason,
} from "./ticket-mail-message.js";

/**
 * WHAT BECOMES OF AN INCOMING TICKET@ MAIL (card ec7b947b, S2b): pure decisions, no database and no network.
 *
 * The three branches of Balázs's decision (2026-09-18) all land in the SAME list, and differ only by `intakeState`:
 *   a switched-on colleague   -> `AI_UNAVAILABLE` (S2b has no AI yet; S3 makes it `AI_DRAFT` when the model answered),
 *   a switched-off colleague  -> `WATCH_OFF`,
 *   anyone else, or a sender whose `From` could not be believed -> `UNKNOWN_SENDER`.
 *
 * THE USER, THE PLACE AND THE NAME ARE LOOKED UP, NEVER GUESSED: they come from the verified sender address through the user record. A sender
 * who is not verified is an unknown sender, however well the header names a colleague. Only an INTERNAL active user can be a known sender
 * (a partner or supplier account is not: their reports come through the partner portal).
 */
export interface ResolvedSender {
  userId: string;
  displayName: string;
  /** The "E-mail AI figyelése" capability is ticked for this user. */
  watching: boolean;
  /** The user's ACTIVE assigned departments (places). */
  departmentIds: readonly string[];
}

export type IntakeOutcome =
  | { kind: "SKIP"; reason: SkipReason }
  | { kind: "CAPPED" }
  | {
      kind: "DRAFT";
      intakeState: "AI_UNAVAILABLE" | "WATCH_OFF" | "UNKNOWN_SENDER";
      senderUserId: string | null;
      reporterPersonName: string | null;
      proposedDepartmentId: string | null;
    };

export function decideIntake(input: {
  skip: SkipReason | null;
  /** `authenticationVerdict(...).verified` */
  verified: boolean;
  /** Resolved only for a verified address; null otherwise. */
  sender: ResolvedSender | null;
  /** How many mails the same unknown address already left in the last hour (this run's included). */
  recentFromSender: number;
  unknownSenderPerHour: number;
  /** How many unknown senders' mails, all addresses together, were listed or capped in the last hour (this run's included). */
  recentUnknownTotal: number;
  unknownTotalPerHour: number;
}): IntakeOutcome {
  if (input.skip) return { kind: "SKIP", reason: input.skip };
  if (input.verified && input.sender) {
    const { sender } = input;
    if (sender.watching)
      return {
        kind: "DRAFT",
        intakeState: "AI_UNAVAILABLE",
        senderUserId: sender.userId,
        reporterPersonName: sender.displayName,
        // exactly one assigned place is a lookup; several is a choice the manager makes ("nem tudom"), none is nothing to show
        proposedDepartmentId:
          sender.departmentIds.length === 1 ? sender.departmentIds[0]! : null,
      };
    return {
      kind: "DRAFT",
      intakeState: "WATCH_OFF",
      senderUserId: sender.userId,
      reporterPersonName: sender.displayName,
      proposedDepartmentId: null,
    };
  }
  // an unknown sender over the hourly guard is counted and recorded, not listed (the spam and loop guard of the plan)
  if (
    input.recentFromSender >= input.unknownSenderPerHour ||
    input.recentUnknownTotal >= input.unknownTotalPerHour
  )
    return { kind: "CAPPED" };
  return {
    kind: "DRAFT",
    intakeState: "UNKNOWN_SENDER",
    senderUserId: null,
    reporterPersonName: null,
    proposedDepartmentId: null,
  };
}

/**
 * WHICH DRAFTS ANNOUNCE THEMSELVES WITH A PUSH (Balázs, 2026-09-18): only the ones of a SWITCHED-ON colleague, with or without the AI's answer. A
 * switched-off or unknown sender's mail "csak egy felületen jelzi" (the list), and a mail that is no draft sends nothing.
 */
export function announcesArrival(state: ServiceDraftIntakeState): boolean {
  return state === "AI_DRAFT" || state === "AI_UNAVAILABLE";
}

/**
 * A TEXT WITHOUT NUL: PostgreSQL's text type refuses a 0x00 character, and a sender can put one into a mail (a base64 text part, a subject, a
 * file name), which would fail the whole transaction in every run (barracuda, #2646). Everything the intake stores as text goes through here.
 */
export function withoutNul(text: string): string;
export function withoutNul(text: string | null): string | null;
export function withoutNul(text: string | null): string | null {
  return text === null ? null : text.replace(/\u0000/g, "");
}

export const NO_SUBJECT_TITLE = "Ticket levél (tárgy nélkül)";
export const EMPTY_BODY_TEXT = "(A levélnek nincs szöveges tartalma.)";

/**
 * THE DRAFT'S OWN FIELDS FROM THE MAIL: the title (the subject without reply prefixes; else the first line of the text; else a fixed words), the
 * report text (the quoted reply and the signature cut, the reading copy, not a redaction), the report day (the Budapest day of the receipt),
 * and the fingerprint (the message id's digest: one draft per message, the unique key `source, mailbox, reportDate, fingerprint`).
 */
export function draftContentOf(message: {
  id: string;
  subject: string | null;
  text: string;
  receivedAt: Date | null;
}): {
  title: string;
  originalProblem: string;
  reportDate: Date;
  fingerprint: string;
} {
  const body = cleanMailBody(withoutNul(message.text));
  const firstLine = body.text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  const title =
    cleanSubject(withoutNul(message.subject)) ??
    (firstLine ? firstLine.slice(0, 120) : NO_SUBJECT_TITLE);
  const day = budapestDayKey(message.receivedAt ?? new Date());
  return {
    title,
    originalProblem: body.text || EMPTY_BODY_TEXT,
    reportDate: new Date(`${day}T00:00:00.000Z`),
    fingerprint: createHash("sha256").update(message.id).digest("hex"),
  };
}
