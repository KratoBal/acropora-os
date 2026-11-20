import { Prisma } from "@acropora/database";
import type {
  DueInvoiceAccountSource,
  DueInvoiceItem,
  DueInvoicesResponse,
  IncomingDocumentListItem,
  ProbablyNotTransferItem,
} from "@acropora/types";

/**
 * LEJÁRÓ SZÁMLÁK, AZ 1. SZELET: a lista (Balázs, Acropora OS szál, 2026-11-20 14:50 UTC; acrobot 58227, 58229). Tiszta függvény a
 * Bejövő számlák listájának soraiból (`incomingListItems`: ugyanaz a kifizetettség, ugyanaz a banki párosítás), új logika nélkül.
 *
 * MELYIK SOR: Számlázz.hu-ból érkezett fizetendő számla (`SZ`, `VS`, `ES`: a jóváíró, a sztornó és a díjbekérő nem), nem
 * sztornózott, nem „nem könyvelendő”, ÁTUTALÁSOS fizetési móddal (a mód szövege „utal” szót tartalmaz, ékezet nélkül mérve), és
 * még nincs teljesen kifizetve (a hátralék pozitív). A fizetési mód HIÁNYA nem zárja ki a sort: „nincs adat” jelzéssel marad
 * (Balázs jóváhagyta), mert egy csendben kieső tétel rosszabb egy jelzett tételnél. Egy másik módú (készpénz, bankkártya) sor kiesik.
 *
 * SORREND (Balázs jóváhagyta, 2026-11-20 14:51 UTC): a LEJÁRT, ki nem fizetett tételek elöl, külön jelölve, a legrégebben lejárt
 * legfelül; utána a mai vagy későbbi határidők növekvően (a határidőhöz legközelebbi elöl); a határidő nélküliek a végén. Azonos
 * határidőnél a cég neve, majd a számla száma dönt.
 *
 * A „VALÓSZÍNŰLEG NEM UTALANDÓ” SZAKASZ (acrobot 58830, nautilus 58712): a fizetési mód NÉLKÜLI sorok közül az, amelynek szállítójánál a MÁSIK számláit kártyával fizettük (`cardPaidEvidence`), nem a főlistába,
 * hanem külön szakaszba kerül az okkal. NEM esik ki (Balázs szabálya), csak nem az utalandó összegben áll; az átutalás szavával jelölt sor soha nem kerül ide: a számla saját szava erősebb a szállító múltjánál.
 *
 * KÖZLEMÉNY: alapból a számla száma. Egy „a számla PDF-je más közleményt kér” olvasat az adatban ma NINCS (a `bankReference` a
 * banki terhelés közleményéből olvasott hivatkozás, nem a PDF kérése), ezért minden sor az alapértelmezést jelöli.
 */

/** A fizetendő feed-típusok: számla, végszámla, előlegszámla (a `feed-backfill.ts` ugyanezt a három kódot használja). */
export const PAYABLE_KINDS: ReadonlySet<string> = new Set(["SZ", "VS", "ES"]);

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "");

/** Átutalásos-e a számlán álló fizetési mód: „Átutalás”, „Banki átutalás”, „Utalás”, „Előre utalás”. */
export const isTransferMethod = (method: string | null): boolean =>
  method !== null && fold(method).toLowerCase().includes("utal");

/** Napok különbsége két `ÉÉÉÉ-HH-NN` nap között (a kisebb a korábbi). */
const dayGap = (from: string, to: string) =>
  Math.round(
    (Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) -
      Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) /
      86_400_000,
  );

const blank = (value: string | null | undefined) =>
  value === null || value === undefined || value.trim() === "";

export function buildDueInvoices(input: {
  items: readonly IncomingDocumentListItem[];
  /** a sor azonosítója -> a cég bankszámlaszáma (a lista sora nem hordozza); a sor saját adata, ennek hiányában a pótlás (`supplier-bank-account-resolve.ts`) */
  bankAccounts: ReadonlyMap<string, string | null>;
  /** a sor azonosítója -> a pótolt számlaszám forrása; ami nincs benne, annak a számlaszáma a sor SAJÁT adata (`OWN`) */
  bankAccountSources?: ReadonlyMap<string, DueInvoiceAccountSource>;
  /** a sor azonosítója -> hány MÁSIK számláját fizettük a szállítónak kártyával (és egyiket sem utalással): `cardPaidSupplierEvidence`; ami nincs benne, annak nincs ilyen múltja */
  cardPaidEvidence?: ReadonlyMap<string, { cardInvoices: number }>;
  /** `ÉÉÉÉ-HH-NN`, Budapest */
  today: string;
}): DueInvoicesResponse {
  const { today } = input;
  const rows: DueInvoiceItem[] = [];
  const notTransfer: ProbablyNotTransferItem[] = [];
  for (const item of input.items) {
    if (!PAYABLE_KINDS.has(item.kindCode.toUpperCase())) continue;
    if (item.cancelled || item.notBookable) continue;
    if (item.paymentState === "PAID") continue;
    const methodMissing = blank(item.paymentMethod);
    if (!methodMissing && !isTransferMethod(item.paymentMethod)) continue;
    if (item.grossAmount === null) continue;
    const outstanding = new Prisma.Decimal(item.grossAmount).minus(
      new Prisma.Decimal(item.paidAmount),
    );
    if (!outstanding.gt(0)) continue;
    const account = input.bankAccounts.get(item.id) ?? null;
    const dueDate = item.dueDate;
    const overdue = dueDate !== null && dueDate < today;
    const row: DueInvoiceItem = {
      id: item.id,
      documentNumber: item.documentNumber,
      supplierName: item.supplierName,
      dueDate,
      overdue,
      daysOverdue: overdue ? dayGap(dueDate, today) : null,
      supplierBankAccount: blank(account) ? null : account!.trim(),
      supplierBankAccountSource: blank(account)
        ? null
        : (input.bankAccountSources?.get(item.id) ?? "OWN"),
      outstanding: outstanding.toFixed(item.currency === "HUF" ? 0 : 2),
      currency: item.currency,
      reference: item.documentNumber,
      referenceIsDefault: true,
      paymentMethod: methodMissing ? null : item.paymentMethod,
      missing: {
        dueDate: dueDate === null,
        supplierBankAccount: blank(account),
        paymentMethod: methodMissing,
      },
    };
    const evidence = methodMissing
      ? input.cardPaidEvidence?.get(item.id)
      : undefined;
    if (evidence) notTransfer.push({ ...row, evidence });
    else rows.push(row);
  }
  // a lejárt tételek a legkorábbi határidejük miatt eleve elöl állnak, tehát a csoportosítás csak a határidő nélkülieket választja le
  const group = (row: DueInvoiceItem) => (row.dueDate === null ? 1 : 0);
  const order = (a: DueInvoiceItem, b: DueInvoiceItem) =>
    group(a) - group(b) ||
    (a.dueDate ?? "").localeCompare(b.dueDate ?? "") ||
    a.supplierName.localeCompare(b.supplierName, "hu") ||
    a.documentNumber.localeCompare(b.documentNumber);
  rows.sort(order);
  notTransfer.sort(order);
  const sumByCurrency = (list: readonly DueInvoiceItem[]) => {
    const totals = new Map<string, Prisma.Decimal>();
    for (const row of list)
      totals.set(
        row.currency,
        (totals.get(row.currency) ?? new Prisma.Decimal(0)).plus(
          row.outstanding,
        ),
      );
    return [...totals]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, sum]) => ({
        currency,
        outstanding: sum.toFixed(currency === "HUF" ? 0 : 2),
      }));
  };
  return {
    asOf: today,
    items: rows,
    probablyNotTransfer: notTransfer,
    summary: {
      count: rows.length,
      overdue: rows.filter((r) => r.overdue).length,
      withMissingData: rows.filter(
        (r) =>
          r.missing.dueDate ||
          r.missing.supplierBankAccount ||
          r.missing.paymentMethod,
      ).length,
      totals: sumByCurrency(rows),
      probablyNotTransfer: {
        count: notTransfer.length,
        totals: sumByCurrency(notTransfer),
      },
    },
  };
}
