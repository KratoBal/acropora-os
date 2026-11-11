/**
 * THE CONTACT REQUEST OF THE AI CHAT (Acropora AI card f5b8f7ba, slice 4c; plan `exchange-out/ai-eloszures-4-szelet-terv-2026-11-11.md`
 * section 2 point 2 and 3). A customer answered the colleague offer with an e-mail address or a Hungarian telephone number; the AI
 * service hands it over here, and the OS is the ONE place where it lives (record, notification, retention).
 *
 * THE VALUE SHAPES ARE THE AI SERVICE'S MASK PATTERNS, ANCHORED (`contact-mask.ts` there): an e-mail address is the usual
 * `local@domain.tld`, a telephone number is only a Hungarian one with its prefix (`+36`, `0036` or `06`) and eight or nine digits,
 * with the usual separators. They are narrow ON PURPOSE: an order, part or invoice number is no contact, so it is never a request.
 * The OS repeats the check because a hand-over over the network is an input like any other.
 */
export const AI_CONTACT_CHANNELS = ["EMAIL", "PHONE"] as const;
export type AiContactChannel = (typeof AI_CONTACT_CHANNELS)[number];

const EMAIL =
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const SEP = String.raw`[\s.\-/()]*`;
const PHONE = new RegExp(
  String.raw`^(?:\+36|0036|06)${SEP}(?:\d${SEP}){7,8}\d$`,
);
/** An id of the AI service (a conversation or a message): plain characters, no spaces. */
const REFERENCE = /^[A-Za-z0-9._:-]{1,100}$/;

export const AI_CONTACT_VALUE_MAX_LENGTH = 254;

/** What the AI service posts. `requestKey` is the id of the customer's message: one message makes one request, however often it retries. */
export interface AiContactRequestInput {
  channel: AiContactChannel;
  value: string;
  conversationRef: string;
  requestKey: string;
}

export type AiContactRequestCheck =
  { ok: true; value: AiContactRequestInput } | { ok: false; error: string };

export function checkAiContactRequestInput(
  input: unknown,
): AiContactRequestCheck {
  const body =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};
  const channel = body.channel;
  if (channel !== "EMAIL" && channel !== "PHONE")
    return { ok: false, error: "A csatorna EMAIL vagy PHONE lehet." };
  const value = typeof body.value === "string" ? body.value.trim() : "";
  if (value === "" || value.length > AI_CONTACT_VALUE_MAX_LENGTH)
    return { ok: false, error: "Az elérhetőség hiányzik vagy túl hosszú." };
  if (!(channel === "EMAIL" ? EMAIL : PHONE).test(value))
    return {
      ok: false,
      error:
        channel === "EMAIL"
          ? "Az elérhetőség nem érvényes e-mail cím."
          : "Az elérhetőség nem magyar telefonszám (+36, 0036 vagy 06 előtaggal).",
    };
  const { conversationRef, requestKey } = body;
  if (typeof conversationRef !== "string" || !REFERENCE.test(conversationRef))
    return { ok: false, error: "A beszélgetés azonosítója hibás." };
  if (typeof requestKey !== "string" || !REFERENCE.test(requestKey))
    return { ok: false, error: "A kérés azonosítója hibás." };
  return { ok: true, value: { channel, value, conversationRef, requestKey } };
}

/** The answer to the AI service: it may say "forwarded" to the customer only when `recorded` is true. */
export interface AiContactRequestReceipt {
  id: string;
  /** The request is stored in the OS (also true for a repeat of an earlier hand-over). */
  recorded: true;
  /** A repeat of an earlier hand-over (same `requestKey`): nothing new was stored and nobody was notified again. */
  duplicate: boolean;
  /** The e-mail to the recipient went out. False does not undo the request: it is in the list. */
  notified: boolean;
}

/** One row of the Settings list. */
export interface AiContactRequestView {
  id: string;
  channel: AiContactChannel;
  value: string;
  conversationRef: string;
  createdAt: string;
  notifiedAt: string | null;
  handledAt: string | null;
}
