import { Injectable } from "@nestjs/common";

import { Prisma, prisma } from "@acropora/database";
import type {
  LivestockArrival,
  LivestockArrivalKind,
  LivestockArrivalProductOption,
  LivestockArrivalStatus,
} from "@acropora/types";

import {
  deriveLivestockKind,
  liveAnimalKindSubtrees,
} from "../integrations/medusa/medusa-livestock.policy.js";

/** What the repository writes: the service has already checked every value. */
export interface LivestockArrivalWrite {
  kind: LivestockArrivalKind;
  label: string;
  productId: string | null;
  /** `YYYY-MM-DD` */
  expectedOn: string;
  quantity: number | null;
  status: LivestockArrivalStatus;
  preorderable: boolean;
  note: string | null;
}

export interface LivestockArrivalFilters {
  status?: LivestockArrivalStatus;
  kind?: LivestockArrivalKind;
  preorderable?: boolean;
  /** Hides arrived and cancelled arrivals, and the days before `today`. */
  upcoming?: { today: string };
}

const SELECT = {
  id: true,
  kind: true,
  label: true,
  productId: true,
  expectedOn: true,
  quantity: true,
  status: true,
  preorderable: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  product: { select: { name: true } },
} satisfies Prisma.LivestockArrivalSelect;

type Row = Prisma.LivestockArrivalGetPayload<{ select: typeof SELECT }>;

/** A `@db.Date` column comes back as midnight UTC of the stored day: its ISO date is the day itself. */
const day = (value: Date): string => value.toISOString().slice(0, 10);

/** The row as the API shows it (exported for the date test: this is where a day could slip by a timezone). */
export function livestockArrivalView(row: Row): LivestockArrival {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    productId: row.productId,
    productName: row.product?.name ?? null,
    expectedOn: day(row.expectedOn),
    quantity: row.quantity,
    status: row.status,
    preorderable: row.preorderable,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** `YYYY-MM-DD` to the midnight UTC a `@db.Date` column stores (exported for the same test). */
export const livestockArrivalDay = (value: string) =>
  new Date(`${value}T00:00:00.000Z`);

/** The search offers at most this many products (the mortality log's picker does the same). */
export const PRODUCT_OPTION_LIMIT = 20;

/** A product row as the picker's option, with the kind its categories give (null when ambiguous or none). Exported for the test. */
export function livestockProductOption(
  row: {
    id: string;
    name: string;
    datasheet: { magyarNev: string | null } | null;
    categories: readonly { categoryId: string }[];
  },
  subtrees: ReturnType<typeof liveAnimalKindSubtrees>,
): LivestockArrivalProductOption {
  return {
    id: row.id,
    name: row.name,
    commonName: row.datasheet?.magyarNev?.trim() || null,
    kind: deriveLivestockKind(
      row.categories.map((c) => c.categoryId),
      subtrees,
    ),
  };
}

@Injectable()
export class LivestockArrivalsRepository {
  /**
   * THE SOONEST DAY FIRST, THEN THE ID: two arrivals of the same day keep a stable order between two reads (the id is the
   * tie-break, so the list does not "jump" for the person reading it).
   */
  async list(filters: LivestockArrivalFilters): Promise<LivestockArrival[]> {
    const where: Prisma.LivestockArrivalWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.preorderable === undefined
        ? {}
        : { preorderable: filters.preorderable }),
      ...(filters.upcoming
        ? {
            status: filters.status ?? { in: ["ORDERED", "IN_TRANSIT"] },
            expectedOn: { gte: livestockArrivalDay(filters.upcoming.today) },
          }
        : {}),
    };
    const rows = await prisma.livestockArrival.findMany({
      where,
      select: SELECT,
      orderBy: [{ expectedOn: "asc" }, { id: "asc" }],
      take: 500,
    });
    return rows.map(livestockArrivalView);
  }

  async get(id: string): Promise<LivestockArrival | null> {
    const row = await prisma.livestockArrival.findUnique({
      where: { id },
      select: SELECT,
    });
    return row ? livestockArrivalView(row) : null;
  }

  /**
   * THE LIVE ANIMAL PRODUCTS: the three roots' whole subtrees (Korallok, Halak, Gerinctelenek), the same source as the shop's
   * pickup-only rule and the mortality log. Read per call (a few hundred categories), so a renamed or moved category is
   * followed without a restart.
   */
  private async kindSubtrees() {
    return liveAnimalKindSubtrees(
      await prisma.category.findMany({
        select: { id: true, name: true, parentId: true },
      }),
    );
  }

  /**
   * THE LINK'S FACTS: null unless the product exists under one of the three live animal roots; otherwise the kind its
   * categories give (null when ambiguous) and whether the picker would offer it (active, not archived).
   */
  async liveAnimalProduct(
    productId: string,
  ): Promise<{ kind: LivestockArrivalKind | null; offered: boolean } | null> {
    const subtrees = await this.kindSubtrees();
    const ids = [...subtrees.values()].flatMap((set) => [...set]);
    if (ids.length === 0) return null;
    const row = await prisma.product.findFirst({
      where: {
        id: productId,
        categories: { some: { categoryId: { in: ids } } },
      },
      select: {
        isActive: true,
        archivedAt: true,
        categories: { select: { categoryId: true } },
      },
    });
    if (!row) return null;
    return {
      kind: deriveLivestockKind(
        row.categories.map((c) => c.categoryId),
        subtrees,
      ),
      offered: row.isActive && row.archivedAt === null,
    };
  }

  /** At most `PRODUCT_OPTION_LIMIT` live animal products matching the search, by name, A to Z. */
  async productOptions(
    q: string | undefined,
  ): Promise<LivestockArrivalProductOption[]> {
    const subtrees = await this.kindSubtrees();
    const ids = [...subtrees.values()].flatMap((set) => [...set]);
    if (ids.length === 0) return [];
    const needle = q?.trim();
    const rows = await prisma.product.findMany({
      where: {
        isActive: true,
        archivedAt: null,
        categories: { some: { categoryId: { in: ids } } },
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
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: PRODUCT_OPTION_LIMIT,
      select: {
        id: true,
        name: true,
        datasheet: { select: { magyarNev: true } },
        categories: { select: { categoryId: true } },
      },
    });
    return rows.map((row) => livestockProductOption(row, subtrees));
  }

  async create(
    data: LivestockArrivalWrite,
    createdById: string | null,
  ): Promise<LivestockArrival> {
    const row = await prisma.livestockArrival.create({
      data: {
        ...data,
        expectedOn: livestockArrivalDay(data.expectedOn),
        createdById,
      },
      select: SELECT,
    });
    return livestockArrivalView(row);
  }

  /** `null` when there is no such arrival. */
  /**
   * THE WRITE IS CONDITIONAL ON THE ROW NOT HAVING MOVED SINCE THE SERVICE READ IT (`updatedAt` in the where): the service merges
   * the request over the stored record and writes every field, so a second edit landing between the read and the write would
   * otherwise be silently overwritten. Returns "changed" when the row moved, null when it is gone.
   */
  async update(
    id: string,
    data: LivestockArrivalWrite,
    readAt: string,
  ): Promise<LivestockArrival | "changed" | null> {
    const { count } = await prisma.livestockArrival.updateMany({
      where: { id },
      data: { ...data, expectedOn: livestockArrivalDay(data.expectedOn) },
    });
    const row = await this.get(id);
    if (count === 1) return row;
    return row ? "changed" : null;
  }
}
