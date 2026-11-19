/**
 * A WEBSHOP AJÁNDÉKKÁRTYÁI (kártya 495c0007; Balázs, 2026-11-18: „Ajándékkártya kell”). A webshop saját modulja tárolja
 * (commerce #813): a kód titok, a webshop csak a lenyomatát és az utolsó négy jelét tartja; a teljes kód EGYSZER,
 * a kiadás válaszában látszik. Ez az OS felülete hozzá: kiadás, lista, napló, kikapcsolás.
 *
 * Lejárat nincs az első változatban: hogy legyen-e, Balázs nyitott kérdése (a kártya b) pontja).
 */

export type WebshopGiftCardStatus = "active" | "disabled";

export type WebshopGiftCard = {
  id: string;
  codeLast4: string;
  /** Egész forint. */
  initialAmount: number;
  balance: number;
  status: WebshopGiftCardStatus;
  expiresAt: string | null;
  recipientEmail: string | null;
  note: string | null;
  createdAt: string;
};

export type WebshopGiftCardTransactionKind =
  "issue" | "redeem" | "refund" | "void" | "adjust";

/** A kártya naplójának egy sora: előjeles összeg, és az egyenleg utána. */
export type WebshopGiftCardTransaction = {
  id: string;
  kind: WebshopGiftCardTransactionKind;
  amount: number;
  balanceAfter: number;
  /** A kosár, amit a beváltás lezárt (beváltásnál, visszatérítésnél). */
  reference: string | null;
  createdAt: string;
};

export type WebshopGiftCardDetail = WebshopGiftCard & {
  transactions: WebshopGiftCardTransaction[];
};

/** A kiadás válasza: a kártya és a teljes kód, ami csak itt látszik. */
export type WebshopGiftCardIssued = {
  giftCard: WebshopGiftCard;
  code: string;
};

export type WebshopGiftCardIssueInput = {
  amount: number;
  recipientEmail: string | null;
  note: string | null;
};

export const WEBSHOP_GIFT_CARD_LIMITS = {
  amountMin: 1,
  amountMax: 1_000_000,
  noteMax: 500,
} as const;

export const WEBSHOP_GIFT_CARD_TRANSACTION_LABELS: Record<
  WebshopGiftCardTransactionKind,
  string
> = {
  issue: "Kiadás",
  redeem: "Beváltás",
  refund: "Visszatérítés",
  void: "Visszavont beváltás",
  adjust: "Kézi módosítás",
};

export type WebshopGiftCardIssueParse =
  | { ok: true; value: WebshopGiftCardIssueInput }
  | { ok: false; errors: Record<string, string> };

/** Ugyanaz a szabály az űrlapon és az API-ban: egész forint 1 és 1 000 000 között, a címzett e-mail és a megjegyzés nem kötelező. */
export function parseWebshopGiftCardIssueInput(
  raw: unknown,
): WebshopGiftCardIssueParse {
  const input = (raw ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const L = WEBSHOP_GIFT_CARD_LIMITS;
  const amount = typeof input.amount === "number" ? input.amount : Number.NaN;
  if (!Number.isInteger(amount) || amount < L.amountMin || amount > L.amountMax)
    errors.amount = "Egész forint 1 és 1 000 000 között.";
  const email =
    typeof input.recipientEmail === "string"
      ? input.recipientEmail.trim().toLowerCase()
      : "";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.recipientEmail = "Ez nem e-mail-cím.";
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > L.noteMax)
    errors.note = `Legfeljebb ${L.noteMax} karakter.`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: { amount, recipientEmail: email || null, note: note || null },
  };
}
