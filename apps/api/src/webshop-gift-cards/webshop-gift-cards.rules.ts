import type {
  WebshopGiftCard,
  WebshopGiftCardTransaction,
  WebshopGiftCardTransactionKind,
} from "@acropora/types";

import type {
  MedusaGiftCardRow,
  MedusaGiftCardTransactionRow,
} from "./webshop-gift-cards.client.js";

const KINDS: readonly WebshopGiftCardTransactionKind[] = [
  "issue",
  "redeem",
  "refund",
  "void",
  "adjust",
];

export function toWebshopGiftCard(row: MedusaGiftCardRow): WebshopGiftCard {
  return {
    id: row.id,
    codeLast4: row.code_last4,
    initialAmount: Number(row.initial_amount),
    balance: Number(row.balance),
    status: row.status === "disabled" ? "disabled" : "active",
    expiresAt: row.expires_at ?? null,
    recipientEmail: row.recipient_email ?? null,
    note: row.note ?? null,
    createdAt: row.created_at ?? "",
  };
}

/** A ledger row; a kind the OS does not know shows as a hand correction rather than disappearing. */
export function toWebshopGiftCardTransaction(
  row: MedusaGiftCardTransactionRow,
): WebshopGiftCardTransaction {
  return {
    id: row.id,
    kind: (KINDS as readonly string[]).includes(row.kind)
      ? (row.kind as WebshopGiftCardTransactionKind)
      : "adjust",
    amount: Number(row.amount),
    balanceAfter: Number(row.balance_after),
    reference: row.reference ?? null,
    createdAt: row.created_at ?? "",
  };
}
