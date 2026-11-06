import { Injectable } from "@nestjs/common";

import { Prisma, prisma } from "@acropora/database";
import type {
  LivestockArrival,
  LivestockArrivalKind,
  LivestockArrivalStatus,
} from "@acropora/types";

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

  async productExists(productId: string): Promise<boolean> {
    return (await prisma.product.count({ where: { id: productId } })) > 0;
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
  async update(
    id: string,
    data: LivestockArrivalWrite,
  ): Promise<LivestockArrival | null> {
    try {
      const row = await prisma.livestockArrival.update({
        where: { id },
        data: { ...data, expectedOn: livestockArrivalDay(data.expectedOn) },
        select: SELECT,
      });
      return livestockArrivalView(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      )
        return null;
      throw error;
    }
  }
}
