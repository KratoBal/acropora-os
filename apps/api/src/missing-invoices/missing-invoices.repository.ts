import { Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@acropora/database";
import type { SupplierInvoiceImportResult } from "@acropora/types";

import {
  looksLikeBankAccount,
  otherDocumentFileName,
  reminderFileName,
} from "./collection/invoice-text.js";
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
  // az azonosság: a fájl lenyomata (a dokumentumon) és a számlaszám-kulcs
  const identified = (document: CandidateDocument): CandidateDocument => {
    const key = keys.get(document.id);
    const extra = key && !key.startsWith("|") ? [`inv:${key}`] : [];
    return {
      ...document,
      identities: [...new Set([...(document.identities ?? []), ...extra])],
    };
  };
  const merged = [...groups.values()].map((group) => {
    if (group.length === 1) return identified(group[0]!);
    const nav = group.find((d) => d.source === "NAV");
    const original = group.find((d) => d.hasOriginal);
    const primary = nav ?? group[0]!;
    return {
      ...primary,
      aliasIds: group.filter((d) => d !== primary).map((d) => d.id),
      ...(original ? { originalId: original.id } : {}),
      source: original?.source ?? primary.source,
      gross:
        primary.gross ?? group.find((d) => d.gross !== null)?.gross ?? null,
      kind: group.some((d) => d.kind === "INVOICE")
        ? ("INVOICE" as const)
        : primary.kind,
      payee: nav ? ("COMPANY" as const) : primary.payee,
      hasOriginal: group.some((d) => d.hasOriginal),
      ...(group.some((d) => d.cardPaid) ? { cardPaid: true } : {}),
      supplierAccounts: [...new Set(group.flatMap((d) => d.supplierAccounts))],
      identities: [
        ...new Set(group.flatMap((d) => identified(d).identities ?? [])),
      ],
    };
  });
  return [...merged, ...alone.map(identified)];
}

/** A Számlázz.hu fizetési módja kártya: „Bankkártya”, „Kártya”, „Card”. */
export const CARD_METHOD = /k[aá]rty|card/i;

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

  /**
   * A jóváírások: a sztornózott vásárlás visszatérítése ezekből látszik
   * (acrobot 25933), és a kivonatok utolsó napja is ezekkel együtt mérhető.
   */
  credits() {
    return this.database.bankTransaction.findMany({
      where: { direction: "CREDIT" },
      orderBy: [{ bookingDate: "asc" }, { id: "asc" }],
      select: {
        id: true,
        amount: true,
        currency: true,
        bookingDate: true,
        counterpartyName: true,
        narrative: true,
      },
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
        comment: true,
        categoryOverride: true,
        paperOriginalAt: true,
      },
    });
  }

  /** A kézi párosítások: terhelés -> dokumentum-azonosítók. */
  async manualMatches(): Promise<Map<string, string[]>> {
    const rows = await this.database.bankTransactionMatch.findMany({
      select: { bankTransactionId: true, documentId: true },
    });
    const matches = new Map<string, string[]>();
    for (const row of rows)
      matches.set(row.bankTransactionId, [
        ...(matches.get(row.bankTransactionId) ?? []),
        row.documentId,
      ]);
    return matches;
  }

  /**
   * A KEZELŐ DÖNTÉSE, AUDITTAL (brief 12. pont): egy tranzakcióban a döntés és
   * az auditnapló eseménye, benne a régi és az új érték.
   */
  private async decide(
    bankTransactionId: string,
    userId: string,
    action: string,
    metadata: Record<string, unknown>,
    write: (transaction: Prisma.TransactionClient) => Promise<unknown>,
  ) {
    await this.database.$transaction(async (transaction) => {
      await write(transaction);
      await transaction.auditLog.create({
        data: {
          userId,
          action,
          entityType: "BankTransaction",
          entityId: bankTransactionId,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    });
  }

  pair(input: {
    bankTransactionId: string;
    documentId: string;
    documentSource: string;
    userId: string;
  }) {
    return this.decide(
      input.bankTransactionId,
      input.userId,
      "missing-invoices.paired",
      { documentId: input.documentId, documentSource: input.documentSource },
      (transaction) =>
        transaction.bankTransactionMatch.create({
          data: {
            bankTransactionId: input.bankTransactionId,
            documentId: input.documentId,
            documentSource: input.documentSource,
            pairedByUserId: input.userId,
          },
        }),
    );
  }

  unpair(bankTransactionId: string, userId: string, removed: string[]) {
    return this.decide(
      bankTransactionId,
      userId,
      "missing-invoices.unpaired",
      { documentIds: removed },
      (transaction) =>
        transaction.bankTransactionMatch.deleteMany({
          where: { bankTransactionId },
        }),
    );
  }

  annotate(
    bankTransactionId: string,
    userId: string,
    action: string,
    data: Prisma.BankTransactionUpdateInput,
    metadata: Record<string, unknown>,
  ) {
    return this.decide(
      bankTransactionId,
      userId,
      action,
      metadata,
      (transaction) =>
        transaction.bankTransaction.update({
          where: { id: bankTransactionId },
          data,
        }),
    );
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
        // csak az alapszámla: a módosító és a sztornó okirat (jóváíró)
        // párosítása külön, mért döntés lesz (acrobot 25649)
        where: { invoiceIssueDate: range, invoiceOperation: "CREATE" },
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
        // a postafiók olvasott számlái, és MINDEN feltöltés: azt kifejezetten
        // egy terheléshez csatolták, tehát akkor is jelölt, ha nem olvasható
        where: {
          // a Jev JAVASLATA nem jelölt, amíg ember jóvá nem hagyta (acrobot
          // 25803, Balázs keretdöntése: a Jev csak javasol). Az olvasott-ág
          // (READ + kind) nélküle is beengedné, ezért itt, minden ág előtt.
          reviewState: null,
          OR: [
            {
              status: { in: ["READ", "LATE_CORRECTION"] },
              kind: { not: null },
            },
            { origin: "UPLOAD" },
            // a begyűjtés csak azt tárolja, amit illesztő vagy NAV-szám ismer
            { origin: { in: ["COLLECTED_MAIL", "COLLECTED_DRIVE"] } },
            // a Számlázz.hu bejövő számla-továbbítása (acrobot 25686)
            { origin: "SZAMLAZZ_FEED" },
          ],
        },
        select: {
          id: true,
          kind: true,
          importResult: true,
          payeeCheck: true,
          payeeMarkedAt: true,
          origin: true,
          uploadKind: true,
          fileName: true,
          createdAt: true,
          receivedAt: true,
          textReading: true,
          sha256: true,
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

    // A KÁRTYÁVAL FIZETETT SZÁMLÁZZ.HU-SZÁMLÁK (acrobot 26084): a fizetési mód a
    // Számlázás vetítésén áll, a forrás-dokumentumára mutatva
    const feedIds = mailbox
      .filter((d) => d.origin === "SZAMLAZZ_FEED")
      .map((d) => d.id);
    const cardPaidIds = new Set(
      feedIds.length === 0
        ? []
        : (
            await this.database.incomingBillingDocument.findMany({
              where: { sourceDocumentId: { in: feedIds } },
              select: { sourceDocumentId: true, paymentMethod: true },
            })
          )
            .filter((row) => CARD_METHOD.test(row.paymentMethod ?? ""))
            .flatMap((row) => row.sourceDocumentId ?? []),
    );

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
    /*
      A BEGYŰJTÖTT MÁSOLAT KIESIK, HA UGYANEZ A FÁJL MÁS ÚTON IS MEGVAN: az
      info@ fiókot a Várható beérkezések figyelője is olvassa, és a kettő saját
      kulcs-névtérben ír (lásd `invoice-collection.repository.ts`).
    */
    const collected = (origin: string) => origin.startsWith("COLLECTED_");
    const otherContent = new Set(
      mailbox.filter((d) => !collected(d.origin)).map((d) => d.sha256),
    );
    for (const document of mailbox) {
      const result =
        document.importResult as unknown as SupplierInvoiceImportResult | null;
      const upload = document.origin === "UPLOAD";
      const collectedCopy = collected(document.origin);
      if (collectedCopy && otherContent.has(document.sha256)) continue;
      // az általános olvasó eredménye: csak a szám és a szállító adószáma
      const reading = result
        ? null
        : (document.textReading as {
            invoiceNumber: string | null;
            supplierTaxNumber: string | null;
            bankReference?: string | null;
            /** a Számlázz.hu továbbítás ennyit tud még (`szamlazz-feeds.service.ts`) */
            supplierName?: string;
            gross?: string;
            currency?: string;
            cardPayment?: {
              amount: string;
              currency: string;
              partner: string;
              debitIds?: string[];
            } | null;
          } | null);
      // a kártyás fizetéshez illesztett NAV nélküli számla: a fizetés összege,
      // devizája és partnere a bruttó, a pénznem és a szállító (acrobot 25666)
      const card = reading?.cardPayment ?? null;
      const date =
        result?.invoiceDate ??
        (upload
          ? day(document.createdAt)
          : reading
            ? day(document.receivedAt ?? document.createdAt)
            : null);
      if (!date) continue;
      if (!upload && ((!result && !reading) || date < from || date > to))
        continue;
      // a már eltárolt fizetési emlékeztető nem számla (acrobot 25664): az új
      // begyűjtés már nem tárolja, a régieket itt hagyjuk ki
      if (
        !upload &&
        (reminderFileName(document.fileName) ||
          otherDocumentFileName(document.fileName))
      )
        continue;
      const foreign =
        (result?.supplier.country && result.supplier.country !== "HU") ||
        (result?.supplier.vatId && !result.supplier.vatId.startsWith("HU"));
      documents.push({
        id: document.id,
        source:
          document.origin === "COLLECTED_DRIVE"
            ? "DRIVE"
            : document.origin === "SZAMLAZZ_FEED"
              ? "SZAMLAZZ"
              : !upload
                ? "MAILBOX"
                : document.uploadKind === "PREMIUM_NOTICE"
                  ? "PREMIUM_NOTICE"
                  : "UPLOAD",
        number:
          result?.invoiceNumber ??
          reading?.invoiceNumber ??
          (upload ? document.fileName : ""),
        // egy bankszámlaszám (IBAN) nem hivatkozás: minden fizetésben ott áll
        references:
          reading?.bankReference && !looksLikeBankAccount(reading.bankReference)
            ? [reading.bankReference]
            : [],
        date,
        // a Számlázz.hu továbbítás a bruttót is hozza; a postafiók csak nettót
        // olvas ki, ami EU-s (fordítottan adózó) szállítónál a bruttó is; a
        // kártyás vásárlás visszaigazolása a saját összegét hozza
        gross:
          reading?.gross != null
            ? new Prisma.Decimal(reading.gross)
            : foreign && result?.netTotal != null
              ? new Prisma.Decimal(result.netTotal)
              : card
                ? new Prisma.Decimal(card.amount)
                : null,
        currency:
          result?.currency ?? reading?.currency ?? card?.currency ?? "HUF",
        supplierName:
          result?.supplier.name ?? reading?.supplierName ?? card?.partner ?? "",
        supplierAccounts:
          accountsByTaxBase.get(
            taxBase(result?.supplier.vatId ?? reading?.supplierTaxNumber),
          ) ?? [],
        kind:
          document.uploadKind === "PREMIUM_NOTICE"
            ? "PREMIUM_NOTICE"
            : document.kind === "PROFORMA"
              ? "PROFORMA"
              : "INVOICE",
        payee: (document.payeeCheck as Payee | null) ?? "UNKNOWN",
        payeeMarked: document.payeeMarkedAt !== null,
        hasOriginal: true,
        identities: document.sha256 ? [`sha:${document.sha256}`] : [],
        ...(card?.debitIds?.length ? { cardPaymentIds: card.debitIds } : {}),
        ...(cardPaidIds.has(document.id) ? { cardPaid: true } : {}),
      });
      keys.set(
        document.id,
        invoiceKey(
          result?.invoiceNumber ?? reading?.invoiceNumber ?? "",
          result?.supplier.vatId ?? reading?.supplierTaxNumber,
          result?.supplier.name ?? reading?.supplierName ?? "",
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

  /**
   * AZ EREDETI FÁJLOK A KÖNYVELŐI CSOMAGHOZ: a postafiókos és a feltöltött
   * dokumentum, valamint a Foxpost-elszámolás PDF-je. A NAV-sornak és a
   * GLS-számlának nincs tárolt eredetije, azok itt nem is szerepelnek.
   */
  async originals(
    ids: readonly string[],
  ): Promise<Map<string, { fileName: string; content: Uint8Array }>> {
    if (ids.length === 0) return new Map();
    const [documents, settlements] = await Promise.all([
      this.database.incomingSupplierDocument.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, fileName: true, content: true },
      }),
      this.database.foxpostSettlement.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, pdfFileName: true, pdfContent: true },
      }),
    ]);
    return new Map([
      ...documents.map(
        (row) =>
          [row.id, { fileName: row.fileName, content: row.content }] as const,
      ),
      ...settlements.map(
        (row) =>
          [
            row.id,
            { fileName: row.pdfFileName, content: row.pdfContent },
          ] as const,
      ),
    ]);
  }

  /**
   * A DRAWERBŐL FELTÖLTÖTT SZÁMLA (acrobot 25274): a postafiókkal közös táblába
   * kerül, UPLOAD származással és várható beérkezés NÉLKÜL, tehát a bevételezési
   * láncba nem jut. Ugyanabban a tranzakcióban a terheléshez párosul (kézzel),
   * és az auditnapló is megkapja.
   */
  async uploadAndPair(input: {
    bankTransactionId: string;
    fileName: string;
    content: Buffer;
    sha256: string;
    kind: "INVOICE" | "PREMIUM_NOTICE";
    importResult: SupplierInvoiceImportResult | null;
    payee: Payee;
    userId: string;
  }): Promise<string> {
    return this.database.$transaction(async (transaction) => {
      const document = await transaction.incomingSupplierDocument.create({
        data: {
          gmailMessageId: `upload:${input.sha256}:${Date.now()}`,
          fileName: input.fileName,
          sizeBytes: input.content.length,
          sha256: input.sha256,
          content: new Uint8Array(input.content),
          status: input.importResult ? "READ" : "FAILED",
          kind:
            input.importResult?.documentKind === "PROFORMA"
              ? "PROFORMA"
              : "INVOICE",
          importResult: (input.importResult ??
            undefined) as unknown as Prisma.InputJsonValue,
          payeeCheck: input.payee,
          origin: "UPLOAD",
          uploadKind: input.kind,
          uploadedByUserId: input.userId,
        },
        select: { id: true },
      });
      const source =
        input.kind === "PREMIUM_NOTICE" ? "PREMIUM_NOTICE" : "UPLOAD";
      await transaction.bankTransactionMatch.create({
        data: {
          bankTransactionId: input.bankTransactionId,
          documentId: document.id,
          documentSource: source,
          pairedByUserId: input.userId,
        },
      });
      await transaction.auditLog.create({
        data: {
          userId: input.userId,
          action: "missing-invoices.uploaded",
          entityType: "BankTransaction",
          entityId: input.bankTransactionId,
          metadata: {
            documentId: document.id,
            fileName: input.fileName,
            kind: input.kind,
            read: input.importResult !== null,
          } as Prisma.InputJsonValue,
        },
      });
      return document.id;
    });
  }

  /** A még nem ellenőrzött postafiók-dokumentumok bájtjai, a vevő-ellenőrzéshez. */
  uncheckedMailboxContent(ids: readonly string[]) {
    return this.database.incomingSupplierDocument.findMany({
      where: { id: { in: [...ids] }, payeeCheck: null },
      select: { id: true, content: true, fileName: true },
    });
  }

  /**
   * A VEVŐ KÉZI JELÖLÉSE, AUDITTAL (acrobot 25633). Csak az írható, aminek a
   * vevője nem ellenőrizhető (UNKNOWN vagy még nem számolt), vagy amit már
   * kézzel jelöltek; a szövegből olvasott COMPANY vagy NOT_COMPANY nem. A
   * feltétel a frissítés WHERE-jében áll, tehát egy közben beolvasott érték sem
   * íródik felül. Visszaadja, hány sort írt (0: nem jelölhető).
   */
  async markPayee(input: {
    documentIds: readonly string[];
    payee: "COMPANY" | "NOT_COMPANY";
    userId: string;
    bankTransactionId: string;
  }): Promise<number> {
    return this.database.$transaction(async (transaction) => {
      const before = await transaction.incomingSupplierDocument.findMany({
        where: { id: { in: [...input.documentIds] } },
        select: { id: true, payeeCheck: true },
      });
      const { count } = await transaction.incomingSupplierDocument.updateMany({
        where: {
          id: { in: [...input.documentIds] },
          OR: [
            { payeeCheck: null },
            { payeeCheck: "UNKNOWN" },
            { payeeMarkedAt: { not: null } },
          ],
        },
        data: {
          payeeCheck: input.payee,
          payeeMarkedAt: new Date(),
          payeeMarkedByUserId: input.userId,
        },
      });
      if (count > 0)
        await transaction.auditLog.create({
          data: {
            userId: input.userId,
            action: "missing-invoices.payee-marked",
            entityType: "IncomingSupplierDocument",
            entityId: before[0]?.id ?? null,
            metadata: {
              bankTransactionId: input.bankTransactionId,
              documentIds: before.map((row) => row.id),
              from: before.map((row) => row.payeeCheck),
              to: input.payee,
            } as Prisma.InputJsonValue,
          },
        });
      return count;
    });
  }

  setPayee(id: string, payee: Payee) {
    return this.database.incomingSupplierDocument.updateMany({
      where: { id, payeeCheck: null },
      data: { payeeCheck: payee },
    });
  }
}
