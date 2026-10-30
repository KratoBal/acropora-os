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
 *
 * A KULCS A KÖZLEMÉNYT IS TARTALMAZZA (a CSV-sor nyers mezőinek hash-e), ezért ugyanaz a
 * fizetés egy MÁSIK exportban más közleménnyel (a csonka "CM9266 0,0 CMCIFR2A ..." a hosszú
 * helyett) új kulcsot kap, és a helyén a forrás már lefoglalt egy tranzakciót: nincs szabad,
 * tehát DUPLA keletkezne (Aquarioom 2026-10-12, 1186,80 EUR és 1,90 EUR, mérve acrobot
 * 2026-10-30). Ezt fogja meg a "SAME_PAYMENT_NEW_KEY": lásd a `planBankRows`.
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
  /**
   * A könyvelési nap. Nélküle az "ugyanaz a fizetés, új kulccsal" ág nem fut (lásd
   * `planBankRows`): egy azonos hely más könyvelési napon valódi második fizetés.
   */
  readonly bookingDate?: Date;
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
  readonly bookingDate?: Date;
}

export type BankRowAction =
  | {
      readonly kind: "SKIP";
      readonly reason: "SAME_SOURCE_KEY" | "SAME_PAYMENT_NEW_KEY";
    }
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
 *   ismert forrás-kulcs                         SKIP (SAME_SOURCE_KEY)
 *   van azonos helyű tranzakció, amit ez a
 *   forrás még nem foglalt le                   CLAIM (a legkorábbi ilyen)
 *   a forrás már lefoglalt egy azonos helyű és
 *   azonos KÖNYVELÉSI NAPÚ, korábbi importból
 *   való tranzakciót, amit ennek a kötegnek
 *   egyetlen ismert kulcsa sem birtokol         SKIP (SAME_PAYMENT_NEW_KEY)
 *   különben                                    CREATE
 *
 * A harmadik sor a közlemény-eltérés védelme (lásd a fájl fejét): ugyanaz a fizetés új
 * kulccsal NEM új fizetés. A feltétel szándékosan szűk, hogy egy valódi második fizetést
 * ne nyeljen el:
 *  - csak KORÁBBI importból való tranzakció számít (a kötegben most létrejövő nem: két
 *    azonos fizetés egy fájlban két külön tranzakció, ahogy eddig);
 *  - a könyvelési napnak is egyeznie kell (egy azonos hely más könyvelési napon másik
 *    fizetés: az azonnali utalásnál 1-3 nap az eltérés);
 *  - egy tranzakciót, amelynek kulcsa ebben a kötegben is szerepel (a fájl azt a sort már
 *    hozza), nem "fogyaszt" el egy másik sor: a fájlban a hely második sora valódi második
 *    fizetés, ha a hely többi tranzakcióját a fájl más sorai birtokolják;
 *  - egy tranzakciót egy köteg legfeljebb egy sora fogyaszt el.
 * A harmadik sor CSAK a CSV-nél fut (a CSV-kulcs a sor tartalmából számolódik, ezért változhat; a Számlázz.hu
 * azonosítója a fizetés saját azonosítója, egy új azonosító új fizetés: a három azonos Alza-fizetésből a
 * továbbítás harmadik azonosítója új tranzakció, a CSV még csak kettőt hozott). Csak akkor fut, ha a hívó megadja a már ismert kulcsok tulajdonosait
 * (`knownOwners`: kulcs -> tranzakció) és a sorok könyvelési napját; enélkül a régi viselkedés áll.
 *
 * A bemenet sorrendjében dönt, és a saját döntéseit is látja: egy köteg két
 * azonos sora két külön tranzakciót foglal vagy hoz létre.
 */
export function planBankRows(
  incoming: readonly IncomingBankRow[],
  knownSourceKeys: ReadonlySet<string>,
  existing: readonly ExistingBankTransaction[],
  knownOwners?: ReadonlyMap<string, string>,
): BankRowAction[] {
  type Entry = {
    id: string;
    sources: Set<BankSource>;
    bookingDay: string | null;
    /** Korábbi importból való (nem a kötegben létrejött). */
    earlier: boolean;
  };
  const day = (d: Date | undefined) =>
    d ? d.toISOString().slice(0, 10) : null;
  const bySlot = new Map<string, Entry[]>();
  for (const tx of existing) {
    const slot = bankSlot(tx);
    const list = bySlot.get(slot) ?? [];
    list.push({
      id: tx.id,
      sources: new Set(tx.sources),
      bookingDay: day(tx.bookingDate),
      earlier: true,
    });
    bySlot.set(slot, list);
  }
  // azok a tranzakciók, amelyeknek kulcsa ebben a kötegben is szerepel: a fájl őket már hozza
  const ownedByBatch = new Set<string>();
  if (knownOwners)
    for (const r of incoming) {
      const owner = knownOwners.get(r.sourceKey);
      if (owner) ownedByBatch.add(owner);
    }
  const consumed = new Set<string>();
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
    const rowDay = day(row.bookingDate);
    // CSAK a tartalomból számolt kulcsú forrásnál (CSV): a Számlázz.hu azonosítója a fizetés SAJÁT azonosítója, egy új
    // azonosító mindig új fizetés (a 72 órás újraküldés ugyanazt az azonosítót hozza), azt a hely nem olvaszthatja be
    if (knownOwners && rowDay && row.source === "CSV") {
      const same = list.find(
        (tx) =>
          tx.earlier &&
          tx.sources.has(row.source) &&
          tx.bookingDay === rowDay &&
          !ownedByBatch.has(tx.id) &&
          !consumed.has(tx.id),
      );
      if (same) {
        consumed.add(same.id);
        return { kind: "SKIP", reason: "SAME_PAYMENT_NEW_KEY" } as const;
      }
    }
    // az újonnan létrejövő sort a köteg többi sora is látja
    list.push({
      id: `new:${row.sourceKey}`,
      sources: new Set([row.source]),
      bookingDay: rowDay,
      earlier: false,
    });
    bySlot.set(slot, list);
    return { kind: "CREATE" } as const;
  });
}
