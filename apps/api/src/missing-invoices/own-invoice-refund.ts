import type { Prisma } from "@acropora/database";

import {
  inWindow,
  narrativeTokens,
  samePartner,
} from "./missing-invoice-matching.js";

/**
 * EGY SAJÁT SZÁMLA SZTORNÓJÁNAK ÖSSZEGÉT VISSZAUTALJUK A VEVŐNEK (kártya a116ec70, Balázs képernyőképe 2026-11-05 16:19 UTC):
 * az „E-CRPR-2026-1 utalás vissza” közleményű 11 287 062 Ft terhelés „Kérd el a számlát a partnertől” állapotot kapott, holott
 * a vevőnknek fizettünk vissza, és nem kell hozzá számla. A magánszemélynek küldött visszatérítést a besorolás a számlaszám-
 * mintából már felismeri (`classifyTransaction`); a cégnek küldöttet ott nem lehet (egy beszállító is hivatkozhat a mi
 * számlánkra), ezért ide adat kell: ugyanaz a vevő, azonos összegű sztornó.
 *
 * A SZABÁLY, mind a három együtt:
 *  1. a közlemény SZÓ SZERINT megnevez egy saját kimenő számlaszámot (nem előtag, nem minta: a számlaszám a feedből ismert);
 *  2. létezik sztornó vagy jóváíró számla (Számlázz.hu SS vagy JS), amelynek vevője ugyanaz a partner, mint a terhelés
 *     kedvezményezettje, és a végösszege (előjel nélkül, azonos pénznemben) PONTOSAN a terhelés összege;
 *  3. a sztornó kelte a párosítás szokásos ablakán belül van (`inWindow`).
 * Részleges visszatérítés vagy másik összeg nem esik ide: azt ember nézze meg.
 */
export interface OwnInvoiceDocument {
  number: string;
  kindCode: string;
  customerName: string;
  /** Előjel nélkül is összehasonlítandó végösszeg. */
  gross: Prisma.Decimal;
  currency: string;
  /** ÉÉÉÉ-HH-NN */
  issueDate: string;
}

const CREDIT_KINDS: ReadonlySet<string> = new Set(["SS", "JS"]);
const normalizedNumber = (number: string) =>
  number.replace(/\s/g, "").toLowerCase();

export interface OwnInvoiceRefund {
  /** A közleményben megnevezett saját számlaszám, ahogy a feedben áll. */
  cited: string;
  /** A sztornó vagy jóváíró számla, amelynek összegét visszautaltuk. */
  credit: OwnInvoiceDocument;
}

export function ownInvoiceRefund(
  debit: {
    bookingDate: string;
    amount: Prisma.Decimal;
    currency: string;
    counterpartyName: string | null;
    narrative: string;
  },
  ownDocuments: readonly OwnInvoiceDocument[],
): OwnInvoiceRefund | null {
  if (!debit.counterpartyName) return null;
  const tokens = new Set(narrativeTokens(debit.narrative));
  const cited = ownDocuments.find(
    (document) =>
      !CREDIT_KINDS.has(document.kindCode.toUpperCase()) &&
      tokens.has(normalizedNumber(document.number)),
  );
  if (!cited) return null;
  const credit = ownDocuments.find(
    (document) =>
      CREDIT_KINDS.has(document.kindCode.toUpperCase()) &&
      document.currency.toUpperCase() === debit.currency.toUpperCase() &&
      document.gross.abs().equals(debit.amount.abs()) &&
      samePartner(document.customerName, debit.counterpartyName!, 0.5) &&
      inWindow(debit.bookingDate, document.issueDate),
  );
  return credit ? { cited: cited.number, credit } : null;
}
