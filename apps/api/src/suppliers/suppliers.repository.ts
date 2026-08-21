import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma, prisma, Repository, type Supplier } from "@acropora/database";
import type { SupplierListResponse, SupplierSummary } from "@acropora/types";

import { generateCode } from "../common/code-generator.util.js";
import type {
  CreateSupplierDto,
  SupplierListQueryDto,
  UpdateSupplierDto,
} from "./dto/supplier.dto.js";

function toSummary(supplier: Supplier): SupplierSummary {
  return {
    id: supplier.id,
    code: supplier.code,
    name: supplier.name,
    isSupplier: supplier.isSupplier,
    isService: supplier.isService,
    worksheetPartnerCode: supplier.worksheetPartnerCode ?? undefined,
    taxNumber: supplier.taxNumber ?? undefined,
    country: supplier.country,
    email: supplier.email ?? undefined,
    phone: supplier.phone ?? undefined,
    iban: supplier.iban ?? undefined,
    swiftCode: supplier.swiftCode ?? undefined,
    bankAccountNumber: supplier.bankAccountNumber ?? undefined,
    contactPersonName: supplier.contactPersonName ?? undefined,
    contactPersonPhone: supplier.contactPersonPhone ?? undefined,
    contactPersonEmail: supplier.contactPersonEmail ?? undefined,
    postalCode: supplier.postalCode ?? undefined,
    city: supplier.city ?? undefined,
    addressLine1: supplier.addressLine1 ?? undefined,
    addressLine2: supplier.addressLine2 ?? undefined,
    isActive: supplier.isActive,
    createdAt: supplier.createdAt.toISOString(),
    updatedAt: supplier.updatedAt.toISOString(),
  };
}

/**
 * The code has to be free on BOTH sides, and the reason is the mirror: the
 * partner's code is copied onto its customer row, where the same column is
 * already unique. Checking only the partner table would let a save pass
 * validation and then fail at the database with a message naming a constraint
 * instead of a company.
 *
 * The error names the holder on purpose. "Ez a kód foglalt" sends the person
 * hunting through a list; naming it ends the question.
 */
export async function assertPartnerCodeFree(
  tx: Prisma.TransactionClient,
  code: string,
  supplierId: string | null,
) {
  const partner = await tx.supplier.findFirst({
    where: {
      worksheetPartnerCode: code,
      ...(supplierId ? { NOT: { id: supplierId } } : {}),
    },
    select: { name: true },
  });
  if (partner) throw new Error(`PARTNER_CODE_TAKEN:${partner.name}`);

  const customer = await tx.customer.findFirst({
    where: {
      worksheetPartnerCode: code,
      ...(supplierId ? { partner: { isNot: { id: supplierId } } } : {}),
    },
    select: { displayName: true },
  });
  if (customer) throw new Error(`PARTNER_CODE_TAKEN:${customer.displayName}`);
}

/**
 * A worksheet belongs to a customer in three places -- the sheet, the unit and
 * the number's first segment -- so a service partner is given a customer row of
 * its own to carry them. The row is the partner's, not a buyer's: it is created
 * here rather than typed in, so a partner is still recorded once, by hand, in
 * one place, and the customer list leaves these rows out.
 *
 * Kept in step on every save, because the name and the code are what a
 * colleague reads on the worksheet: a partner renamed on the partner screen and
 * left alone here would put the old name on every sheet written afterwards.
 */
export async function syncWorksheetMirror(
  tx: Prisma.TransactionClient,
  supplier: {
    id: string;
    name: string;
    isService: boolean;
    customerId: string | null;
    worksheetPartnerCode?: string | null;
  },
) {
  if (!supplier.isService) {
    // Un-ticking "Szerviz" does not drop the row: worksheets may already point
    // at it, and `onDelete: Restrict` would refuse anyway. It stays, unlisted,
    // and is reused if the partner becomes a service partner again.
    return supplier.customerId;
  }
  // The code travels with the name: the worksheet number is built from the
  // customer row's copy, so a code left behind here would number new sheets
  // after the partner's old abbreviation.
  const carried = {
    displayName: supplier.name,
    companyName: supplier.name,
    worksheetPartnerCode: supplier.worksheetPartnerCode ?? null,
  };
  if (supplier.customerId) {
    await tx.customer.update({
      where: { id: supplier.customerId },
      data: carried,
    });
    return supplier.customerId;
  }
  const mirror = await tx.customer.create({
    data: {
      customerNumber: generateCode("VEVO"),
      type: "COMPANY",
      ...carried,
    },
    select: { id: true },
  });
  await tx.supplier.update({
    where: { id: supplier.id },
    data: { customerId: mirror.id },
  });
  return mirror.id;
}

@Injectable()
export class SuppliersRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async list(query: SupplierListQueryDto): Promise<SupplierListResponse> {
    const where: Prisma.SupplierWhereInput = {
      ...(query.status === "ALL"
        ? {}
        : { isActive: query.status === "ACTIVE" }),
      ...(query.kind === "SUPPLIER" ? { isSupplier: true } : {}),
      ...(query.kind === "SERVICE" ? { isService: true } : {}),
      ...(query.countryScope === "DOMESTIC"
        ? { country: { equals: "HU", mode: "insensitive" } }
        : query.countryScope === "EU"
          ? {
              NOT: [
                { country: { equals: "HU", mode: "insensitive" } },
                { country: "" },
              ],
            }
          : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { code: { contains: query.search, mode: "insensitive" } },
              { taxNumber: { contains: query.search, mode: "insensitive" } },
              {
                contactPersonName: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
              { city: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [suppliers, totalItems] = await Promise.all([
      prisma.supplier.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.supplier.count({ where }),
    ]);
    return {
      items: suppliers.map(toSummary),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async detail(id: string): Promise<SupplierSummary | null> {
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    return supplier ? toSummary(supplier) : null;
  }

  create(input: CreateSupplierDto, actorId: string): Promise<SupplierSummary> {
    const code = generateCode("SZALL");
    return prisma.$transaction(
      async (tx) => {
        if (input.worksheetPartnerCode)
          await assertPartnerCodeFree(tx, input.worksheetPartnerCode, null);
        const supplier = await tx.supplier.create({
          data: {
            code,
            name: input.name.trim(),
            // Omitted stays omitted, so the column default decides. Writing
            // `?? true` here would look equivalent and would not be: it would
            // move the decision out of the schema and into every caller.
            isSupplier: input.isSupplier,
            isService: input.isService,
            worksheetPartnerCode: input.worksheetPartnerCode,
            taxNumber: input.taxNumber?.trim() || undefined,
            country: (input.country ?? "HU").trim().toUpperCase(),
            email: input.email?.trim() || undefined,
            phone: input.phone?.trim() || undefined,
            iban: input.iban?.trim() || undefined,
            swiftCode: input.swiftCode?.trim() || undefined,
            bankAccountNumber: input.bankAccountNumber?.trim() || undefined,
            contactPersonName: input.contactPersonName?.trim() || undefined,
            contactPersonPhone: input.contactPersonPhone?.trim() || undefined,
            contactPersonEmail: input.contactPersonEmail?.trim() || undefined,
            postalCode: input.postalCode?.trim() || undefined,
            city: input.city?.trim() || undefined,
            addressLine1: input.addressLine1?.trim() || undefined,
            addressLine2: input.addressLine2?.trim() || undefined,
          },
        });
        await syncWorksheetMirror(tx, {
          id: supplier.id,
          name: supplier.name,
          isService: supplier.isService,
          customerId: supplier.customerId,
          worksheetPartnerCode: supplier.worksheetPartnerCode,
        });
        await tx.domainEvent.create({
          data: {
            id: randomUUID(),
            eventType: "supplier.created",
            aggregateType: "Supplier",
            aggregateId: supplier.id,
            actorUserId: actorId,
            payload: { code: supplier.code, name: supplier.name },
            occurredAt: new Date(),
            schemaVersion: 1,
          },
        });
        return toSummary(supplier);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  update(
    id: string,
    input: UpdateSupplierDto,
    actorId: string,
  ): Promise<SupplierSummary> {
    return prisma.$transaction(
      async (tx) => {
        const existing = await tx.supplier.findUniqueOrThrow({ where: { id } });
        if (input.worksheetPartnerCode)
          await assertPartnerCodeFree(tx, input.worksheetPartnerCode, id);
        const changed = await tx.supplier.updateMany({
          where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
          data: {
            name: input.name?.trim(),
            isSupplier: input.isSupplier,
            isService: input.isService,
            worksheetPartnerCode: input.worksheetPartnerCode,
            taxNumber:
              input.taxNumber === null ? null : input.taxNumber?.trim(),
            country: input.country?.trim().toUpperCase(),
            email: input.email === null ? null : input.email?.trim(),
            phone: input.phone === null ? null : input.phone?.trim(),
            iban: input.iban === null ? null : input.iban?.trim(),
            swiftCode:
              input.swiftCode === null ? null : input.swiftCode?.trim(),
            bankAccountNumber:
              input.bankAccountNumber === null
                ? null
                : input.bankAccountNumber?.trim(),
            contactPersonName:
              input.contactPersonName === null
                ? null
                : input.contactPersonName?.trim(),
            contactPersonPhone:
              input.contactPersonPhone === null
                ? null
                : input.contactPersonPhone?.trim(),
            contactPersonEmail:
              input.contactPersonEmail === null
                ? null
                : input.contactPersonEmail?.trim(),
            postalCode:
              input.postalCode === null ? null : input.postalCode?.trim(),
            city: input.city === null ? null : input.city?.trim(),
            addressLine1:
              input.addressLine1 === null ? null : input.addressLine1?.trim(),
            addressLine2:
              input.addressLine2 === null ? null : input.addressLine2?.trim(),
          },
        });
        if (changed.count !== 1) throw new Error("STALE_UPDATE");
        const saved = await tx.supplier.findUniqueOrThrow({
          where: { id },
          select: {
            id: true,
            name: true,
            isService: true,
            customerId: true,
            worksheetPartnerCode: true,
          },
        });
        await syncWorksheetMirror(tx, saved);
        await tx.domainEvent.create({
          data: {
            id: randomUUID(),
            eventType: "supplier.updated",
            aggregateType: "Supplier",
            aggregateId: id,
            actorUserId: actorId,
            payload: {
              previousName: existing.name,
              name: input.name ?? existing.name,
            },
            occurredAt: new Date(),
            schemaVersion: 1,
          },
        });
        const supplier = await tx.supplier.findUniqueOrThrow({ where: { id } });
        return toSummary(supplier);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
