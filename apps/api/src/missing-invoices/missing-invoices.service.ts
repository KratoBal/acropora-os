import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@acropora/database";
import {
  ACROPORA_COMPANY,
  type MissingInvoiceItem,
  type MissingInvoiceMonth,
  type MissingInvoiceMonthDetail,
  type MissingInvoiceMonthQuery,
  type MissingInvoiceMonthsResponse,
  type MissingInvoiceMonthStatus,
} from "@acropora/types";

import { pdfTextLines } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import {
  classifyTransaction,
  payrollNamesOf,
} from "./bank-transaction.classify.js";
import {
  matchMonth,
  type ItemState,
  type MatchOutcome,
} from "./missing-invoice-matching.js";
import {
  MissingInvoicesRepository,
  normalizeAccount,
} from "./missing-invoices.repository.js";
import { originalAmountOf } from "./otp-statement.parser.js";
import { payeeFromText } from "./payee-check.js";

/** A „Hiányzik” fül és a Hiányos hónap: minden, amihez teendő van. */
const MISSING_STATES: ReadonlySet<ItemState> = new Set([
  "ORIGINAL_MISSING",
  "NOT_MATCHED",
  "NO_INVOICE",
  "NOT_COMPANY",
  "PROFORMA_ONLY",
]);
const NO_INVOICE_TILE: ReadonlySet<ItemState> = new Set([
  "NO_INVOICE",
  "NOT_COMPANY",
  "PROFORMA_ONLY",
]);

/** A tétel-lista lapmérete, ha a kérés nem ad (szerződés: 1..100, 25). */
const DEFAULT_PAGE_SIZE = 25;

const monthOf = (date: Date) => date.toISOString().slice(0, 7);

function shiftMonth(month: string, by: number): string {
  const total =
    Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

interface Computed {
  items: (MissingInvoiceItem & { month: string; accountId: string })[];
  months: string[];
  accounts: {
    id: string;
    name: string;
    accountNumber: string;
    currency: string;
  }[];
  coverage: Set<string>;
}

/**
 * HIÁNYZÓ SZÁMLÁK: a hónapok és egy hónap tételei (brief 5-9. pont). Minden
 * állapot SZÁMOLT érték a kivonatból, a jelöltekből és a kézi döntésekből,
 * nem tárolt: így a számlálók egy kézi párosítás után maguktól frissülnek
 * (brief 19/8).
 *
 * A PÁROSÍTÁS AZ ÖSSZES HÓNAPRA EGYBEN FUT, időrendben: csak így igaz, hogy egy
 * számlát egy terhelés visz, hónapokon át is.
 */
@Injectable()
export class MissingInvoicesService {
  private readonly logger = new Logger(MissingInvoicesService.name);

  constructor(private readonly repository: MissingInvoicesRepository) {}

  async months(): Promise<MissingInvoiceMonthsResponse> {
    const computed = await this.compute();
    const months: MissingInvoiceMonth[] = computed.months
      .map((month) => {
        const items = computed.items.filter((item) => item.month === month);
        const count = (states: ReadonlySet<ItemState> | ItemState) =>
          items.filter((item) =>
            typeof states === "string"
              ? item.state === states
              : states.has(item.state),
          ).length;
        const missingAccounts = this.missingStatementAccounts(computed, month);
        return {
          month,
          debitCount: items.filter((i) => i.state !== "NO_INVOICE_NEEDED")
            .length,
          found: count("FOUND"),
          originalMissing: count("ORIGINAL_MISSING"),
          notMatched: count("NOT_MATCHED"),
          noInvoice: count(NO_INVOICE_TILE),
          noInvoiceNeeded: count("NO_INVOICE_NEEDED"),
          missingAmountHuf: items
            .filter(
              (i) =>
                MISSING_STATES.has(i.state) &&
                i.state !== "ORIGINAL_MISSING" &&
                i.currency === "HUF",
            )
            .reduce((sum, i) => sum.plus(i.amount), new Prisma.Decimal(0))
            .toFixed(0),
          status: statusOf(
            missingAccounts.length,
            computed.accounts.length,
            count(MISSING_STATES),
          ),
          missingStatementAccounts: missingAccounts,
        };
      })
      .reverse();
    return {
      company: {
        name: ACROPORA_COMPANY.name,
        taxNumber: ACROPORA_COMPANY.taxNumberBase,
      },
      months,
    };
  }

  async month(
    month: string,
    query: MissingInvoiceMonthQuery,
  ): Promise<MissingInvoiceMonthDetail> {
    const computed = await this.compute();
    const all = computed.items.filter((item) => item.month === month);
    const q = query.q?.trim().toLowerCase();
    const tab = query.tab ?? "MISSING";
    const filtered = all.filter(
      (item) =>
        (tab === "ALL" ||
          (tab === "MISSING" && MISSING_STATES.has(item.state)) ||
          (tab === "NOT_MATCHED" && item.state === "NOT_MATCHED") ||
          (tab === "FOUND" && item.state === "FOUND") ||
          (tab === "NO_INVOICE_NEEDED" &&
            item.state === "NO_INVOICE_NEEDED")) &&
        (!query.category || item.category === query.category) &&
        (!query.accountId || item.accountId === query.accountId) &&
        (!q ||
          [
            item.partner ?? "",
            item.narrative,
            item.amount,
            item.original?.amount ?? "",
          ]
            .join(" ")
            .toLowerCase()
            .includes(q)),
    );
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const missingAccounts = this.missingStatementAccounts(computed, month);
    const count = (predicate: (state: ItemState) => boolean) =>
      all.filter((item) => predicate(item.state)).length;
    return {
      month,
      status: statusOf(
        missingAccounts.length,
        computed.accounts.length,
        count((s) => MISSING_STATES.has(s)),
      ),
      accounts: computed.accounts.map((account) => ({
        ...account,
        hasStatement: computed.coverage.has(`${account.id}:${month}`),
      })),
      tiles: {
        found: count((s) => s === "FOUND"),
        originalMissing: count((s) => s === "ORIGINAL_MISSING"),
        notMatched: count((s) => s === "NOT_MATCHED"),
        noInvoice: count((s) => NO_INVOICE_TILE.has(s)),
        noInvoiceNeeded: count((s) => s === "NO_INVOICE_NEEDED"),
      },
      items: filtered
        .slice((page - 1) * pageSize, page * pageSize)
        .map(({ month: _month, accountId: _accountId, ...item }) => item),
      pagination: {
        page,
        pageSize,
        totalItems: filtered.length,
        totalPages: Math.ceil(filtered.length / pageSize),
      },
    };
  }

  private missingStatementAccounts(
    computed: Computed,
    month: string,
  ): string[] {
    return computed.accounts
      .filter((account) => !computed.coverage.has(`${account.id}:${month}`))
      .map((account) => account.name);
  }

  private async compute(): Promise<Computed> {
    const [accountRows, debits, coverage] = await Promise.all([
      this.repository.accounts(),
      this.repository.debits(),
      this.repository.statementCoverage(),
    ]);
    const accounts = accountRows.map((account) => ({
      id: account.id,
      name: account.name ?? `${account.accountNumber} (${account.currency})`,
      accountNumber: account.accountNumber,
      currency: account.currency,
    }));
    if (debits.length === 0)
      return { items: [], months: [], accounts, coverage };

    const first = monthOf(debits[0]!.bookingDate);
    const last = monthOf(debits[debits.length - 1]!.bookingDate);
    const months: string[] = [];
    for (let m = first; m <= last; m = shiftMonth(m, 1)) months.push(m);

    const documents = await this.repository.candidates(
      `${shiftMonth(first, -4)}-01`,
      `${shiftMonth(last, 1)}-15`,
    );
    await this.checkPayees(
      documents.filter((d) => d.source === "MAILBOX" && d.payee === "UNKNOWN"),
    );

    const ownAccounts = new Set(
      accountRows.map((a) => normalizeAccount(a.accountNumber)),
    );
    const payrollNames = payrollNamesOf(debits);
    const classified = debits.map((debit) => ({
      debit,
      classification: classifyTransaction(debit, { ownAccounts, payrollNames }),
      original: originalAmountOf(debit.narrative),
    }));
    const outcomes = matchMonth({
      debits: classified.map(({ debit, classification, original }) => ({
        id: debit.id,
        bookingDate: debit.bookingDate.toISOString().slice(0, 10),
        amount: debit.amount,
        currency: debit.currency,
        original,
        counterpartyName: debit.counterpartyName,
        counterpartyAccount: normalizeAccount(debit.counterpartyAccount),
        narrative: debit.narrative,
        category: classification.category,
      })),
      documents,
      manual: new Map(),
    });

    const accountName = new Map(accounts.map((a) => [a.id, a.name]));
    const items = classified.map(({ debit, classification, original }) => {
      const outcome = outcomes.get(debit.id) as MatchOutcome;
      const document = outcome.documents[0] ?? null;
      return {
        month: monthOf(debit.bookingDate),
        accountId: debit.bankAccountId,
        id: debit.id,
        bookingDate: debit.bookingDate.toISOString().slice(0, 10),
        account: {
          id: debit.bankAccountId,
          name: accountName.get(debit.bankAccountId) ?? "",
        },
        partner: debit.counterpartyName,
        narrative: debit.narrative,
        amount: debit.amount.toFixed(debit.currency === "HUF" ? 0 : 2),
        currency: debit.currency,
        original: original
          ? { amount: original.amount.toFixed(2), currency: original.currency }
          : null,
        category: classification.category,
        categoryRule: classification.rule,
        categoryOverridden: false,
        state: outcome.state,
        document: document
          ? {
              id: document.id,
              number: document.number,
              source: document.source,
            }
          : null,
        matchedBy: outcome.matchedBy,
        comment: null,
      };
    });
    return { items, months, accounts, coverage };
  }

  /**
   * A postafiók-számla vevőjének ellenőrzése, egyszer: a szövegéből, és az
   * eredmény tárolódik. A PDF olvasása drága, ezért nem minden kérésnél.
   */
  private async checkPayees(documents: { id: string; payee: string }[]) {
    if (documents.length === 0) return;
    const rows = await this.repository.uncheckedMailboxContent(
      documents.map((d) => d.id),
    );
    for (const row of rows) {
      let text = "";
      try {
        text = row.fileName.toLowerCase().endsWith(".pdf")
          ? (await pdfTextLines(row.content)).join("\n")
          : new TextDecoder("utf-8").decode(row.content);
      } catch {
        this.logger.warn(`A(z) ${row.id} dokumentum szövege nem olvasható.`);
      }
      const payee = payeeFromText(text);
      await this.repository.setPayee(row.id, payee);
      const document = documents.find((d) => d.id === row.id);
      if (document) document.payee = payee;
    }
  }
}

function statusOf(
  missingStatementCount: number,
  accountCount: number,
  missingItems: number,
): MissingInvoiceMonthStatus {
  if (accountCount > 0 && missingStatementCount === accountCount)
    return "STATEMENT_MISSING";
  if (missingStatementCount > 0) return "STATEMENT_PARTIAL";
  return missingItems > 0 ? "INCOMPLETE" : "READY";
}
