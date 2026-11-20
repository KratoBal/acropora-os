import { Prisma, type PrismaClient } from "@acropora/database";

import { hungarianTaxBase } from "../purchasing/nav-incoming-invoices/nav-incoming-invoice.types.js";
import { PAYABLE_KINDS, isTransferMethod } from "./due-invoices.js";
import {
  loadCollectedPdfIndex,
  type CollectedPdfSource,
} from "./incoming-collected-pdf.js";
import { attachedPdfIds } from "./incoming-pdf-attach.js";
import {
  planFills,
  type FillEvidence,
  type FillPlan,
  type FillSupplierInput,
} from "./supplier-bank-account-fill.js";
import {
  pdfIdsToRead,
  readPdfOutcome,
} from "./supplier-bank-account-extract.js";
import { supplierAccountKey } from "./supplier-bank-account-key.js";
import {
  accountFromBankText,
  normalizeSupplierAccount,
} from "./supplier-bank-account-text.js";

/**
 * A KITÖLTÉS BEMENETE AZ ADATBÁZISBÓL, ÉS AZ ÍRÁS (acrobot 58553, kártya 4900497b). A döntés tiszta (`supplier-bank-account-fill.ts`); ez csak olvas (a PDF-ek, a NAV-számlák, a párosított terhelések,
 * a szállító-törzs, a korábbi kitöltések), és egyetlen módon ír: a `SupplierBankAccountFill` táblába, `skipDuplicates`-szel (a szállítónként egy sor kulcsa egyedi, tehát meglévő sort nem ír felül).
 *
 * A CÉLSOROK a Lejáró számlák szűrőit követik (fizetendő típus, nem sztornó, nem „nem könyvelendő”, átutalás vagy üres fizetési mód, a hátralék pozitív, a feed számlaszáma üres), a banki
 * párosítás nélkül; a szállító azok közül való, akiknek van ilyen sora.
 */
export type FillDatabase = Pick<
  PrismaClient,
  | "incomingBillingDocument"
  | "incomingSupplierDocument"
  | "supplier"
  | "supplierBankAccountFill"
  | "navIncomingInvoice"
  | "bankTransactionMatch"
  | "bankTransaction"
  | "bankAccount"
>;

const blank = (value: string | null | undefined) =>
  value === null || value === undefined || value.trim() === "";

export interface FillReaders {
  /** a `pdfTextLines`; hibánál dob */
  lines(content: Uint8Array): Promise<string[]>;
}

export async function gatherFillSuppliers(
  database: FillDatabase,
  readers: FillReaders,
): Promise<FillSupplierInput[]> {
  const [rows, masters, fills, own] = await Promise.all([
    database.incomingBillingDocument.findMany(),
    database.supplier.findMany({
      select: {
        name: true,
        taxNumber: true,
        bankAccountNumber: true,
        iban: true,
      },
    }),
    database.supplierBankAccountFill.findMany({
      select: { supplierKey: true, account: true },
    }),
    database.bankAccount.findMany({ select: { accountNumber: true } }),
  ]);
  const [collected, attached] = await Promise.all([
    loadCollectedPdfIndex(database as unknown as CollectedPdfSource),
    attachedPdfIds(database as Parameters<typeof attachedPdfIds>[0]),
  ]);
  const ownAccounts = own
    .map((account) => account.accountNumber.replace(/\D/g, ""))
    .filter((digits) => digits.length >= 16);

  const existing = new Map<string, Set<string>>();
  const addExisting = (key: string | null, account: string | null) => {
    const normalized = normalizeSupplierAccount(account ?? "");
    if (!key || normalized === "") return;
    const set = existing.get(key) ?? new Set<string>();
    set.add(normalized);
    existing.set(key, set);
  };
  const keyOf = (row: (typeof rows)[number]) =>
    supplierAccountKey(
      row.supplierTaxNumber,
      row.supplierEuTaxNumber,
      row.supplierName,
    );
  for (const row of rows) addExisting(keyOf(row), row.supplierBankAccount);
  for (const master of masters) {
    const key = supplierAccountKey(
      master.taxNumber,
      master.taxNumber,
      master.name,
    );
    addExisting(key, master.bankAccountNumber);
    addExisting(key, master.iban);
  }
  for (const fill of fills) addExisting(fill.supplierKey, fill.account);

  const targets = rows.filter(
    (row) =>
      blank(row.supplierBankAccount) &&
      PAYABLE_KINDS.has(row.kindCode.toUpperCase()) &&
      !row.cancelled &&
      !row.notBookable &&
      (blank(row.paymentMethod) || isTransferMethod(row.paymentMethod)) &&
      new Prisma.Decimal(row.grossAmount).gt(row.paidAmount),
  );
  const bySupplier = new Map<string, typeof targets>();
  for (const row of targets) {
    const key = keyOf(row);
    if (key) bySupplier.set(key, [...(bySupplier.get(key) ?? []), row]);
  }

  const outcomes = new Map<string, FillEvidence[]>();
  const pdfEvidence = async (id: string): Promise<FillEvidence[]> => {
    const known = outcomes.get(id);
    if (known) return known;
    const outcome = await readPdfOutcome(
      {
        content: async (documentId) =>
          (
            await database.incomingSupplierDocument.findUnique({
              where: { id: documentId },
              select: { content: true },
            })
          )?.content ?? null,
        lines: readers.lines,
      },
      id,
      ownAccounts,
    );
    const evidence =
      outcome.state === "TEXT"
        ? outcome.candidates.map((candidate) => ({
            account: candidate.account,
            evidenceId: id,
          }))
        : [];
    outcomes.set(id, evidence);
    return evidence;
  };

  const debitByBase = await pairedDebitAccounts(
    database,
    new Set(
      [...bySupplier.keys()]
        .filter((key) => key.startsWith("hu:"))
        .map((key) => key.slice(3)),
    ),
  );

  const suppliers: FillSupplierInput[] = [];
  for (const [key, supplierRows] of bySupplier) {
    const pdf: FillEvidence[] = [];
    for (const row of supplierRows)
      for (const id of pdfIdsToRead(row, { attached, collected }))
        pdf.push(...(await pdfEvidence(id)));
    const first = supplierRows[0]!;
    suppliers.push({
      key,
      name: first.supplierName,
      taxNumber: first.supplierTaxNumber,
      euTaxNumber: first.supplierEuTaxNumber,
      existing: [...(existing.get(key) ?? [])],
      targetRows: supplierRows.length,
      pdf,
      debit: key.startsWith("hu:") ? (debitByBase.get(key.slice(3)) ?? []) : [],
    });
  }
  return suppliers.sort((a, b) => a.name.localeCompare(b.name, "hu"));
}

/**
 * A KORÁBBI, NAV-SZÁMLÁHOZ PÁROSÍTOTT TERHELÉSEK PARTNER-SZÁMLASZÁMA, szállítónként (adószám-törzs szerint). A párosítás a Hiányzó számlák (`BankTransactionMatch`, forrás NAV): egy terhelés,
 * amelyet ennek a szállítónak egy NAV-számlájához kötöttek, a szállítónak fizetett. Csak az ellenőrzött számlaszám-alak számít (`accountFromBankText`).
 */
async function pairedDebitAccounts(
  database: Pick<
    FillDatabase,
    "navIncomingInvoice" | "bankTransactionMatch" | "bankTransaction"
  >,
  bases: ReadonlySet<string>,
): Promise<Map<string, FillEvidence[]>> {
  const result = new Map<string, FillEvidence[]>();
  if (bases.size === 0) return result;
  const navs = (
    await database.navIncomingInvoice.findMany({
      select: { id: true, supplierTaxNumber: true },
    })
  ).flatMap((nav) => {
    const base = hungarianTaxBase(nav.supplierTaxNumber);
    return base && bases.has(base) ? [{ id: nav.id, base }] : [];
  });
  if (navs.length === 0) return result;
  const baseOfNav = new Map(navs.map((nav) => [nav.id, nav.base]));
  const matches = await database.bankTransactionMatch.findMany({
    where: { documentSource: "NAV", documentId: { in: [...baseOfNav.keys()] } },
    select: { bankTransactionId: true, documentId: true },
  });
  if (matches.length === 0) return result;
  const debits = await database.bankTransaction.findMany({
    where: {
      id: { in: matches.map((match) => match.bankTransactionId) },
      direction: "DEBIT",
      duplicateMarkedAt: null,
    },
    select: { id: true, counterpartyAccount: true },
  });
  const accountOf = new Map(
    debits.map((debit) => [
      debit.id,
      accountFromBankText(debit.counterpartyAccount),
    ]),
  );
  for (const match of matches) {
    const account = accountOf.get(match.bankTransactionId);
    const base = baseOfNav.get(match.documentId);
    if (!account || !base) continue;
    result.set(base, [
      ...(result.get(base) ?? []),
      { account, evidenceId: match.bankTransactionId },
    ]);
  }
  return result;
}

export async function planSupplierFills(
  database: FillDatabase,
  readers: FillReaders,
): Promise<FillPlan> {
  return planFills(await gatherFillSuppliers(database, readers));
}

/** A WRITE ítéletű szállítók kitöltésének írása: szállítónként egy sor, meglévőt nem ír felül. A létrejött sorok azonosítóit adja (a visszavonáshoz). */
export async function writeFills(
  database: Pick<FillDatabase, "supplierBankAccountFill">,
  plan: FillPlan,
): Promise<{ created: number; ids: string[] }> {
  const data = plan.rows.flatMap(({ supplier, verdict }) =>
    verdict.state === "WRITE"
      ? [
          {
            supplierKey: supplier.key,
            supplierName: supplier.name,
            supplierTaxNumber: supplier.taxNumber,
            supplierEuTaxNumber: supplier.euTaxNumber,
            account: verdict.account,
            source: verdict.source,
            evidenceIds: [...verdict.evidenceIds],
          },
        ]
      : [],
  );
  if (data.length === 0) return { created: 0, ids: [] };
  const { count } = await database.supplierBankAccountFill.createMany({
    data,
    skipDuplicates: true,
  });
  const rows = await database.supplierBankAccountFill.findMany({
    where: { supplierKey: { in: data.map((row) => row.supplierKey) } },
    select: { id: true },
  });
  return { created: count, ids: rows.map((row) => row.id) };
}
