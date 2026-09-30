import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma, prisma, type SyncRunTrigger } from "@acropora/database";

import type { InvoiceCollectionSource } from "./invoice-collection.config.js";

const ACTIVE_KEY = "ACTIVE";
/** Egy futás, ami ennyi ideje nem frissült, elakadt: a következő átveszi. */
const STALE_RUN_AFTER_MS = 2 * 60 * 60 * 1000;

export type InvoiceCollectionVerdict =
  | "STORED"
  | "NOT_INVOICE"
  | "UNMATCHED"
  | "OWN_INVOICE"
  | "DUPLICATE"
  | "TOO_LARGE"
  | "UNREADABLE";

export interface InvoiceCollectionCounts {
  filesSeen: number;
  storedCount: number;
  notInvoiceCount: number;
  /** Számlának látszik, de sem illesztő, sem NAV-sor nem ismeri: nem tárolódik. */
  unmatchedCount: number;
  /** A saját kimenő számlánk másolata (a bankszámlánk áll benne): nem tárolódik. */
  ownInvoiceCount: number;
  duplicateCount: number;
  failedCount: number;
}

export interface CollectedDocumentInput {
  source: InvoiceCollectionSource;
  externalId: string;
  fileName: string;
  sender: string | null;
  subject: string | null;
  receivedAt: Date | null;
  content: Buffer;
  sha256: string;
  read: boolean;
  kind: "INVOICE" | "PROFORMA" | null;
  importResult: unknown;
  textReading: unknown;
  payee: string;
}

/**
 * A SZÁMLA-BEGYŰJTÉS ADATBÁZIS-OLDALA.
 *
 * A dokumentum a postafiókkal közös táblába kerül, de SAJÁT kulcs-névtérben:
 * a `gmailMessageId` itt `collect:<forrás>:<azonosító>`. A tábla egyedi kulcsa
 * `(gmailMessageId, fileName)`, és az info@ fiókot a Várható beérkezések
 * figyelője is olvassa: ha a begyűjtő a levél saját azonosítójával érne oda
 * előbb, a figyelő beszúrása elhasalna, és a bevételezésből kimaradna a
 * számla. Várható beérkezést a begyűjtött dokumentum SOHA nem kap.
 */
@Injectable()
export class InvoiceCollectionRepository {
  private readonly database = prisma;

  /**
   * A forrás már látott levelei vagy Drive-fájljai. Levélnél a fájlnevek csak a
   * letöltés után ismertek, ezért a levél egészben számít látottnak: amit
   * egyszer végigolvastunk, azt a következő futás nem tölti le újra.
   */
  async seen(
    source: InvoiceCollectionSource,
    externalIds: readonly string[],
  ): Promise<Set<string>> {
    if (externalIds.length === 0) return new Set();
    const rows = await this.database.invoiceCollectionItem.findMany({
      where: { source, externalId: { in: [...externalIds] } },
      select: { externalId: true },
    });
    return new Set(rows.map((row) => row.externalId));
  }

  /**
   * A szállító NAV-ban ismert számlaszámai, az adószám-törzs szerint. Az
   * általános olvasó ezek közül keresi, melyik áll a PDF szövegében.
   */
  async navNumbers(supplierTaxBase: string): Promise<string[]> {
    if (!/^\d{8}$/.test(supplierTaxBase)) return [];
    const rows = await this.database.navIncomingInvoice.findMany({
      where: { supplierTaxNumber: { startsWith: supplierTaxBase } },
      select: { navInvoiceNumber: true },
    });
    return rows.map((row) => row.navInvoiceNumber);
  }

  /** A saját bankszámláink számjegyei; egy PDF-ben ezek a kiállító jelei. */
  async ownAccounts(): Promise<string[]> {
    const rows = await this.database.bankAccount.findMany({
      select: { accountNumber: true },
    });
    return rows
      .map((row) => row.accountNumber.replace(/\D/g, ""))
      .filter((digits) => digits.length >= 16);
  }

  /** Van-e már ilyen tartalmú dokumentum, bármilyen úton érkezett. */
  async hasContent(sha256: string): Promise<boolean> {
    return (
      (await this.database.incomingSupplierDocument.count({
        where: { sha256 },
      })) > 0
    );
  }

  async record(
    source: InvoiceCollectionSource,
    externalId: string,
    fileName: string,
    verdict: Exclude<InvoiceCollectionVerdict, "STORED">,
    sha256: string | null,
  ): Promise<void> {
    await this.database.invoiceCollectionItem.upsert({
      where: {
        source_externalId_fileName: { source, externalId, fileName },
      },
      create: { source, externalId, fileName, verdict, sha256 },
      update: { verdict, sha256 },
    });
  }

  /** A dokumentum és a látott-sor EGY tranzakcióban: félig tárolt fájl nincs. */
  async store(input: CollectedDocumentInput): Promise<string> {
    return this.database.$transaction(async (transaction) => {
      const document = await transaction.incomingSupplierDocument.create({
        data: {
          gmailMessageId: `collect:${input.source}:${input.externalId}`,
          fileName: input.fileName,
          sender: input.sender,
          subject: input.subject,
          receivedAt: input.receivedAt,
          sizeBytes: input.content.length,
          sha256: input.sha256,
          content: new Uint8Array(input.content),
          status: input.read ? "READ" : "FAILED",
          kind: input.kind,
          importResult:
            input.importResult === null
              ? Prisma.DbNull
              : (input.importResult as Prisma.InputJsonValue),
          textReading:
            input.textReading === null
              ? Prisma.DbNull
              : (input.textReading as Prisma.InputJsonValue),
          payeeCheck: input.payee,
          origin:
            input.source === "DRIVE" ? "COLLECTED_DRIVE" : "COLLECTED_MAIL",
        },
        select: { id: true },
      });
      await transaction.invoiceCollectionItem.create({
        data: {
          source: input.source,
          externalId: input.externalId,
          fileName: input.fileName,
          verdict: "STORED",
          sha256: input.sha256,
          documentId: document.id,
        },
      });
      return document.id;
    });
  }

  async startRun(trigger: SyncRunTrigger): Promise<string> {
    try {
      return await this.database.$transaction(async (transaction) => {
        await transaction.invoiceCollectionRun.updateMany({
          where: {
            activeKey: ACTIVE_KEY,
            status: "RUNNING",
            updatedAt: { lt: new Date(Date.now() - STALE_RUN_AFTER_MS) },
          },
          data: {
            activeKey: null,
            status: "FAILED",
            completedAt: new Date(),
            errorCode: "INVOICE_COLLECTION_STALE",
          },
        });
        const run = await transaction.invoiceCollectionRun.create({
          data: { activeKey: ACTIVE_KEY, status: "RUNNING", trigger },
          select: { id: true },
        });
        return run.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("INVOICE_COLLECTION_ALREADY_RUNNING");
      throw error;
    }
  }

  async finishRun(
    id: string,
    counts: InvoiceCollectionCounts,
    errorCode: string | null,
  ): Promise<void> {
    await this.database.invoiceCollectionRun.update({
      where: { id },
      data: {
        ...counts,
        status: errorCode ? "FAILED" : "APPLIED",
        activeKey: null,
        completedAt: new Date(),
        errorCode,
      },
    });
  }
}
