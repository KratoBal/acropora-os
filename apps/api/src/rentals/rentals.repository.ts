import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type {
  Rental,
  RentalCustomerSummary,
  RentalStatus,
} from "@acropora/types";

import { isPrismaUniqueConstraintViolation } from "../common/prisma-error.util.js";
import { withUniqueCode } from "../common/unique-code.util.js";
import { customerSearchPattern } from "../customers/customers.repository.js";

/** The device already has an OPEN rental (the partial unique index refused the second one). */
export class EquipmentAlreadyRentedError extends Error {}

const OPEN_INDEX = "Rental_equipmentId_open_key";

const CUSTOMER_SELECT = {
  id: true,
  customerNumber: true,
  displayName: true,
  phone: true,
  email: true,
  addresses: {
    select: {
      postalCode: true,
      city: true,
      line1: true,
      line2: true,
      isDefault: true,
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    take: 1,
  },
} as const satisfies Prisma.CustomerSelect;

const RENTAL_SELECT = {
  id: true,
  rentalNumber: true,
  status: true,
  startsAt: true,
  plannedReturnAt: true,
  dailyFeeHuf: true,
  depositHuf: true,
  replacementValueHuf: true,
  lateFeeMultiplier: true,
  replacementAfterDays: true,
  accessories: true,
  expectedFeeHuf: true,
  note: true,
  returnedAt: true,
  finalFeeHuf: true,
  lateSurchargeHuf: true,
  depositKeptHuf: true,
  depositKeptReason: true,
  createdAt: true,
  equipment: { select: { id: true, name: true, serialNumber: true } },
  customer: { select: CUSTOMER_SELECT },
} as const satisfies Prisma.RentalSelect;

type CustomerRow = Prisma.CustomerGetPayload<{
  select: typeof CUSTOMER_SELECT;
}>;
type RentalRow = Prisma.RentalGetPayload<{ select: typeof RENTAL_SELECT }>;

export function customerSummary(row: CustomerRow): RentalCustomerSummary {
  const address = row.addresses[0];
  const street = address
    ? [address.line1, address.line2].filter(Boolean).join(" ")
    : "";
  const line = address
    ? `${address.postalCode} ${address.city}, ${street}`.trim()
    : "";
  return {
    id: row.id,
    customerNumber: row.customerNumber,
    displayName: row.displayName,
    phone: row.phone,
    email: row.email,
    address: line === "" || line === "," ? null : line,
  };
}

function toRental(row: RentalRow): Rental {
  return {
    id: row.id,
    rentalNumber: row.rentalNumber,
    status: row.status,
    equipment: row.equipment,
    customer: customerSummary(row.customer),
    startsAt: row.startsAt.toISOString(),
    plannedReturnAt: row.plannedReturnAt.toISOString(),
    dailyFeeHuf: row.dailyFeeHuf,
    depositHuf: row.depositHuf,
    replacementValueHuf: row.replacementValueHuf,
    lateFeeMultiplier: row.lateFeeMultiplier?.toNumber() ?? null,
    replacementAfterDays: row.replacementAfterDays,
    accessories: row.accessories,
    expectedFeeHuf: row.expectedFeeHuf,
    note: row.note,
    returnedAt: row.returnedAt?.toISOString() ?? null,
    // a rental returned before S4 has no recorded settlement, and none is invented for it
    settlement:
      row.status === "RETURNED" && row.finalFeeHuf !== null
        ? {
            feeHuf: row.finalFeeHuf,
            lateSurchargeHuf: row.lateSurchargeHuf,
            depositKeptHuf: row.depositKeptHuf ?? 0,
            depositKeptReason: row.depositKeptReason,
          }
        : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The comparable part of a phone number: its last nine digits ("+36 30 123 4567", "06-30/123-4567" and "301234567" all give
 * "301234567"). `null` below nine digits: a shorter fragment would offer strangers.
 */
export function phoneMatchKey(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

export type RentalCreateRow = {
  customerId: string;
  equipmentId: string;
  startsAt: Date;
  plannedReturnAt: Date;
  dailyFeeHuf: number;
  depositHuf: number;
  replacementValueHuf: number;
  /** The contract as agreed: the text and the late-return settings in force now, frozen on the rental. */
  contractTemplate: string;
  lateFeeMultiplier: number | null;
  replacementAfterDays: number | null;
  accessories: string | null;
  expectedFeeHuf: number;
  note: string | null;
  createdById: string | null;
};

export type RentalReturnRow = {
  returnedAt: Date;
  finalFeeHuf: number;
  lateSurchargeHuf: number | null;
  depositKeptHuf: number;
  depositKeptReason: string | null;
  returnedById: string;
};

/**
 * The search box's fields in the database (the page's `rentalMatches`): the contract number, the device's name and serial
 * number, the renter's name, phone and e-mail; any of them, case-insensitive. Nothing to search: no condition.
 */
export function rentalSearchWhere(
  q: string | undefined,
): Prisma.RentalWhereInput {
  const needle = q?.trim();
  if (!needle) return {};
  const contains = { contains: needle, mode: "insensitive" as const };
  return {
    OR: [
      { rentalNumber: contains },
      { equipment: { name: contains } },
      { equipment: { serialNumber: contains } },
      { customer: { displayName: contains } },
      { customer: { phone: contains } },
      { customer: { email: contains } },
    ],
  };
}

/** The most rentals one list answer carries; over it the answer says `truncated` (barracuda, #2274 b). */
export const RENTAL_LIST_LIMIT = 500;

@Injectable()
export class RentalsRepository {
  /** Open rentals first by planned return (the overdue on top), then the returned ones, newest first. */
  async list(
    status: RentalStatus | undefined,
    q?: string,
  ): Promise<{ items: Rental[]; truncated: boolean }> {
    const rows = await prisma.rental.findMany({
      where: { ...(status ? { status } : {}), ...rentalSearchWhere(q) },
      // an OPEN row has no returnedAt, so the second key only orders the returned ones (newest first)
      orderBy: [
        { status: "asc" },
        { returnedAt: { sort: "desc", nulls: "first" } },
        { plannedReturnAt: "asc" },
      ],
      select: RENTAL_SELECT,
      // one more than shown: its presence is the only honest way to know the list is cut
      take: RENTAL_LIST_LIMIT + 1,
    });
    return {
      items: rows.slice(0, RENTAL_LIST_LIMIT).map(toRental),
      truncated: rows.length > RENTAL_LIST_LIMIT,
    };
  }

  /**
   * RECORDS THE RETURN, only while the rental is still OPEN: the condition is in the write, so two desks taking the same device
   * back settle it once, and the second gets `false` (not a second settlement over the first). OPEN -> RETURNED also frees the
   * device for the next rental (the partial unique index covers OPEN rows only).
   */
  async markReturned(id: string, row: RentalReturnRow): Promise<boolean> {
    const { count } = await prisma.rental.updateMany({
      where: { id, status: "OPEN" },
      data: { ...row, status: "RETURNED" },
    });
    return count === 1;
  }

  /** The contract text frozen on the rental; null for a rental recorded before S3. */
  async contractTemplateOf(id: string): Promise<string | null> {
    const row = await prisma.rental.findUnique({
      where: { id },
      select: { contractTemplate: true },
    });
    return row?.contractTemplate ?? null;
  }

  async byId(id: string): Promise<Rental | null> {
    const row = await prisma.rental.findUnique({
      where: { id },
      select: RENTAL_SELECT,
    });
    return row ? toRental(row) : null;
  }

  async equipment(id: string) {
    return await prisma.rentalEquipment.findUnique({
      where: { id },
      select: {
        id: true,
        isActive: true,
        dailyFeeHuf: true,
        depositHuf: true,
        replacementValueHuf: true,
        accessories: true,
      },
    });
  }

  /** The active devices with no OPEN rental: what the desk may hand out now. */
  async availableEquipment() {
    return await prisma.rentalEquipment.findMany({
      where: { isActive: true, rentals: { none: { status: "OPEN" } } },
      select: {
        id: true,
        name: true,
        serialNumber: true,
        dailyFeeHuf: true,
        depositHuf: true,
        replacementValueHuf: true,
        accessories: true,
        note: true,
        isActive: true,
      },
    });
  }

  hasOpenRental(equipmentId: string): Promise<boolean> {
    return prisma.rental
      .count({ where: { equipmentId, status: "OPEN" } })
      .then((count) => count > 0);
  }

  /** A live customer row (not archived, not merged away), or null. */
  async liveCustomer(id: string): Promise<{ id: string } | null> {
    return prisma.customer.findFirst({
      where: { id, archivedAt: null, mergedIntoId: null },
      select: { id: true },
    });
  }

  /**
   * Removes a customer row this request created a moment ago, when its rental could not be stored (two desks handing out
   * the same device: the loser's new renter would otherwise stay in the register with no rental; barracuda, #2274 review).
   * Only a row with no rental is touched; its addresses go with it (cascade).
   */
  async removeUnusedNewCustomer(id: string): Promise<void> {
    await prisma.customer.deleteMany({ where: { id, rentals: { none: {} } } });
  }

  async create(row: RentalCreateRow): Promise<Rental> {
    try {
      return await withUniqueCode(
        { prefix: "BER", field: "rentalNumber" },
        async (rentalNumber) =>
          toRental(
            await prisma.rental.create({
              data: {
                ...row,
                rentalNumber,
                lateFeeMultiplier:
                  row.lateFeeMultiplier === null
                    ? null
                    : new Prisma.Decimal(row.lateFeeMultiplier),
              },
              select: RENTAL_SELECT,
            }),
          ),
      );
    } catch (error) {
      if (
        isPrismaUniqueConstraintViolation(error, OPEN_INDEX) ||
        isPrismaUniqueConstraintViolation(error, "equipmentId")
      )
        throw new EquipmentAlreadyRentedError();
      throw error;
    }
  }

  /**
   * Existing customers that look like the renter being typed: the same phone (last nine digits), the same e-mail (case
   * ignored), or a name containing the typed one (accents ignored, at least three letters). Live rows only. Exact phone or
   * e-mail matches come first: those are almost surely the same person, a name alone is only a hint.
   */
  async customerMatches(input: {
    name?: string;
    phone?: string;
    email?: string;
  }): Promise<RentalCustomerSummary[]> {
    const phoneKey = phoneMatchKey(input.phone);
    const email = input.email?.trim().toLowerCase() || null;
    const name =
      input.name && input.name.trim().length >= 3 ? input.name.trim() : null;
    if (!phoneKey && !email && !name) return [];

    const strong: Prisma.Sql[] = [];
    if (phoneKey)
      strong.push(
        Prisma.sql`right(regexp_replace(COALESCE("phone", ''), '[^0-9]', '', 'g'), 9) = ${phoneKey}`,
      );
    if (email) strong.push(Prisma.sql`lower(COALESCE("email", '')) = ${email}`);
    const conditions = name
      ? [
          ...strong,
          Prisma.sql`unaccent("displayName") ILIKE unaccent(${customerSearchPattern(name)}::text)`,
        ]
      : strong;

    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Customer"
      WHERE "archivedAt" IS NULL AND "mergedIntoId" IS NULL
        AND (${Prisma.join(conditions, " OR ")})
      ORDER BY ${strong.length ? Prisma.sql`(${Prisma.join(strong, " OR ")}) DESC,` : Prisma.empty} "displayName" ASC
      LIMIT 10
    `;
    if (rows.length === 0) return [];
    const order = new Map(rows.map((row, index) => [row.id, index]));
    const customers = await prisma.customer.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      select: CUSTOMER_SELECT,
    });
    return customers
      .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
      .map(customerSummary);
  }
}
