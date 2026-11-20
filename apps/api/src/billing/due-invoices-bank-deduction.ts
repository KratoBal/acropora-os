import type { IncomingBillingDocument } from "@acropora/database";

import type { BankFeeDebit } from "../missing-invoices/missing-invoices.service.js";
import { supplierAccountKey } from "./supplier-bank-account-key.js";

/**
 * A BANK SAJÁT SZÁMLÁJA, AMIT A BANK LEVON (acrobot 58915, nautilus 58712 javaslata; az OTP-sor, 9 525 Ft): a bank a saját díjait a számláról levonja, és a terhelés a kivonaton nem a számlához
 * párosított, hanem „Nem kell számla” (BANK_FEE). A sor ezért a „valószínűleg nem utalandó” szakaszba kerül, ha MIND a három igaz:
 *  1. a számla kiállítója MAGA A SZÁMLAVEZETŐ BANK (adószám-törzs szerint, `ACCOUNT_KEEPING_BANK_TAX_BASES`): egy idegen szállító azonos összegű sora nem eshet bele;
 *  2. a számla bruttó összegével AZONOS (és azonos pénznemű) bank-díj terhelés áll a kivonaton, a számla kiállítása napjától számított `WINDOW_DAYS` napon belül;
 *  3. a terhelés EGYSZER használható: egy terhelés egy számlát igazol (a két azonos összegű díj egy hónapban eset a bank saját számlái között is csak egy-egy párt ad).
 * Semmi nem esik ki: a sor a szakaszban áll, „a bank levonta” okkal, ami „valószínű”, nem tény.
 *
 * A BANK ADÓSZÁMA: a számlavezető bank a kivonat-feltöltés forrása (`otp-statement.parser.ts`: minden betöltött kivonat OTP-é), adószám-törzse 10537914 (az OTP Bank Nyrt. kivonatán áll). Ha egy MÁSIK
 * számlavezető bank kivonata is betöltődik, annak törzsét ide kell venni; addig az ő számlái nem kapnak ilyen besorolást (a konzervatív oldal).
 */
export const ACCOUNT_KEEPING_BANK_TAX_BASES: ReadonlySet<string> = new Set([
  "10537914",
]);

/** A számla kiállításától a terhelés könyvelési napjáig eltelt legtöbb nap. */
export const WINDOW_DAYS = 45;

const dayGap = (from: string, to: string) =>
  Math.round(
    (Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) -
      Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) /
      86_400_000,
  );

const money = (value: { toFixed(digits?: number): string }, currency: string) =>
  value.toFixed(currency === "HUF" ? 0 : 2);

export function bankDeductionEvidence(input: {
  rows: readonly IncomingBillingDocument[];
  bankFeeDebits: readonly BankFeeDebit[];
}): ReadonlyMap<string, { bookingDate: string }> {
  const evidence = new Map<string, { bookingDate: string }>();
  const bankRows = input.rows
    .filter((row) => {
      if (row.cancelled) return false;
      const key = supplierAccountKey(
        row.supplierTaxNumber,
        row.supplierEuTaxNumber,
        row.supplierName,
      );
      return (
        key !== null &&
        key.startsWith("hu:") &&
        ACCOUNT_KEEPING_BANK_TAX_BASES.has(key.slice(3))
      );
    })
    // a korábbi számla választ elébb a korábbi terhelést: determinisztikus párosítás
    .sort(
      (a, b) =>
        new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime() ||
        a.id.localeCompare(b.id),
    );
  const used = new Set<number>();
  const debits = [...input.bankFeeDebits].sort((a, b) =>
    a.bookingDate.localeCompare(b.bookingDate),
  );
  for (const row of bankRows) {
    const issued = new Date(row.issueDate).toISOString().slice(0, 10);
    const amount = money(row.grossAmount, row.currency);
    const at = debits.findIndex(
      (debit, index) =>
        !used.has(index) &&
        debit.currency === row.currency &&
        debit.amount === amount &&
        dayGap(issued, debit.bookingDate) >= 0 &&
        dayGap(issued, debit.bookingDate) <= WINDOW_DAYS,
    );
    if (at === -1) continue;
    used.add(at);
    evidence.set(row.id, { bookingDate: debits[at]!.bookingDate });
  }
  return evidence;
}
