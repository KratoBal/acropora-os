import type { IncomingBillingDocument } from "@acropora/database";

import type { BankFeeDebit } from "../missing-invoices/missing-invoices.service.js";
import { supplierAccountKey } from "./supplier-bank-account-key.js";

/**
 * A BANK SAJÁT SZÁMLÁJA, AMIT A BANK LEVON (acrobot 58915, nautilus 58712 javaslata; az OTP-sor, 9 525 Ft): a bank a saját díjait a számláról levonja, és a terhelés a kivonaton nem a számlához
 * párosított, hanem „Nem kell számla” (BANK_FEE). A sor ezért a „valószínűleg nem utalandó” szakaszba kerül, ha MIND a három igaz:
 *  1. a számla kiállítója MAGA A SZÁMLAVEZETŐ BANK (adószám-törzs szerint, a környezetből: `DUE_INVOICES_ACCOUNT_BANK_TAX_BASES`): egy idegen szállító azonos összegű sora nem eshet bele;
 *  2. a számla bruttó összegével AZONOS (és azonos pénznemű) bank-díj terhelés áll a kivonaton, a számla kiállítása napjától számított `WINDOW_DAYS` napon belül;
 *  3. a terhelés EGYSZER használható: egy terhelés egy számlát igazol (a két azonos összegű díj egy hónapban eset a bank saját számlái között is csak egy-egy párt ad).
 * Semmi nem esik ki: a sor a szakaszban áll, „a bank levonta” okkal, ami „valószínű”, nem tény.
 *
 * A BANK ADÓSZÁMA A KÖRNYEZETBŐL JÖN, NEM A KÓDBÓL (barracuda 58920, Balázs 2026-09-25 elve: ez a kód egyszer publikus alap): az, hogy melyik bank a számlavezetőnk, cégadat. A
 * `DUE_INVOICES_ACCOUNT_BANK_TAX_BASES` vesszővel elválasztott 8 jegyű adószám-törzsek listája. ÜRESEN A SZABÁLY NEM FUT (a konzervatív oldal: semmi nem mozog). Az éles értéket a környezet adja.
 */
export const ACCOUNT_BANK_TAX_BASES_ENV = "DUE_INVOICES_ACCOUNT_BANK_TAX_BASES";

/**
 * A környezeti érték: vesszővel elválasztott adószámok, mindegyikből az első 8 számjegy (a kötőjeles 11 jegyű alak is jó). A 8 jegynél rövidebb vagy számjegy nélküli elem kimarad. Üres vagy hiányzó
 * érték üres halmaz: a szabály nem fut.
 */
export function parseAccountBankTaxBases(
  value: string | undefined,
): ReadonlySet<string> {
  const bases = (value ?? "")
    .split(",")
    .map((part) => part.replace(/\D/g, ""))
    .filter((digits) => digits.length >= 8)
    .map((digits) => digits.slice(0, 8));
  return new Set(bases);
}

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
  /** a számlavezető bank(ok) 8 jegyű adószám-törzse (`parseAccountBankTaxBases`); üresen nincs bizonyíték */
  bankTaxBases: ReadonlySet<string>;
}): ReadonlyMap<string, { bookingDate: string }> {
  const evidence = new Map<string, { bookingDate: string }>();
  if (input.bankTaxBases.size === 0) return evidence;
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
        input.bankTaxBases.has(key.slice(3))
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
