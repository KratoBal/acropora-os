import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@acropora/database";
import type { SupplierInvoiceImportResult } from "@acropora/types";

import type { CandidateDocument, Payee } from "./missing-invoice-matching.js";

/**
 * Egy bankszámlaszám összevethető alakja: kötőjel és szóköz nélkül; a hazai
 * IBAN (HU + 2 ellenőrző + 24 számjegy) és a 24 jegyű, 8 nullára végződő alak
 * a 16 jegyűvel azonos. A kivonat és a szállító-törzs mást-mást ír.
 */
export function normalizeAccount(value: string | null | undefined): string {
  let text = (value ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (/^HU\d{26}$/.test(text)) text = text.slice(4);
  if (/^\d{24}$/.test(text) && text.endsWith("00000000"))
    text = text.slice(0, 16);
  return text;
}

const taxBase = (value: string | null | undefined) =>
  (value ?? "").replace(/\D/g, "").slice(0, 8);

const day = (value: Date | null | undefined) =>
  value ? value.toISOString().slice(0, 10) : null;

/** A NAV-kivonat nettó + ÁFA összege; a saját bruttó a számla-adatban van. */
const navGross = (net: Prisma.Decimal | null, vat: Prisma.Decimal | null) =>
  net === null ? null : net.plus(vat ?? 0);

/**
 * A HIÁNYZÓ SZÁMLÁK OLVASÓ OLDALA: a terhelések és a jelölt dokumentumok a
 * négy forrásból (NAV, postafiók, Foxpost, GLS).
 */
@Injectable()
export class MissingInvoicesRepository {
  private readonly database = prisma;

  accounts() {
    return this.database.bankAccount.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, accountNumber: true, currency: true, name: true },
    });
  }

  debits(where: Prisma.BankTransactionWhereInput = {}) {
    return this.database.bankTransaction.findMany({
      where: { direction: "DEBIT", ...where },
      orderBy: [{ bookingDate: "asc" }, { id: "asc" }],
      select: {
        id: true,
        bankAccountId: true,
        amount: true,
        currency: true,
        bookingDate: true,
        counterpartyAccount: true,
        counterpartyName: true,
        narrative: true,
        transactionType: true,
      },
    });
  }

  /** Mely (bankszámla, hónap) párhoz van importált sor: a „Kivonat hiányzik” alapja. */
  async statementCoverage(): Promise<Set<string>> {
    const rows = await this.database.bankTransaction.groupBy({
      by: ["bankAccountId", "bookingDate"],
    });
    return new Set(
      rows.map(
        (row) =>
          `${row.bankAccountId}:${row.bookingDate.toISOString().slice(0, 7)}`,
      ),
    );
  }

  /** A jelöltek egy dátumablakban, mind a négy forrásból. */
  async candidates(from: string, to: string): Promise<CandidateDocument[]> {
    const range = {
      gte: new Date(`${from}T00:00:00Z`),
      lte: new Date(`${to}T00:00:00Z`),
    };
    const [nav, mailbox, foxpost, gls, suppliers] = await Promise.all([
      this.database.navIncomingInvoice.findMany({
        where: { invoiceIssueDate: range },
        select: {
          id: true,
          navInvoiceNumber: true,
          supplierTaxNumber: true,
          supplierName: true,
          invoiceIssueDate: true,
          currency: true,
          invoiceNetAmount: true,
          invoiceVatAmount: true,
          parsedData: true,
        },
      }),
      this.database.incomingSupplierDocument.findMany({
        where: {
          status: { in: ["READ", "LATE_CORRECTION"] },
          kind: { not: null },
        },
        select: {
          id: true,
          kind: true,
          importResult: true,
          payeeCheck: true,
        },
      }),
      this.database.foxpostSettlement.findMany({
        where: { invoiceIssueDate: range },
        select: {
          id: true,
          invoiceNumber: true,
          invoiceIssueDate: true,
          invoiceGrossAmount: true,
          currency: true,
        },
      }),
      this.database.glsInvoice.findMany({
        where: { invoiceDate: range },
        select: {
          id: true,
          invoiceNumber: true,
          invoiceDate: true,
          feeTotal: true,
          currency: true,
        },
      }),
      this.database.supplier.findMany({
        where: { taxNumber: { not: null } },
        select: { taxNumber: true, bankAccountNumber: true, iban: true },
      }),
    ]);

    const accountsByTaxBase = new Map<string, string[]>();
    for (const supplier of suppliers) {
      const base = taxBase(supplier.taxNumber);
      if (!base) continue;
      const accounts = [supplier.bankAccountNumber, supplier.iban]
        .map(normalizeAccount)
        .filter(Boolean);
      accountsByTaxBase.set(base, [
        ...(accountsByTaxBase.get(base) ?? []),
        ...accounts,
      ]);
    }

    const documents: CandidateDocument[] = [];
    for (const invoice of nav) {
      const parsed = invoice.parsedData as {
        supplierBankAccountNumber?: string;
      } | null;
      documents.push({
        id: invoice.id,
        source: "NAV",
        number: invoice.navInvoiceNumber,
        date: day(invoice.invoiceIssueDate)!,
        gross: navGross(invoice.invoiceNetAmount, invoice.invoiceVatAmount),
        currency: invoice.currency,
        supplierName: invoice.supplierName,
        supplierAccounts: [
          ...(accountsByTaxBase.get(taxBase(invoice.supplierTaxNumber)) ?? []),
          normalizeAccount(parsed?.supplierBankAccountNumber),
        ].filter(Boolean),
        kind: "INVOICE",
        // a NAV bejövő lekérdezés a vevő adószámára szűr: definíció szerint a Kft-é
        payee: "COMPANY",
      });
    }
    for (const document of mailbox) {
      const result =
        document.importResult as unknown as SupplierInvoiceImportResult | null;
      const date = result?.invoiceDate;
      if (!result || !date || date < from || date > to) continue;
      const foreign =
        (result.supplier.country && result.supplier.country !== "HU") ||
        (result.supplier.vatId && !result.supplier.vatId.startsWith("HU"));
      documents.push({
        id: document.id,
        source: "MAILBOX",
        number: result.invoiceNumber ?? "",
        date,
        // a postafiók csak nettót olvas ki; EU-s (fordítottan adózó) szállítónál
        // ez a bruttó is, hazainál ismeretlen
        gross:
          foreign && result.netTotal !== null
            ? new Prisma.Decimal(result.netTotal)
            : null,
        currency: result.currency ?? "HUF",
        supplierName: result.supplier.name ?? "",
        supplierAccounts:
          accountsByTaxBase.get(taxBase(result.supplier.vatId)) ?? [],
        kind: document.kind === "PROFORMA" ? "PROFORMA" : "INVOICE",
        payee: (document.payeeCheck as Payee | null) ?? "UNKNOWN",
      });
    }
    for (const settlement of foxpost)
      documents.push({
        id: settlement.id,
        source: "SETTLEMENT",
        number: settlement.invoiceNumber ?? "",
        date: day(settlement.invoiceIssueDate)!,
        gross: settlement.invoiceGrossAmount,
        currency: settlement.currency,
        supplierName: "Foxpost",
        supplierAccounts: [],
        kind: "INVOICE",
        payee: "COMPANY",
      });
    for (const invoice of gls)
      documents.push({
        id: invoice.id,
        source: "SETTLEMENT",
        number: invoice.invoiceNumber,
        date: day(invoice.invoiceDate)!,
        gross: invoice.feeTotal,
        currency: invoice.currency,
        supplierName: "GLS",
        supplierAccounts: [],
        kind: "INVOICE",
        payee: "COMPANY",
      });
    return documents;
  }

  /** A még nem ellenőrzött postafiók-dokumentumok bájtjai, a vevő-ellenőrzéshez. */
  uncheckedMailboxContent(ids: readonly string[]) {
    return this.database.incomingSupplierDocument.findMany({
      where: { id: { in: [...ids] }, payeeCheck: null },
      select: { id: true, content: true, fileName: true },
    });
  }

  setPayee(id: string, payee: Payee) {
    return this.database.incomingSupplierDocument.updateMany({
      where: { id, payeeCheck: null },
      data: { payeeCheck: payee },
    });
  }
}
