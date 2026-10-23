import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";

export interface CollectionItemRow {
  id: string;
  source: string;
  externalId: string;
  fileName: string;
  verdict: string;
  documentId: string | null;
  createdAt: Date;
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
        createdAt: true,
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
