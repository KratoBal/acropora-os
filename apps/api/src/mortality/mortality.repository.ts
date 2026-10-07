import { Injectable } from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";
import {
  MORTALITY_LIST_PAGE_SIZE,
  type MortalityAquariumOption,
  type MortalityDetail,
  type MortalityListItem,
  type MortalityListQuery,
  type MortalityListResponse,
  type MortalityLocationOption,
  type MortalityPhoto,
  type MortalityProductOption,
  type MortalityRecorderOption,
  type MortalitySourceType,
  type MortalitySummary,
  type MortalitySupplierOption,
} from "@acropora/types";

import { generateCode } from "../common/code-generator.util.js";
import { retryOnTakenCode } from "../common/unique-code.util.js";
import {
  budapestDayKey,
  startOfBudapestDay,
} from "../dashboard/budapest-day.js";
import { liveAnimalSubtreeIds } from "../integrations/medusa/medusa-livestock.policy.js";
import {
  deductedByVariant,
  mortalityLedger,
  mortalityStockEffect,
  mortalityStockProduct,
  planMortalityStock,
  syncMortalityStock,
  type MortalityStockDatabase,
} from "./mortality-stock.js";
import {
  dateOfDayKey,
  dayKeyOf,
  mortalityChanges,
} from "./mortality.policy.js";

/** Az auditnapló sorának neve. */
export const MORTALITY_UPDATED_ACTION = "mortality.updated";
export const MORTALITY_ENTITY_TYPE = "MortalityRecord";

const OPTION_LIMIT = 20;

const LIST_SELECT = {
  id: true,
  recordNumber: true,
  productName: true,
  quantity: true,
  sourceType: true,
  sourceNote: true,
  occurredOn: true,
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
  location: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, displayName: true } },
  _count: { select: { documents: true } },
} satisfies Prisma.MortalityRecordSelect;

type ListRow = Prisma.MortalityRecordGetPayload<{ select: typeof LIST_SELECT }>;

function toListItem(row: ListRow): MortalityListItem {
  return {
    id: row.id,
    recordNumber: row.recordNumber,
    product: row.product
      ? {
          id: row.product.id,
          name: row.product.name,
          commonName: row.product.datasheet?.magyarNev?.trim() || null,
        }
      : null,
    productName: row.productName,
    quantity: row.quantity,
    aquarium: row.aquarium,
    location: row.location,
    source: {
      type: row.sourceType,
      supplier: row.supplier,
      note: row.sourceNote,
    },
    recordedBy: { id: row.recordedBy.id, name: row.recordedBy.displayName },
    occurredOn: dayKeyOf(row.occurredOn),
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
      OR: [
        {
          product: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              {
                datasheet: { magyarNev: { contains: q, mode: "insensitive" } },
              },
            ],
          },
        },
        // a szabad szöveggel rögzített élőlény is megtalálható
        { productName: { contains: q, mode: "insensitive" } },
      ],
    });
  if (query.sourceType) and.push({ sourceType: query.sourceType });
  if (query.supplierId) and.push({ supplierId: query.supplierId });
  if (query.aquariumId) and.push({ aquariumId: query.aquariumId });
  if (query.recordedById) and.push({ recordedById: query.recordedById });
  // az időszak az elhullás NAPJÁRA szűr (Luca, 2026-10-07), nem a rögzítésére:
  // egy utólag rögzített elhullás a valódi napjánál számít
  if (query.from) and.push({ occurredOn: { gte: dateOfDayKey(query.from) } });
  if (query.to) and.push({ occurredOn: { lte: dateOfDayKey(query.to) } });
  return and.length ? { AND: and } : {};
}

/**
 * A három összesítő ablak kezdőnapja, Budapest naptára szerint, `@db.Date`
 * értékként (UTC éjfél): az összesítő az elhullás napját számolja.
 */
export function summaryWindows(now: Date) {
  const dayOfMonth = Number(budapestDayKey(now).slice(8, 10));
  const day = (offset: number) =>
    dateOfDayKey(budapestDayKey(startOfBudapestDay(now, offset)));
  return {
    monthStart: day(-(dayOfMonth - 1)),
    weekStart: day(-6),
    previousWeekStart: day(-13),
  };
}

/**
 * A hónap akváriumonkénti összegeiből: összesen, hány akváriumban, és a
 * legérintettebb. Döntetlennél az elsőként kapott marad (a sorrend ott nem
 * jelentés, csak egy akvárium kell a kártyára).
 */
export function summarizeMonth(
  rows: readonly { aquariumId: string; quantity: number }[],
) {
  let total = 0;
  let top: { aquariumId: string; quantity: number } | null = null;
  for (const row of rows) {
    total += row.quantity;
    if (!top || row.quantity > top.quantity) top = row;
  }
  return { total, aquariumCount: rows.length, top };
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
        // az elhullás napja szerint; egy napon belül a rögzítés sorrendje
        orderBy: [
          { occurredOn: "desc" },
          { recordedAt: "desc" },
          { id: "desc" },
        ],
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
   * a folyó hónap (és hány akváriumban), az utolsó 7 nap (a mait is
   * beleértve) és az azt megelőző 7 nap, valamint a hónap legtöbb példányt
   * vesztett akváriuma. A lista szűrőitől független.
   */
  async summary(now = new Date()): Promise<MortalitySummary> {
    const { monthStart, weekStart, previousWeekStart } = summaryWindows(now);
    const [byAquarium, week, previousWeek] = await Promise.all([
      this.database.mortalityRecord.groupBy({
        by: ["aquariumId"],
        where: { occurredOn: { gte: monthStart } },
        _sum: { quantity: true },
      }),
      this.database.mortalityRecord.aggregate({
        where: { occurredOn: { gte: weekStart } },
        _sum: { quantity: true },
      }),
      this.database.mortalityRecord.aggregate({
        where: { occurredOn: { gte: previousWeekStart, lt: weekStart } },
        _sum: { quantity: true },
      }),
    ]);
    const month = summarizeMonth(
      byAquarium.map((row) => ({
        aquariumId: row.aquariumId,
        quantity: row._sum.quantity ?? 0,
      })),
    );
    const aquarium = month.top
      ? await this.database.aquarium.findUnique({
          where: { id: month.top.aquariumId },
          select: { id: true, name: true, aquariumNumber: true },
        })
      : null;
    return {
      thisMonth: month.total,
      thisMonthAquariumCount: month.aquariumCount,
      last7Days: week._sum.quantity ?? 0,
      previous7Days: previousWeek._sum.quantity ?? 0,
      mostAffectedAquarium:
        month.top && aquarium
          ? { ...aquarium, quantity: month.top.quantity }
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
    // a „legutóbbi módosítás” az auditnaplóból jön, nem az updatedAt-ből: az
    // a módosítót nem tudja, és egy fénykép-feltöltés nem módosítás
    const lastUpdate = await this.database.auditLog.findFirst({
      where: {
        entityType: MORTALITY_ENTITY_TYPE,
        entityId: id,
        action: MORTALITY_UPDATED_ACTION,
      },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        user: { select: { id: true, displayName: true } },
      },
    });
    // a készlethatás a naplóból (amit valóban levontunk), az ok a mai tervből
    const db = this.database as unknown as MortalityStockDatabase;
    const stock = mortalityStockEffect(
      deductedByVariant(await mortalityLedger(db, id)),
      planMortalityStock(
        await mortalityStockProduct(db, row.product?.id ?? null),
        row.quantity,
      ).reason,
    );
    return {
      ...toListItem(row),
      note: row.note,
      stock,
      createdAt: row.createdAt.toISOString(),
      lastModified: lastUpdate
        ? {
            at: lastUpdate.createdAt.toISOString(),
            by: lastUpdate.user
              ? { id: lastUpdate.user.id, name: lastUpdate.user.displayName }
              : null,
          }
        : null,
      photos: row.documents.map((d): MortalityPhoto => ({
        ...d,
        createdAt: d.createdAt.toISOString(),
      })),
    };
  }

  /**
   * A LÉTREHOZÁS ÉS A KÉSZLET-LEVONÁS EGY TRANZAKCIÓBAN: egy bejegyzés nem
   * maradhat levonás nélkül, és egy levonás sem bejegyzés nélkül. Az azonosító-
   * ütközés (a bejegyzés vagy a mozgás száma) az egész tranzakciót ismétli.
   */
  async create(input: {
    productId: string | null;
    productName: string | null;
    quantity: number;
    aquariumId: string;
    sourceType: MortalitySourceType;
    supplierId: string | null;
    sourceNote: string | null;
    note: string | null;
    occurredOn: Date;
    locationId: string | null;
    recordedById: string;
  }): Promise<{ id: string }> {
    return retryOnTakenCode({ field: ["recordNumber", "movementNumber"] }, () =>
      this.database.$transaction(async (tx) => {
        const created = await tx.mortalityRecord.create({
          data: { ...input, recordNumber: generateCode("ELH") },
          select: { id: true },
        });
        await syncMortalityStock(
          tx as unknown as MortalityStockDatabase,
          created.id,
          input.recordedById,
        );
        return created;
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
      productId: string | null;
      productName: string | null;
      quantity: number;
      aquariumId: string;
      sourceType: MortalitySourceType;
      supplierId: string | null;
      sourceNote: string | null;
      note: string | null;
      occurredOn: Date;
      locationId: string | null;
    }>,
    actorUserId: string,
  ): Promise<boolean> {
    return retryOnTakenCode({ field: "movementNumber" }, () =>
      this.database.$transaction(async (tx) => {
        const before = await tx.mortalityRecord.findUnique({
          where: { id },
          select: {
            productId: true,
            productName: true,
            quantity: true,
            aquariumId: true,
            sourceType: true,
            supplierId: true,
            sourceNote: true,
            note: true,
            occurredOn: true,
            locationId: true,
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
            entityType: MORTALITY_ENTITY_TYPE,
            entityId: id,
            metadata: { changes } as unknown as Prisma.InputJsonValue,
          },
        });
        // a készlet a módosított bejegyzéshez igazodik: csak a különbség mozog
        await syncMortalityStock(
          tx as unknown as MortalityStockDatabase,
          id,
          actorUserId,
        );
        return true;
      }),
    );
  }

  async current(id: string) {
    return this.database.mortalityRecord.findUnique({
      where: { id },
      select: {
        productId: true,
        productName: true,
        aquariumId: true,
        sourceType: true,
        supplierId: true,
        sourceNote: true,
        locationId: true,
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

  async isActiveLocation(locationId: string): Promise<boolean> {
    const row = await this.database.mortalityLocation.findFirst({
      where: { id: locationId, archivedAt: null },
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

  /** A halas rackek választója: a kivezetettek nélkül, a megadott sorrendben. */
  async locationOptions(): Promise<MortalityLocationOption[]> {
    return this.database.mortalityLocation.findMany({
      where: { archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
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
