import type { Prisma } from "@acropora/database";

import { normalizeAccount } from "./missing-invoices.repository.js";

/**
 * EGY BANKI TRANZAKCIÓ TÖBB FORRÁSBÓL: a havi CSV-kivonat és a Számlázz.hu
 * tranzakció-továbbítása (acrobot 25599, mérés: `megosztas/szamlazz-bank-tranzakciok-meres.md`).
 *
 * A két forrás UGYANAZT a fizetést más alakban hozza: a CSV-kulcs a nyers CSV-mezők
 * hash-e, a továbbításé a Számlázz.hu `id`-je; könyvelési napot csak a CSV ad, a
 * közleményt és a partner-nevet a kettő másképp írja. Ezért két kulcs van:
 *
 *   a forrás-kulcs   a forrás saját azonosítója (`csv:<hash>`, `szamlazz:<id>`):
 *                    ugyanazt a sort UGYANABBÓL a forrásból másodszor nem írjuk be
 *   a hely           számla, irány, összeg, deviza, ÉRTÉKNAP, partner-számla:
 *                    ezen találkozik a két forrás
 *
 * Az értéknap, nem a könyvelési nap (mérve a saját exportjainkon: az azonnali
 * fizetésnél 313-ból 64-szer 1-3 nappal később van a könyvelés, a továbbítás pedig
 * csak értéknapot hoz). A közlemény és a partner-név NEM része a helynek.
 *
 * Két azonos fizetés egy napon két tranzakció (mérve: két 23 810 Ft-os Alza-vásárlás):
 * minden forrás-kulcs EGY tranzakciót foglal le, és egy tranzakciót forrásonként
 * legfeljebb egy kulcs foglalhat.
 */

export type BankSource = "CSV" | "SZAMLAZZ";

export interface IncomingBankRow {
  readonly source: BankSource;
  /** A forrás saját kulcsa, a forrás előtagjával. */
  readonly sourceKey: string;
  readonly accountNumber: string;
  readonly direction: "DEBIT" | "CREDIT";
  readonly amount: Prisma.Decimal;
  readonly currency: string;
  /** Ha a forrás nem ad értéknapot, a könyvelési nap áll itt. */
  readonly valueDate: Date;
  readonly counterpartyAccount: string | null;
}

export interface ExistingBankTransaction {
  readonly id: string;
  readonly accountNumber: string;
  readonly direction: "DEBIT" | "CREDIT";
  readonly amount: Prisma.Decimal;
  readonly currency: string;
  readonly valueDate: Date;
  readonly counterpartyAccount: string | null;
  /** Melyik források foglalták már le. */
  readonly sources: readonly BankSource[];
}

export type BankRowAction =
  | { readonly kind: "SKIP"; readonly reason: "SAME_SOURCE_KEY" }
  | { readonly kind: "CLAIM"; readonly transactionId: string }
  | { readonly kind: "CREATE" };

/** A hely: ezen a kulcson találkozik ugyanaz a fizetés a két forrásból. */
export function bankSlot(row: {
  readonly accountNumber: string;
  readonly direction: string;
  readonly amount: Prisma.Decimal;
  readonly currency: string;
  readonly valueDate: Date;
  readonly counterpartyAccount: string | null;
}): string {
  return [
    normalizeAccount(row.accountNumber),
    row.direction,
    row.amount.toFixed(4),
    row.currency.toUpperCase(),
    row.valueDate.toISOString().slice(0, 10),
    normalizeAccount(row.counterpartyAccount),
  ].join("\u001f");
}

/**
 * A DÖNTÉS SORONKÉNT, adatbázis nélkül.
 *
 *   ismert forrás-kulcs                         SKIP
 *   van azonos helyű tranzakció, amit ez a
 *   forrás még nem foglalt le                   CLAIM (a legkorábbi ilyen)
 *   különben                                    CREATE
 *
 * A bemenet sorrendjében dönt, és a saját döntéseit is látja: egy köteg két
 * azonos sora két külön tranzakciót foglal vagy hoz létre.
 */
export function planBankRows(
  incoming: readonly IncomingBankRow[],
  knownSourceKeys: ReadonlySet<string>,
  existing: readonly ExistingBankTransaction[],
): BankRowAction[] {
  const bySlot = new Map<string, { id: string; sources: Set<BankSource> }[]>();
  for (const tx of existing) {
    const slot = bankSlot(tx);
    const list = bySlot.get(slot) ?? [];
    list.push({ id: tx.id, sources: new Set(tx.sources) });
    bySlot.set(slot, list);
  }
  const seenKeys = new Set(knownSourceKeys);
  return incoming.map((row) => {
    if (seenKeys.has(row.sourceKey))
      return { kind: "SKIP", reason: "SAME_SOURCE_KEY" } as const;
    seenKeys.add(row.sourceKey);
    const slot = bankSlot(row);
    const list = bySlot.get(slot) ?? [];
    const free = list.find((tx) => !tx.sources.has(row.source));
    if (free) {
      free.sources.add(row.source);
      return { kind: "CLAIM", transactionId: free.id } as const;
    }
    // az újonnan létrejövő sort a köteg többi sora is látja
    list.push({ id: `new:${row.sourceKey}`, sources: new Set([row.source]) });
    bySlot.set(slot, list);
    return { kind: "CREATE" } as const;
  });
}
