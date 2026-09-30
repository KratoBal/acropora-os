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
 * AZ ELSZÁMOLÓ PARTNEREK ADÓSZÁMA, hogy az elszámolás-sor a NAV-sorral egy
 * számlává vonódjon össze. Mérve 2026-09-30 a NAV bejövő exportján (Foxpost
 * 40 sor, GLS 18 sor) és egy augusztusi GLS e-számla XML-jén.
 */
const FOXPOST_TAX_BASE = "32435119";
const GLS_TAX_BASE = "12369410";

/** Egy számla azonossága: a száma, és a szállító adószám-törzse, vagy a neve. */
function invoiceKey(
  number: string,
  taxNumber: string | null | undefined,
  supplierName: string,
): string {
  const who = taxBase(taxNumber) || supplierName.trim().toLowerCase();
  return `${number.replace(/\s/g, "").toLowerCase()}|${who}`;
}

/**
 * UGYANAZ A SZÁMLA TÖBB FORRÁSBÓL EGY JELÖLT (acrobot 25322). A NAV-sor az
 * azonosság és az összeg, a postafiók PDF-je az eredeti. Összevonás nélkül egy
 * számla két terhelést is vihetne: egyszer NAV-sorként, egyszer PDF-ként.
 *
 * A NAV adja a bruttót és a vevőt (definíció szerint a Kft), az eredeti a
 * forrást, amit a felület mutat. Szám nélküli dokumentum nem vonható össze.
 */
export function mergeSameInvoice(
  documents: readonly CandidateDocument[],
  keys: ReadonlyMap<string, string>,
): CandidateDocument[] {
  const groups = new Map<string, CandidateDocument[]>();
  const alone: CandidateDocument[] = [];
  for (const document of documents) {
    const key = keys.get(document.id);
    if (!key || key.startsWith("|")) {
      alone.push(document);
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), document]);
  }
  const merged = [...groups.values()].map((group) => {
    if (group.length === 1) return group[0]!;
    const nav = group.find((d) => d.source === "NAV");
    const original = group.find((d) => d.hasOriginal);
    const primary = nav ?? group[0]!;
    return {
      ...primary,
      source: original?.source ?? primary.source,
      gross:
        primary.gross ?? group.find((d) => d.gross !== null)?.gross ?? null,
      kind: group.some((d) => d.kind === "INVOICE")
        ? ("INVOICE" as const)
        : primary.kind,
      payee: nav ? ("COMPANY" as const) : primary.payee,
      hasOriginal: group.some((d) => d.hasOriginal),
      supplierAccounts: [...new Set(group.flatMap((d) => d.supplierAccounts))],
    };
  });
  return [...merged, ...alone];
}

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
    const keys = new Map<string, string>();
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
        // a NAV-adatsor nem eredeti számla (acrobot 25322)
        hasOriginal: false,
      });
      keys.set(
        invoice.id,
        invoiceKey(
          invoice.navInvoiceNumber,
          invoice.supplierTaxNumber,
          invoice.supplierName,
        ),
      );
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
        hasOriginal: true,
      });
      keys.set(
        document.id,
        invoiceKey(
          result.invoiceNumber ?? "",
          result.supplier.vatId,
          result.supplier.name ?? "",
        ),
      );
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
        // az elszámolás PDF-je maga a számla, és tárolva van
        hasOriginal: true,
      });
    for (const settlement of foxpost)
      keys.set(
        settlement.id,
        invoiceKey(settlement.invoiceNumber ?? "", FOXPOST_TAX_BASE, "Foxpost"),
      );
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
        // NEM EREDETI, mérve egy augusztusi „GLS - Számla és Számlamelléklet”
        // levélen: a számla maga az InvoiceDocument_*.xml (APEH e-számla, a mi
        // adószámunkkal), a tárolt xlsx a részletezése. Az XML-t ma nem
        // tároljuk, tehát a GLS-sor a NAV-on át párosodik, eredeti nélkül.
        hasOriginal: false,
      });
    for (const invoice of gls)
      keys.set(
        invoice.id,
        invoiceKey(invoice.invoiceNumber, GLS_TAX_BASE, "GLS"),
      );
    return mergeSameInvoice(documents, keys);
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
