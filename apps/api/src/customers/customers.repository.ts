import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  CustomerAddress,
  CustomerDetail,
  CustomerListResponse,
  CustomerSummary,
} from "@acropora/types";

import { generateCode } from "../common/code-generator.util.js";
import type {
  CreateCustomerDto,
  CustomerListQueryDto,
  UpdateCustomerDto,
} from "./dto/customer.dto.js";

const EXTERNAL_ENTITY_TYPE = "Customer";

const addressesInclude = {
  orderBy: [{ isDefault: "desc" as const }, { createdAt: "asc" as const }],
};
const include = { addresses: addressesInclude } satisfies Prisma.CustomerInclude;

type CustomerWithAddresses = Prisma.CustomerGetPayload<{ include: typeof include }>;

function toAddress(row: CustomerWithAddresses["addresses"][number]): CustomerAddress {
  return {
    id: row.id,
    type: row.type,
    name: row.name ?? undefined,
    country: row.country,
    postalCode: row.postalCode,
    city: row.city,
    line1: row.line1,
    line2: row.line2 ?? undefined,
    isDefault: row.isDefault,
  };
}

function formatAddress(
  addresses: CustomerWithAddresses["addresses"],
): string | null {
  const primary =
    addresses.find((address) => address.isDefault) ??
    addresses.find((address) => address.type === "BILLING") ??
    addresses[0];
  if (!primary) return null;
  return `${primary.postalCode} ${primary.city}, ${primary.line1}`.trim();
}

@Injectable()
export class CustomersRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async list(query: CustomerListQueryDto): Promise<CustomerListResponse> {
    // Source (UNAS/MANUAL) has no persisted column on Customer - it's derived
    // from ExternalReference existence (see ADR-0009) - so a source filter
    // resolves the matching id set first, then narrows the where-clause with
    // it. This keeps pagination/totalItems correct, unlike filtering the
    // already-paged result in memory.
    const unasCustomerIds = query.source
      ? await this.loadUnasCustomerIds()
      : null;
    const where: Prisma.CustomerWhereInput = {
      ...(query.status === "ALL" ? {} : { isActive: query.status === "ACTIVE" }),
      ...(query.source === "UNAS" ? { id: { in: unasCustomerIds! } } : {}),
      ...(query.source === "MANUAL" ? { id: { notIn: unasCustomerIds! } } : {}),
      ...(query.search
        ? {
            OR: [
              { displayName: { contains: query.search, mode: "insensitive" } },
              { companyName: { contains: query.search, mode: "insensitive" } },
              { email: { contains: query.search, mode: "insensitive" } },
              {
                customerNumber: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    };
    const [customers, totalItems] = await Promise.all([
      prisma.customer.findMany({
        where,
        include,
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.customer.count({ where }),
    ]);
    const referencesByCustomerId = await this.loadExternalReferences(
      customers.map((customer) => customer.id),
    );
    const items = customers.map((customer) =>
      this.toSummary(customer, referencesByCustomerId.get(customer.id) ?? null),
    );
    return {
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  private async loadUnasCustomerIds(): Promise<string[]> {
    const references = await prisma.externalReference.findMany({
      where: { system: "UNAS", entityType: EXTERNAL_ENTITY_TYPE },
      select: { entityId: true },
    });
    return references.map((reference) => reference.entityId);
  }

  async detail(id: string): Promise<CustomerDetail | null> {
    const customer = await prisma.customer.findUnique({
      where: { id },
      include,
    });
    if (!customer) return null;
    const reference = await prisma.externalReference.findUnique({
      where: {
        system_entityType_entityId: {
          system: "UNAS",
          entityType: EXTERNAL_ENTITY_TYPE,
          entityId: id,
        },
      },
    });
    return this.toDetail(customer, reference?.externalId ?? null);
  }

  create(input: CreateCustomerDto, actorId: string): Promise<CustomerDetail> {
    const customerNumber = generateCode("VEVO");
    return prisma.$transaction(
      async (tx) => {
        const customer = await tx.customer.create({
          data: {
            customerNumber,
            type: input.type,
            displayName: input.displayName.trim(),
            companyName: input.companyName?.trim(),
            taxNumber: input.taxNumber?.trim(),
            email: input.email?.trim(),
            phone: input.phone?.trim(),
            marketingEmailConsent: input.marketingEmailConsent ?? false,
            marketingSmsConsent: input.marketingSmsConsent ?? false,
            addresses: {
              create: input.addresses.map((address) => ({
                type: address.type,
                name: address.name?.trim(),
                country: address.country ?? "HU",
                postalCode: address.postalCode.trim(),
                city: address.city.trim(),
                line1: address.line1.trim(),
                line2: address.line2?.trim(),
                isDefault: address.isDefault ?? false,
              })),
            },
          },
          include,
        });
        await this.event(tx, "customer.created", customer.id, actorId, {
          customerNumber: customer.customerNumber,
          customerType: customer.type,
        });
        return this.toDetail(customer, null);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  update(
    id: string,
    input: UpdateCustomerDto,
    actorId: string,
  ): Promise<CustomerDetail> {
    return prisma.$transaction(
      async (tx) => {
        const existing = await tx.customer.findUniqueOrThrow({ where: { id } });
        const changed = await tx.customer.updateMany({
          where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
          data: {
            displayName: input.displayName?.trim(),
            companyName: input.companyName,
            taxNumber: input.taxNumber,
            email: input.email,
            phone: input.phone,
            marketingEmailConsent: input.marketingEmailConsent,
            marketingSmsConsent: input.marketingSmsConsent,
          },
        });
        if (changed.count !== 1) throw new Error("STALE_UPDATE");
        await this.event(tx, "customer.updated", id, actorId, {
          previousDisplayName: existing.displayName,
          displayName: input.displayName ?? existing.displayName,
        });
        const customer = await tx.customer.findUniqueOrThrow({
          where: { id },
          include,
        });
        const reference = await tx.externalReference.findUnique({
          where: {
            system_entityType_entityId: {
              system: "UNAS",
              entityType: EXTERNAL_ENTITY_TYPE,
              entityId: id,
            },
          },
        });
        return this.toDetail(customer, reference?.externalId ?? null);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async loadExternalReferences(
    customerIds: string[],
  ): Promise<Map<string, string>> {
    if (customerIds.length === 0) return new Map();
    const references = await prisma.externalReference.findMany({
      where: {
        system: "UNAS",
        entityType: EXTERNAL_ENTITY_TYPE,
        entityId: { in: customerIds },
      },
    });
    return new Map(
      references.map((reference) => [reference.entityId, reference.externalId]),
    );
  }

  private toSummary(
    customer: CustomerWithAddresses,
    unasExternalId: string | null,
  ): CustomerSummary {
    return {
      id: customer.id,
      customerNumber: customer.customerNumber,
      partnerCode: unasExternalId ?? customer.customerNumber,
      source: unasExternalId ? "UNAS" : "MANUAL",
      type: customer.type,
      displayName: customer.displayName,
      companyName: customer.companyName ?? undefined,
      email: customer.email ?? undefined,
      phone: customer.phone ?? undefined,
      isActive: customer.isActive,
      archivedAt: customer.archivedAt?.toISOString(),
      address: formatAddress(customer.addresses),
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
    };
  }

  private toDetail(
    customer: CustomerWithAddresses,
    unasExternalId: string | null,
  ): CustomerDetail {
    return {
      ...this.toSummary(customer, unasExternalId),
      taxNumber: customer.taxNumber ?? undefined,
      marketingEmailConsent: customer.marketingEmailConsent,
      marketingSmsConsent: customer.marketingSmsConsent,
      addresses: customer.addresses.map(toAddress),
    };
  }

  private event(
    tx: Prisma.TransactionClient,
    eventType: string,
    aggregateId: string,
    actorUserId: string,
    payload: Prisma.JsonObject,
  ) {
    return tx.domainEvent.create({
      data: {
        id: randomUUID(),
        eventType,
        aggregateType: "Customer",
        aggregateId,
        actorUserId,
        payload,
        occurredAt: new Date(),
        schemaVersion: 1,
      },
    });
  }
}
