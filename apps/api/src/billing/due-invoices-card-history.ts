import type { IncomingBillingDocument } from "@acropora/database";

import { pairingOfRow } from "./incoming-billing-documents.js";
import { supplierAccountKey } from "./supplier-bank-account-key.js";
import type { DocumentPairing } from "../missing-invoices/missing-invoices.service.js";

/**
 * A SZÁLLÍTÓ MÁSIK SZÁMLÁINAK FIZETÉSE, a Lejáró számlák „valószínűleg nem utalandó” szakaszához (acrobot 58830, nautilus 58712). TISZTA FÜGGVÉNY: a bejövő számla sorai és a banki párosítás kell hozzá.
 *
 * SZÁLLÍTÓ (`supplierAccountKey`): csak a `hu:` és az `eu:` kulcs, vagyis az adószám azonosít. A csak névvel azonosított szállítóra NEM következtetünk (két azonos nevű cég egy szállítónak számítana, mint a
 * számlaszám-pótlásnál, barracuda #2796).
 *
 * EGY MÁSIK SZÁMLA MÚLTJA: a számlához párosított banki terhelés(ek). Ha MINDEN párosított terhelése kártyás, a számlát KÁRTYÁVAL fizettük; ha bármelyik nem kártyás (vagy a típusa hiányzik), UTALÁSKÉNT számít:
 * a bizonytalan terhelés a konzervatív oldalra esik, vagyis a sor a főlistában marad. Párosított terhelés nélküli számla nem tanúsít semmit.
 *
 * A SORRA: a szállítónak legyen legalább egy kártyával fizetett MÁSIK számlája, és EGY SEM utalással fizetett. Egy utalással fizetett előzmény (Neptun, nautilus mérése) kizárja a besorolást: egy kártyás
 * szállító is küldhet utalásos számlát, és a főlista az UTALANDÓ tételeké.
 */
export function cardPaidSupplierEvidence(input: {
  rows: readonly IncomingBillingDocument[];
  pairings: ReadonlyMap<string, DocumentPairing>;
}): ReadonlyMap<string, { kind: "CARD"; cardInvoices: number }> {
  const history = new Map<
    string,
    { card: Set<string>; transfer: Set<string> }
  >();
  const keyOf = (row: IncomingBillingDocument) => {
    const key = supplierAccountKey(
      row.supplierTaxNumber,
      row.supplierEuTaxNumber,
      row.supplierName,
    );
    return key !== null && !key.startsWith("name:") ? key : null;
  };
  for (const row of input.rows) {
    const key = keyOf(row);
    if (key === null || row.cancelled) continue;
    const debits = pairingOfRow(row, input.pairings)?.debits ?? [];
    if (debits.length === 0) continue;
    const entry = history.get(key) ?? {
      card: new Set<string>(),
      transfer: new Set<string>(),
    };
    (debits.every((debit) => debit.card === true)
      ? entry.card
      : entry.transfer
    ).add(row.id);
    history.set(key, entry);
  }
  const evidence = new Map<string, { kind: "CARD"; cardInvoices: number }>();
  for (const row of input.rows) {
    const key = keyOf(row);
    const entry = key === null ? undefined : history.get(key);
    if (!entry) continue;
    const otherCard = [...entry.card].filter((id) => id !== row.id).length;
    const otherTransfer = [...entry.transfer].filter(
      (id) => id !== row.id,
    ).length;
    if (otherCard > 0 && otherTransfer === 0)
      evidence.set(row.id, { kind: "CARD", cardInvoices: otherCard });
  }
  return evidence;
}
