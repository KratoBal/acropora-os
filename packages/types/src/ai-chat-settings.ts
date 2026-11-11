/**
 * THE AI CHAT SETTINGS (Acropora AI card f5b8f7ba, slice 4a; plan `exchange-out/ai-eloszures-4-szelet-terv-2026-11-11.md`,
 * doc-APPROVE barracuda on the v5 package; Balázs 2026-11-11 08:51: the contact recipient, the storage and the retention time are
 * settable in the Settings).
 *
 * THE LIMITS ARE HERE, IN ONE PLACE, because the server enforces them and the Settings form shows them. A retention time with no
 * upper bound is "keep for ever", which is the state this work removes, and one with no lower bound lets a typo of 0 delete the
 * ratings' evidence at once (plan section 3: 7 days at the bottom, 365 for messages and 180 for contact requests at the top).
 * The DEFAULTS are the plan's PROPOSAL (180 / 30 / 90 days), awaiting Balázs; a row that does not exist yet reads as these. The
 * offer and the contact request are OFF: the colleague offer stays out until the contact request exists (acrobot 2026-11-11 10:38),
 * so a setting nobody saved must never read as "on".
 */
export const AI_CHAT_SETTINGS_LIMITS = {
  /** Chat messages: how many days they are kept. */
  messageRetentionDays: { min: 7, max: 365 },
  /** A contact request: how many days it is kept once handled, and (at most) if nobody handled it. */
  contactRetentionDays: { min: 7, max: 180 },
} as const;

export interface AiChatSettings {
  /** The one-sentence colleague offer after the fourth customer turn. */
  offerEnabled: boolean;
  /** Whether a customer's contact reply to the offer becomes a request to the team. Off until a recipient is set. */
  contactRequestEnabled: boolean;
  /** Who receives the requests (an e-mail address). Required for `contactRequestEnabled`. */
  contactRecipientEmail: string | null;
  messageRetentionDays: number;
  /** Days a HANDLED contact request is kept. */
  contactHandledRetentionDays: number;
  /** Days an UNHANDLED contact request is kept at most; never shorter than the handled one. */
  contactUnhandledRetentionDays: number;
}

export const AI_CHAT_SETTINGS_DEFAULTS: AiChatSettings = {
  offerEnabled: false,
  contactRequestEnabled: false,
  contactRecipientEmail: null,
  messageRetentionDays: 180,
  contactHandledRetentionDays: 30,
  contactUnhandledRetentionDays: 90,
};

/**
 * What the AI SERVICE reads (a service token, never the browser): only what it acts on. The recipient stays in the OS, the delivery
 * is the OS's job, so the address never travels to the AI service.
 */
export interface AiChatSettingsServiceView {
  offerEnabled: boolean;
  contactRequestEnabled: boolean;
  messageRetentionDays: number;
}

export type AiChatSettingsCheck =
  { ok: true; value: AiChatSettings } | { ok: false; error: string };

const wholeDays = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;

/** A deliberately plain address check: one `@`, no spaces, a dot in the domain, at most 254 characters. */
const looksLikeEmail = (value: string): boolean =>
  value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/**
 * The server's rule and the form's rule, one function. Every message is one Hungarian sentence the form can show as it is.
 * Nothing is clamped or rounded: a value outside the limits is REFUSED (a retention time moved silently to the nearest legal value
 * would delete or keep something the owner did not ask for).
 */
export function checkAiChatSettings(input: unknown): AiChatSettingsCheck {
  const body =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};
  const { messageRetentionDays: m, contactRetentionDays: c } =
    AI_CHAT_SETTINGS_LIMITS;

  if (typeof body.offerEnabled !== "boolean")
    return { ok: false, error: "Az ajánlat kapcsolója igen vagy nem lehet." };
  if (typeof body.contactRequestEnabled !== "boolean")
    return {
      ok: false,
      error: "A kapcsolat-kérés kapcsolója igen vagy nem lehet.",
    };
  if (!wholeDays(body.messageRetentionDays, m.min, m.max))
    return {
      ok: false,
      error: `Az üzenetek megőrzése ${m.min} és ${m.max} nap közötti egész szám lehet.`,
    };
  if (!wholeDays(body.contactHandledRetentionDays, c.min, c.max))
    return {
      ok: false,
      error: `A kezelt kérés megőrzése ${c.min} és ${c.max} nap közötti egész szám lehet.`,
    };
  if (!wholeDays(body.contactUnhandledRetentionDays, c.min, c.max))
    return {
      ok: false,
      error: `A kezeletlen kérés megőrzése ${c.min} és ${c.max} nap közötti egész szám lehet.`,
    };
  if (body.contactUnhandledRetentionDays < body.contactHandledRetentionDays)
    return {
      ok: false,
      error: "A kezeletlen kérés megőrzése nem lehet rövidebb a kezelténél.",
    };

  const rawRecipient = body.contactRecipientEmail;
  const recipient =
    typeof rawRecipient === "string" && rawRecipient.trim() !== ""
      ? rawRecipient.trim()
      : null;
  if (
    rawRecipient !== null &&
    rawRecipient !== undefined &&
    typeof rawRecipient !== "string"
  )
    return { ok: false, error: "A címzett egy e-mail cím lehet." };
  if (recipient !== null && !looksLikeEmail(recipient))
    return { ok: false, error: "A címzett nem érvényes e-mail cím." };
  if (body.contactRequestEnabled && recipient === null)
    return {
      ok: false,
      error: "A kapcsolat-kérés bekapcsolásához címzett kell.",
    };

  return {
    ok: true,
    value: {
      offerEnabled: body.offerEnabled,
      contactRequestEnabled: body.contactRequestEnabled,
      contactRecipientEmail: recipient,
      messageRetentionDays: body.messageRetentionDays,
      contactHandledRetentionDays: body.contactHandledRetentionDays,
      contactUnhandledRetentionDays: body.contactUnhandledRetentionDays,
    },
  };
}
