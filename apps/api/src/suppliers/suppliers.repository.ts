import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma, prisma, Repository, type Supplier } from "@acropora/database";
import type { SupplierListResponse, SupplierSummary } from "@acropora/types";

import { generateCode } from "../common/code-generator.util.js";
import type { CreateSupplierDto, SupplierListQueryDto } from "./dto/supplier.dto.js";

function toSummary(supplier: Supplier): SupplierSummary {
  return {
    id: supplier.id,
    code: supplier.code,
    name: supplier.name,
    taxNumber: supplier.taxNumber ?? undefined,
    country: supplier.country,
    email: supplier.email ?? undefined,
    phone: supplier.phone ?? undefined,
    isActive: supplier.isActive,
    createdAt: supplier.createdAt.toISOString(),
    updatedAt: supplier.updatedAt.toISOString(),
  };
}

@Injectable()
export class SuppliersRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async list(query: SupplierListQueryDto): Promise<SupplierListResponse> {
    const where: Prisma.SupplierWhereInput = {
      ...(query.status === "ALL" ? {} : { isActive: query.status === "ACTIVE" }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { code: { contains: query.search, mode: "insensitive" } },
              { taxNumber: { contains: query.search, mode: "insensitive" } },
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
        const supplier = await tx.supplier.create({
          data: {
            code,
            name: input.name.trim(),
            taxNumber: input.taxNumber?.trim() || undefined,
            country: (input.country ?? "HU").trim().toUpperCase(),
            email: input.email?.trim() || undefined,
            phone: input.phone?.trim() || undefined,
          },
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
}
