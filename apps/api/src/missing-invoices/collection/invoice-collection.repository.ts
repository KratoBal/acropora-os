import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma, prisma, type SyncRunTrigger } from "@acropora/database";

import {
  type InvoiceCollectionSource,
  unmatchedRetryDue,
} from "./invoice-collection.config.js";

const ACTIVE_KEY = "ACTIVE";
/** Egy futás, ami ennyi ideje nem frissült, elakadt: a következő átveszi. */
const STALE_RUN_AFTER_MS = 2 * 60 * 60 * 1000;

export type InvoiceCollectionVerdict =
  | "STORED"
  | "NOT_INVOICE"
  | "UNMATCHED"
  | "DUPLICATE"
  | "TOO_LARGE"
  | "UNREADABLE";

export interface InvoiceCollectionCounts {
  filesSeen: number;
  storedCount: number;
  notInvoiceCount: number;
  /** Számlának látszik, de sem illesztő, sem NAV-sor nem ismeri: nem tárolódik. */
  unmatchedCount: number;
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
   *
   * KIVÉVE, HA VAN UNMATCHED TÉTELE (Balázs éles próbája, 2026-10-01). Az
   * UNMATCHED nem végleges: a számla gyakran a fizetés ELŐTT érkezik, a
   * kivonat havonta töltődik be, tehát a begyűjtéskor a közlemény még nincs
   * meg; egy javított párosító szabály is csak így ér el egy korábbi levelet.
   * Az ilyen levél újra jön, de csak ha `retryUnmatched` (lásd
   * `unmatchedRetryDue`); a többi ítélet (STORED, NOT_INVOICE, DUPLICATE,
   * TOO_LARGE, UNREADABLE) végleges marad. A begyűjtés ablaka (a napok száma)
   * határolja, mennyi jön újra.
   */
  async seen(
    source: InvoiceCollectionSource,
    externalIds: readonly string[],
    retryUnmatched: boolean,
  ): Promise<Set<string>> {
    if (externalIds.length === 0) return new Set();
    const rows = await this.database.invoiceCollectionItem.findMany({
      where: { source, externalId: { in: [...externalIds] } },
      select: { externalId: true, verdict: true },
    });
    const retry = new Set(
      rows
        .filter((row) => retryUnmatched && row.verdict === "UNMATCHED")
        .map((row) => row.externalId),
    );
    return new Set(
      rows.map((row) => row.externalId).filter((id) => !retry.has(id)),
    );
  }

  /**
   * Kell-e most újraolvasni az UNMATCHED leveleket (acrobot 25605: óránként
   * mind a ~90-et letöltötte újra, és ez is a Gmail kvótáját ette). Egy
   * UNMATCHED ítélet csak két dologtól változhat: új banki terheléstől (a
   * közlemény köti a külföldi számlát) vagy javított szabálytól. Ezért:
   * naponta egyszer, és ha az utolsó TELJES futás óta új terhelés jött.
   */
  async unmatchedRetryDue(now: Date): Promise<boolean> {
    const last = await this.database.invoiceCollectionRun.findFirst({
      where: { status: "APPLIED", errorCode: null },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    });
    const newDebits = last
      ? await this.database.bankTransaction.count({
          where: { direction: "DEBIT", createdAt: { gt: last.startedAt } },
        })
      : 0;
    return unmatchedRetryDue(last?.startedAt ?? null, newDebits, now);
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

  /**
   * A terhelések közleményei: a NAV-ban nem szereplő (külföldi) számlát ez
   * köti a fizetéshez. Csak terhelés: a jóváírások közleményében a SAJÁT kimenő
   * számláink száma áll, és azok másolatát nem tároljuk.
   */
  async debitNarratives(): Promise<string[]> {
    const rows = await this.database.bankTransaction.findMany({
      where: { direction: "DEBIT" },
      select: { narrative: true },
    });
    return rows.map((row) => row.narrative);
  }

  /** Van-e már ilyen tartalmú dokumentum, bármilyen úton érkezett. */
  async hasContent(sha256: string): Promise<boolean> {
    return (
      (await this.database.incomingSupplierDocument.count({
        where: { sha256 },
      })) > 0
    );
  }

  /**
   * Egy fájl ítélete. Egy újraolvasott levélben (lásd `seen`) a már TÁROLT
   * társ-melléklet DUPLICATE-nek olvasódik (a tartalma megvan); a STORED sort
   * ez nem írja felül, mert az a tárolt dokumentumra mutat.
   */
  async record(
    source: InvoiceCollectionSource,
    externalId: string,
    fileName: string,
    verdict: Exclude<InvoiceCollectionVerdict, "STORED">,
    sha256: string | null,
  ): Promise<void> {
    const key = { source, externalId, fileName };
    const existing = await this.database.invoiceCollectionItem.findUnique({
      where: { source_externalId_fileName: key },
      select: { verdict: true },
    });
    if (existing?.verdict === "STORED") return;
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
      // UPSERT: egy korábban UNMATCHED fájl újraolvasva ugyanazt a kulcsot kapja
      // (forrás, azonosító, fájlnév); a sora most STORED lesz, a dokumentumra mutat.
      await transaction.invoiceCollectionItem.upsert({
        where: {
          source_externalId_fileName: {
            source: input.source,
            externalId: input.externalId,
            fileName: input.fileName,
          },
        },
        create: {
          source: input.source,
          externalId: input.externalId,
          fileName: input.fileName,
          verdict: "STORED",
          sha256: input.sha256,
          documentId: document.id,
        },
        update: {
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

  /**
   * `failed`: egy forrás valódi hibával állt meg. Egy rate limit miatt megállt
   * forrás nem az: a futás APPLIED, a kódja a `errorCode`-ban látszik, és mivel
   * nem teljes, a következő futás az UNMATCHED újraolvasásnál nem számol vele.
   */
  async finishRun(
    id: string,
    counts: InvoiceCollectionCounts,
    errorCode: string | null,
    failed: boolean,
  ): Promise<void> {
    await this.database.invoiceCollectionRun.update({
      where: { id },
      data: {
        ...counts,
        status: failed ? "FAILED" : "APPLIED",
        activeKey: null,
        completedAt: new Date(),
        errorCode,
      },
    });
  }
}
