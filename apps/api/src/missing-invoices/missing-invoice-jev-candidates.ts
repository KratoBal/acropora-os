import type { Prisma } from "@acropora/database";

import type { BankCategory } from "./bank-transaction.classify.js";
import {
  inWindow,
  samePartner,
  type CandidateDocument,
  type MatchOutcome,
} from "./missing-invoice-matching.js";

/**
 * MELYIK TERHELES KAP JEV-JAVASLATOT, ES MILYEN JELOLTEKKEL.
 *
 * A Jev a gepi szabalyok UTANI maradekon dolgozik, es csak ott, ahol MERTUK: a
 * celzott meres halmaza (nautilus, 2026-10-01; Balazs 06:00:34 UTC dontese). Ez a
 * fuggveny ugyanazt a szabalyt alkalmazza, mint a meres osszeallitoja, a
 * termek sajat adatan:
 *
 *   - a terheles Nem parosodott vagy Nincs szamla allapotu, es szamlat igenyel;
 *   - van hozza SZABAD szamla a datumablakban (egyik terheles sem vitte el), ami
 *       NEV:     pontos osszeg (5 Ft-on belul), de mas kiallito, vagy
 *       OSSZEG:  ugyanaz a partner, az osszeg max(1000 Ft, 5%)-on belul elter,
 *                de nem pontos;
 *   - a Parkl NEM: azt a gyujtoszamla-szabaly viszi (a meres is kihagyta).
 *
 * A jeloltek: a talalatok, melleje az ablak tobbi szamlaja ugyanattol a
 * partnertol vagy 5%-on beluli osszeggel, legfeljebb 12, datum szerint.
 */

/** A szamlat igenylo kategoriak (a meres `NEEDS` halmaza). */
const NEEDS_INVOICE: ReadonlySet<BankCategory> = new Set<BankCategory>([
  "DOMESTIC_SUPPLIER",
  "FOREIGN_SUPPLIER",
  "CARD_SUBSCRIPTION",
  "INSURANCE",
  "UNCERTAIN",
]);
const OPEN_STATES = new Set(["NOT_MATCHED", "NO_INVOICE"]);
const POOL_LIMIT = 12;

export interface JevDebit {
  readonly id: string;
  /** ÉÉÉÉ-HH-NN */
  readonly bookingDate: string;
  readonly amount: Prisma.Decimal;
  readonly currency: string;
  readonly original: { amount: Prisma.Decimal; currency: string } | null;
  readonly counterpartyName: string | null;
  readonly category: BankCategory;
}

export type JevKind = "NEV" | "OSSZEG";

export interface JevPairInput {
  readonly kinds: readonly JevKind[];
  readonly candidates: readonly CandidateDocument[];
}

const amountOf = (debit: JevDebit, currency: string): number | null =>
  currency === debit.currency
    ? Number(debit.amount)
    : debit.original && debit.original.currency === currency
      ? Number(debit.original.amount)
      : null;

const near = (a: number, g: number, currency: string) => {
  const gap = Math.abs(a - g);
  return (
    gap > (currency === "HUF" ? 5 : 0.01) &&
    gap <= Math.max(currency === "HUF" ? 1000 : 20, 0.05 * Math.max(a, g))
  );
};
const exactish = (a: number, g: number, currency: string) =>
  Math.abs(a - g) <= (currency === "HUF" ? 5 : 0.01);

/**
 * A szabad szamlak: amit egyik terheles sem vitt el, es van bruttoja. Egyszer
 * szamolando az osszes kimenetelbol (egy szamlat egy terheles visz).
 */
export function freeDocuments(
  documents: readonly CandidateDocument[],
  outcomes: ReadonlyMap<string, MatchOutcome>,
): CandidateDocument[] {
  const used = new Set(
    [...outcomes.values()].flatMap((o) => o.documents.map((d) => d.id)),
  );
  return documents.filter((d) => !used.has(d.id) && d.gross !== null);
}

/** `null`: erre a terhelesre nincs javaslat (nem mert terulet, vagy nincs mit valasztani). */
export function jevPairInput(
  debit: JevDebit,
  outcome: MatchOutcome,
  free: readonly CandidateDocument[],
): JevPairInput | null {
  if (!OPEN_STATES.has(outcome.state) || !NEEDS_INVOICE.has(debit.category))
    return null;
  const name = debit.counterpartyName ?? "";
  if (/parkl/i.test(name)) return null;
  const window = free.filter((d) => inWindow(debit.bookingDate, d.date));
  const kinds = new Set<JevKind>();
  const hits: CandidateDocument[] = [];
  for (const d of window) {
    const a = amountOf(debit, d.currency);
    if (a === null) continue;
    const g = Number(d.gross);
    const same = name !== "" && samePartner(d.supplierName, name, 0.5);
    if (same && near(a, g, d.currency)) {
      kinds.add("OSSZEG");
      hits.push(d);
    } else if (!same && exactish(a, g, d.currency)) {
      kinds.add("NEV");
      hits.push(d);
    }
  }
  if (hits.length === 0) return null;
  const a = Number(debit.amount);
  const pool = new Map(hits.map((d) => [d.id, d]));
  for (const d of window) {
    if (pool.size >= POOL_LIMIT) break;
    const g = Number(d.gross);
    const close =
      d.currency === debit.currency && Math.abs(a - g) <= 0.05 * Math.max(a, g);
    if ((name !== "" && samePartner(d.supplierName, name, 0.5)) || close)
      pool.set(d.id, d);
  }
  return {
    kinds: [...kinds],
    candidates: [...pool.values()].sort(
      (x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id),
    ),
  };
}
