import { Injectable } from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";
import {
  MORTALITY_LIST_PAGE_SIZE,
  type MortalityAquariumOption,
  type MortalityDetail,
  type MortalityListItem,
  type MortalityListQuery,
  type MortalityListResponse,
  type MortalityPhoto,
  type MortalityProductOption,
  type MortalityRecorderOption,
  type MortalitySourceType,
  type MortalitySummary,
  type MortalitySupplierOption,
} from "@acropora/types";

import { withUniqueCode } from "../common/unique-code.util.js";
import {
  budapestDayKey,
  startOfBudapestDay,
} from "../dashboard/budapest-day.js";
import { liveAnimalSubtreeIds } from "../integrations/medusa/medusa-livestock.policy.js";
import { mortalityChanges } from "./mortality.policy.js";

/** Az auditnapló sorának neve. */
export const MORTALITY_UPDATED_ACTION = "mortality.updated";

const OPTION_LIMIT = 20;

const LIST_SELECT = {
  id: true,
  recordNumber: true,
  quantity: true,
  sourceType: true,
  sourceNote: true,
  recordedAt: true,
  product: {
    select: {
      id: true,
      name: true,
      datasheet: { select: { magyarNev: true } },
    },
  },
  aquarium: { select: { id: true, name: true, aquariumNumber: true } },
  supplier: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, displayName: true } },
  _count: { select: { documents: true } },
} satisfies Prisma.MortalityRecordSelect;

type ListRow = Prisma.MortalityRecordGetPayload<{ select: typeof LIST_SELECT }>;

function toListItem(row: ListRow): MortalityListItem {
  return {
    id: row.id,
    recordNumber: row.recordNumber,
    product: {
      id: row.product.id,
      name: row.product.name,
      commonName: row.product.datasheet?.magyarNev?.trim() || null,
    },
    quantity: row.quantity,
    aquarium: row.aquarium,
    source: {
      type: row.sourceType,
      supplier: row.supplier,
      note: row.sourceNote,
    },
    recordedBy: { id: row.recordedBy.id, name: row.recordedBy.displayName },
    recordedAt: row.recordedAt.toISOString(),
    photoCount: row._count.documents,
  };
}

/** A szűrők `where`-je, tisztán: a lista és a számláló ugyanazt kapja. */
export function mortalityWhere(
  query: MortalityListQuery,
): Prisma.MortalityRecordWhereInput {
  const and: Prisma.MortalityRecordWhereInput[] = [];
  const q = query.q?.trim();
  if (q)
    and.push({
      product: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { datasheet: { magyarNev: { contains: q, mode: "insensitive" } } },
        ],
      },
    });
  if (query.sourceType) and.push({ sourceType: query.sourceType });
  if (query.supplierId) and.push({ supplierId: query.supplierId });
  if (query.aquariumId) and.push({ aquariumId: query.aquariumId });
  if (query.recordedById) and.push({ recordedById: query.recordedById });
  if (query.from)
    and.push({
      recordedAt: {
        gte: startOfBudapestDay(new Date(`${query.from}T12:00:00Z`)),
      },
    });
  if (query.to)
    and.push({
      recordedAt: {
        lt: startOfBudapestDay(new Date(`${query.to}T12:00:00Z`), 1),
      },
    });
  return and.length ? { AND: and } : {};
}

@Injectable()
export class MortalityRepository {
  private readonly database = prisma;

  async list(query: MortalityListQuery): Promise<MortalityListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? MORTALITY_LIST_PAGE_SIZE.default;
    const where = mortalityWhere(query);
    const [rows, totalItems] = await Promise.all([
      this.database.mortalityRecord.findMany({
        where,
        select: LIST_SELECT,
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.database.mortalityRecord.count({ where }),
    ]);
    return {
      items: rows.map(toListItem),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
      },
    };
  }

  /**
   * A HÁROM ÖSSZESÍTŐ KÁRTYA (Figma), PÉLDÁNYSZÁMBAN, Budapest naptára szerint:
   * a folyó hónap, az utolsó 7 nap (a mait is beleértve), és a hónap legtöbb
   * példányt vesztett akváriuma. Két aggregáló lekérdezés, a lista szűrőitől
   * függetlenül.
   */
  async summary(now = new Date()): Promise<MortalitySummary> {
    const dayOfMonth = Number(budapestDayKey(now).slice(8, 10));
    const monthStart = startOfBudapestDay(now, -(dayOfMonth - 1));
    const weekStart = startOfBudapestDay(now, -6);
    const [month, week, byAquarium] = await Promise.all([
      this.database.mortalityRecord.aggregate({
        where: { recordedAt: { gte: monthStart } },
        _sum: { quantity: true },
      }),
      this.database.mortalityRecord.aggregate({
        where: { recordedAt: { gte: weekStart } },
        _sum: { quantity: true },
      }),
      this.database.mortalityRecord.groupBy({
        by: ["aquariumId"],
        where: { recordedAt: { gte: monthStart } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 1,
      }),
    ]);
    const top = byAquarium[0];
    const aquarium = top
      ? await this.database.aquarium.findUnique({
          where: { id: top.aquariumId },
          select: { id: true, name: true },
        })
      : null;
    return {
      thisMonth: month._sum.quantity ?? 0,
      last7Days: week._sum.quantity ?? 0,
      mostAffectedAquarium:
        top && aquarium
          ? { ...aquarium, quantity: top._sum.quantity ?? 0 }
          : null,
    };
  }

  async detail(id: string): Promise<MortalityDetail | null> {
    const row = await this.database.mortalityRecord.findUnique({
      where: { id },
      select: {
        ...LIST_SELECT,
        note: true,
        createdAt: true,
        updatedAt: true,
        documents: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            fileName: true,
            contentType: true,
            sizeBytes: true,
            caption: true,
            createdAt: true,
          },
        },
      },
    });
    if (!row) return null;
    // ha a rekordot soha nem módosították, az updatedAt a létrehozás pillanata
    const modified = row.updatedAt.getTime() - row.createdAt.getTime() > 1000;
    return {
      ...toListItem(row),
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      updatedAt: modified ? row.updatedAt.toISOString() : null,
      photos: row.documents.map((d): MortalityPhoto => ({
        ...d,
        createdAt: d.createdAt.toISOString(),
      })),
    };
  }

  async create(input: {
    productId: string;
    quantity: number;
    aquariumId: string;
    sourceType: MortalitySourceType;
    supplierId: string | null;
    sourceNote: string | null;
    note: string | null;
    recordedById: string;
  }): Promise<{ id: string }> {
    return withUniqueCode(
      { prefix: "ELH", field: "recordNumber" },
      (recordNumber) =>
        this.database.mortalityRecord.create({
          data: { ...input, recordNumber },
          select: { id: true },
        }),
    );
  }

  /**
   * A MÓDOSÍTÁS, AUDITNAPLÓVAL, EGY TRANZAKCIÓBAN: a változás-lista a régi és az
   * új értéket is viszi, és csak akkor ír naplósort, ha tényleg változott valami.
   */
  async update(
    id: string,
    data: Partial<{
      productId: string;
      quantity: number;
      aquariumId: string;
      sourceType: MortalitySourceType;
      supplierId: string | null;
      sourceNote: string | null;
      note: string | null;
    }>,
    actorUserId: string,
  ): Promise<boolean> {
    return this.database.$transaction(async (tx) => {
      const before = await tx.mortalityRecord.findUnique({
        where: { id },
        select: {
          productId: true,
          quantity: true,
          aquariumId: true,
          sourceType: true,
          supplierId: true,
          sourceNote: true,
          note: true,
        },
      });
      if (!before) return false;
      const changes = mortalityChanges(before, data);
      if (Object.keys(changes).length === 0) return true;
      await tx.mortalityRecord.update({ where: { id }, data });
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: MORTALITY_UPDATED_ACTION,
          entityType: "MortalityRecord",
          entityId: id,
          metadata: { changes } as unknown as Prisma.InputJsonValue,
        },
      });
      return true;
    });
  }

  async current(id: string) {
    return this.database.mortalityRecord.findUnique({
      where: { id },
      select: {
        productId: true,
        aquariumId: true,
        sourceType: true,
        supplierId: true,
        sourceNote: true,
      },
    });
  }

  /** Az élő állat gyökerek (Korallok, Halak, Gerinctelenek) alatti kategóriák. */
  async liveAnimalCategoryIds(): Promise<Set<string>> {
    return liveAnimalSubtreeIds(
      await this.database.category.findMany({
        select: { id: true, name: true, parentId: true },
      }),
    );
  }

  async isLiveAnimalProduct(productId: string): Promise<boolean> {
    const ids = await this.liveAnimalCategoryIds();
    if (ids.size === 0) return false;
    const hit = await this.database.productCategory.findFirst({
      where: { productId, categoryId: { in: [...ids] } },
      select: { id: true },
    });
    return hit !== null;
  }

  async isOwnAquarium(aquariumId: string): Promise<boolean> {
    const row = await this.database.aquarium.findFirst({
      where: { id: aquariumId, ownershipType: "OWN" },
      select: { id: true },
    });
    return row !== null;
  }

  async isSupplier(supplierId: string): Promise<boolean> {
    const row = await this.database.supplier.findFirst({
      where: { id: supplierId, isSupplier: true, deletedAt: null },
      select: { id: true },
    });
    return row !== null;
  }

  async productOptions(
    q: string | undefined,
  ): Promise<MortalityProductOption[]> {
    const ids = await this.liveAnimalCategoryIds();
    if (ids.size === 0) return [];
    const needle = q?.trim();
    const rows = await this.database.product.findMany({
      where: {
        isActive: true,
        archivedAt: null,
        categories: { some: { categoryId: { in: [...ids] } } },
        ...(needle
          ? {
              OR: [
                { name: { contains: needle, mode: "insensitive" } },
                {
                  datasheet: {
                    magyarNev: { contains: needle, mode: "insensitive" },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
      take: OPTION_LIMIT,
      select: {
        id: true,
        name: true,
        datasheet: { select: { magyarNev: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      commonName: row.datasheet?.magyarNev?.trim() || null,
    }));
  }

  async aquariumOptions(): Promise<MortalityAquariumOption[]> {
    return this.database.aquarium.findMany({
      where: { ownershipType: "OWN", isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, aquariumNumber: true },
    });
  }

  async supplierOptions(
    q: string | undefined,
  ): Promise<MortalitySupplierOption[]> {
    const needle = q?.trim();
    return this.database.supplier.findMany({
      where: {
        isSupplier: true,
        isActive: true,
        deletedAt: null,
        ...(needle ? { name: { contains: needle, mode: "insensitive" } } : {}),
      },
      orderBy: { name: "asc" },
      take: OPTION_LIMIT,
      select: { id: true, name: true },
    });
  }

  /** Akik már rögzítettek: a „Rögzítette” szűrő választója. */
  async recorderOptions(): Promise<MortalityRecorderOption[]> {
    const rows = await this.database.user.findMany({
      where: { mortalityRecordsRecorded: { some: {} } },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    });
    return rows.map((row) => ({ id: row.id, name: row.displayName }));
  }

  async exists(id: string): Promise<boolean> {
    const row = await this.database.mortalityRecord.findUnique({
      where: { id },
      select: { id: true },
    });
    return row !== null;
  }

  async addPhoto(input: {
    id: string;
    mortalityRecordId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    content: Buffer | null;
    storageKey?: string | null;
    thumbnail: Buffer | null;
    caption: string | null;
    actorUserId: string;
  }): Promise<MortalityPhoto> {
    const row = await this.database.mortalityRecordDocument.create({
      data: {
        id: input.id,
        mortalityRecordId: input.mortalityRecordId,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        content: input.content ? Uint8Array.from(input.content) : null,
        storageKey: input.storageKey ?? null,
        thumbnail: input.thumbnail ? Uint8Array.from(input.thumbnail) : null,
        caption: input.caption,
        uploadedById: input.actorUserId,
      },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        caption: true,
        createdAt: true,
      },
    });
    return { ...row, createdAt: row.createdAt.toISOString() };
  }

  async photo(mortalityRecordId: string, documentId: string) {
    return this.database.mortalityRecordDocument.findFirst({
      where: { id: documentId, mortalityRecordId },
      select: {
        fileName: true,
        contentType: true,
        content: true,
        storageKey: true,
      },
    });
  }

  async photoThumbnail(mortalityRecordId: string, documentId: string) {
    const row = await this.database.mortalityRecordDocument.findFirst({
      where: { id: documentId, mortalityRecordId },
      select: { fileName: true, thumbnail: true },
    });
    return row?.thumbnail
      ? { fileName: row.fileName, thumbnail: row.thumbnail }
      : null;
  }
}
