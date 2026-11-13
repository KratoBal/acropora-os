import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";

export interface CollectionItemRow {
  id: string;
  source: string;
  externalId: string;
  fileName: string;
  verdict: string;
  documentId: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface CollectionRunRecord {
  id: string;
  status: string;
  trigger: string;
  startedAt: Date;
  completedAt: Date | null;
  rulesVersion: string | null;
  errorCode: string | null;
  filesSeen: number;
  storedCount: number;
  notInvoiceCount: number;
  unmatchedCount: number;
  ownInvoiceCount: number;
  suggestedCount: number;
  duplicateCount: number;
  failedCount: number;
}

/**
 * A GYŰJTŐ ÍTÉLET-SORAINAK OLVASÁSA (acrobot 35522, J55388). Csak olvas, és a
 * fájl tartalmát soha: az `InvoiceCollectionItem` sora a forrás, a fájlnév, az
 * ítélet és a tárolt dokumentum azonosítója.
 */
@Injectable()
export class InvoiceCollectionItemsRepository {
  private readonly database = prisma;

  list(
    filter: { verdict?: string; source?: string },
    take: number,
  ): Promise<CollectionItemRow[]> {
    return this.database.invoiceCollectionItem.findMany({
      where: {
        ...(filter.verdict ? { verdict: filter.verdict } : {}),
        ...(filter.source ? { source: filter.source } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      select: {
        id: true,
        source: true,
        externalId: true,
        fileName: true,
        verdict: true,
        documentId: true,
        reason: true,
        createdAt: true,
      },
    });
  }

  /** A legutóbbi futások, a legújabb elöl. */
  runs(take: number): Promise<CollectionRunRecord[]> {
    return this.database.invoiceCollectionRun.findMany({
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take,
      select: {
        id: true,
        status: true,
        trigger: true,
        startedAt: true,
        completedAt: true,
        rulesVersion: true,
        errorCode: true,
        filesSeen: true,
        storedCount: true,
        notInvoiceCount: true,
        unmatchedCount: true,
        ownInvoiceCount: true,
        suggestedCount: true,
        duplicateCount: true,
        failedCount: true,
      },
    });
  }

  /** Ítéletenként a darabszám, a megadott forrásra (a verdikt-szűrő nélkül). */
  async counts(
    source?: string,
  ): Promise<Array<{ verdict: string; count: number }>> {
    const groups = await this.database.invoiceCollectionItem.groupBy({
      by: ["verdict"],
      where: source ? { source } : {},
      _count: { _all: true },
    });
    return groups.map((group) => ({
      verdict: group.verdict,
      count: group._count._all,
    }));
  }
}
