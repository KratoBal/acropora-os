import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  AssetAddressSummary,
  AssetDetail,
  AssetEventSummary,
  AssetHierarchyItem,
  AssetListItem,
  AssetListResponse,
} from "@acropora/types";

import { generateCode } from "../common/code-generator.util.js";
import type {
  AssetListQueryDto,
  CreateAssetDto,
  UpdateAssetDto,
} from "./dto/asset.dto.js";
import {
  assetDetailInclude,
  assetSummaryInclude,
  type AssetDetailRow,
  type AssetSummaryRow,
} from "./service-assets.types.js";

function optionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.trim() || null;
}

function optionalDate(value: string | null | undefined) {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(value);
}

function hierarchyItem(row: {
  id: string;
  assetNumber: string;
  name: string;
  kind: AssetHierarchyItem["kind"];
  status: AssetHierarchyItem["status"];
}): AssetHierarchyItem {
  return {
    id: row.id,
    assetNumber: row.assetNumber,
    name: row.name,
    kind: row.kind,
    status: row.status,
  };
}

function addressSummary(
  row: AssetSummaryRow["customerAddress"],
): AssetAddressSummary | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name ?? undefined,
    formatted: `${row.postalCode} ${row.city}, ${row.line1}${row.line2 ? `, ${row.line2}` : ""}`,
  };
}

function jsonPayload(value: Record<string, unknown>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

@Injectable()
export class ServiceAssetsRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async list(query: AssetListQueryDto): Promise<AssetListResponse> {
    const where: Prisma.AssetWhereInput = {
      ...(query.status === "ALL" ? {} : { status: query.status }),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.aquariumId ? { aquariumId: query.aquariumId } : {}),
      ...(query.parentAssetId ? { parentAssetId: query.parentAssetId } : {}),
      ...(query.dueBefore
        ? { nextServiceAt: { lte: new Date(query.dueBefore) } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { assetNumber: { contains: query.search, mode: "insensitive" } },
              { name: { contains: query.search, mode: "insensitive" } },
              { manufacturer: { contains: query.search, mode: "insensitive" } },
              { model: { contains: query.search, mode: "insensitive" } },
              { serialNumber: { contains: query.search, mode: "insensitive" } },
              { inventoryNumber: { contains: query.search, mode: "insensitive" } },
              {
                customer: {
                  displayName: { contains: query.search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const [rows, totalItems] = await Promise.all([
      prisma.asset.findMany({
        where,
        include: assetSummaryInclude,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.asset.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.toListItem(row)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  }

  async detail(id: string): Promise<AssetDetail | null> {
    const row = await prisma.asset.findUnique({
      where: { id },
      include: assetDetailInclude,
    });
    return row ? this.toDetail(row, await this.ancestors(row.parentAssetId)) : null;
  }

  async detailByQrToken(qrToken: string): Promise<AssetDetail | null> {
    const row = await prisma.asset.findUnique({
      where: { qrToken },
      include: assetDetailInclude,
    });
    return row ? this.toDetail(row, await this.ancestors(row.parentAssetId)) : null;
  }

  async validationContext(input: {
    customerId: string;
    customerAddressId?: string | null;
    aquariumId?: string | null;
    parentAssetId?: string | null;
    productVariantId?: string | null;
  }) {
    const [customer, address, aquarium, parent, productVariant] =
      await Promise.all([
        prisma.customer.findUnique({
          where: { id: input.customerId },
          select: { id: true, isActive: true },
        }),
        input.customerAddressId
          ? prisma.customerAddress.findUnique({
              where: { id: input.customerAddressId },
              select: { id: true, customerId: true },
            })
          : null,
        input.aquariumId
          ? prisma.aquarium.findUnique({
              where: { id: input.aquariumId },
              select: { id: true, customerId: true, isActive: true },
            })
          : null,
        input.parentAssetId
          ? prisma.asset.findUnique({
              where: { id: input.parentAssetId },
              select: {
                id: true,
                customerId: true,
                customerAddressId: true,
                aquariumId: true,
                status: true,
              },
            })
          : null,
        input.productVariantId
          ? prisma.productVariant.findUnique({
              where: { id: input.productVariantId },
              select: { id: true, isActive: true },
            })
          : null,
      ]);
    return { customer, address, aquarium, parent, productVariant };
  }

  async basic(id: string) {
    return prisma.asset.findUnique({
      where: { id },
      select: {
        id: true,
        customerId: true,
        customerAddressId: true,
        aquariumId: true,
        parentAssetId: true,
        productVariantId: true,
        status: true,
        updatedAt: true,
        _count: { select: { childAssets: true } },
      },
    });
  }

  async wouldCreateCycle(assetId: string, parentAssetId: string) {
    let currentId: string | null = parentAssetId;
    const visited = new Set<string>();
    while (currentId) {
      if (currentId === assetId) return true;
      if (visited.has(currentId)) return true;
      visited.add(currentId);
      const row: { parentAssetId: string | null } | null =
        await prisma.asset.findUnique({
          where: { id: currentId },
          select: { parentAssetId: true },
        });
      currentId = row?.parentAssetId ?? null;
    }
    return false;
  }

  async create(
    input: CreateAssetDto,
    actorUserId: string,
  ): Promise<AssetDetail> {
    const id = await prisma.$transaction(
      async (tx) => {
        const row = await tx.asset.create({
          data: {
            assetNumber: generateCode("ESZK"),
            customerId: input.customerId,
            customerAddressId: input.customerAddressId,
            aquariumId: input.aquariumId,
            parentAssetId: input.parentAssetId,
            productVariantId: input.productVariantId,
            kind: input.kind,
            status: input.status,
            criticality: input.criticality,
            name: input.name.trim(),
            category: optionalText(input.category),
            manufacturer: optionalText(input.manufacturer),
            model: optionalText(input.model),
            serialNumber: optionalText(input.serialNumber),
            inventoryNumber: optionalText(input.inventoryNumber),
            description: optionalText(input.description),
            installedAt: optionalDate(input.installedAt),
            purchasedAt: optionalDate(input.purchasedAt),
            warrantyExpiresAt: optionalDate(input.warrantyExpiresAt),
            serviceIntervalDays: input.serviceIntervalDays,
            lastServicedAt: optionalDate(input.lastServicedAt),
            nextServiceAt: optionalDate(input.nextServiceAt),
            notes: optionalText(input.notes),
            archivedAt: input.status === "RETIRED" ? new Date() : undefined,
            createdById: actorUserId,
            updatedById: actorUserId,
          },
          include: assetDetailInclude,
        });
        await tx.assetEvent.create({
          data: {
            id: randomUUID(),
            assetId: row.id,
            type: "CREATED",
            actorUserId,
            payload: jsonPayload({
              assetNumber: row.assetNumber,
              customerId: row.customerId,
              parentAssetId: row.parentAssetId,
              status: row.status,
            }),
          },
        });
        return row.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    const detail = await this.detail(id);
    if (!detail) throw new Error("ASSET_CREATE_READBACK_FAILED");
    return detail;
  }

  async update(
    id: string,
    input: UpdateAssetDto,
    actorUserId: string,
  ): Promise<AssetDetail> {
    const updatedId = await prisma.$transaction(
      async (tx) => {
        if (input.parentAssetId) {
          // Serialize hierarchy mutations so two concurrent re-parenting
          // requests cannot both pass cycle validation and create A -> B -> A.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('acropora:asset-hierarchy'))`;
          let ancestorId: string | null = input.parentAssetId;
          const visited = new Set<string>();
          while (ancestorId) {
            if (ancestorId === id || visited.has(ancestorId))
              throw new Error("ASSET_HIERARCHY_CYCLE");
            visited.add(ancestorId);
            const ancestor: { parentAssetId: string | null } | null =
              await tx.asset.findUnique({
                where: { id: ancestorId },
                select: { parentAssetId: true },
              });
            ancestorId = ancestor?.parentAssetId ?? null;
          }
        }
        const existing = await tx.asset.findUniqueOrThrow({ where: { id } });
        const data: Prisma.AssetUncheckedUpdateManyInput = {
          customerAddressId: input.customerAddressId,
          aquariumId: input.aquariumId,
          parentAssetId: input.parentAssetId,
          productVariantId: input.productVariantId,
          kind: input.kind,
          status: input.status,
          criticality: input.criticality,
          name: input.name?.trim(),
          category: optionalText(input.category),
          manufacturer: optionalText(input.manufacturer),
          model: optionalText(input.model),
          serialNumber: optionalText(input.serialNumber),
          inventoryNumber: optionalText(input.inventoryNumber),
          description: optionalText(input.description),
          installedAt: optionalDate(input.installedAt),
          purchasedAt: optionalDate(input.purchasedAt),
          warrantyExpiresAt: optionalDate(input.warrantyExpiresAt),
          serviceIntervalDays: input.serviceIntervalDays,
          lastServicedAt: optionalDate(input.lastServicedAt),
          nextServiceAt: optionalDate(input.nextServiceAt),
          notes: optionalText(input.notes),
          archivedAt:
            input.status === "RETIRED"
              ? existing.archivedAt ?? new Date()
              : input.status
                ? null
                : undefined,
          updatedById: actorUserId,
        };
        const changed = await tx.asset.updateMany({
          where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
          data,
        });
        if (changed.count !== 1) throw new Error("STALE_UPDATE");

        const updated = await tx.asset.findUniqueOrThrow({ where: { id } });
        const events: Array<{
          type:
            | "UPDATED"
            | "PLACEMENT_CHANGED"
            | "PARENT_CHANGED"
            | "STATUS_CHANGED";
          payload: Prisma.InputJsonObject;
        }> = [];
        if (existing.status !== updated.status)
          events.push({
            type: "STATUS_CHANGED",
            payload: jsonPayload({ from: existing.status, to: updated.status }),
          });
        if (
          existing.customerAddressId !== updated.customerAddressId ||
          existing.aquariumId !== updated.aquariumId
        )
          events.push({
            type: "PLACEMENT_CHANGED",
            payload: jsonPayload({
              from: {
                customerAddressId: existing.customerAddressId,
                aquariumId: existing.aquariumId,
              },
              to: {
                customerAddressId: updated.customerAddressId,
                aquariumId: updated.aquariumId,
              },
            }),
          });
        if (existing.parentAssetId !== updated.parentAssetId)
          events.push({
            type: "PARENT_CHANGED",
            payload: jsonPayload({
              from: existing.parentAssetId,
              to: updated.parentAssetId,
            }),
          });
        const generalFields = Object.keys(input).filter(
          (key) =>
            ![
              "expectedUpdatedAt",
              "status",
              "customerAddressId",
              "aquariumId",
              "parentAssetId",
            ].includes(key),
        );
        if (generalFields.length > 0 || events.length === 0)
          events.push({
            type: "UPDATED",
            payload: jsonPayload({ fields: generalFields }),
          });
        await tx.assetEvent.createMany({
          data: events.map((event) => ({
            id: randomUUID(),
            assetId: id,
            actorUserId,
            type: event.type,
            payload: event.payload,
          })),
        });
        return id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    const detail = await this.detail(updatedId);
    if (!detail) throw new Error("ASSET_UPDATE_READBACK_FAILED");
    return detail;
  }

  async rotateQr(id: string, actorUserId: string): Promise<AssetDetail> {
    const updatedId = await prisma.$transaction(
      async (tx) => {
        const row = await tx.asset.update({
          where: { id },
          data: { qrToken: randomUUID(), updatedById: actorUserId },
          include: assetDetailInclude,
        });
        await tx.assetEvent.create({
          data: {
            id: randomUUID(),
            assetId: id,
            type: "QR_ROTATED",
            actorUserId,
            payload: { reason: "manual-rotation" },
          },
        });
        return row.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    const detail = await this.detail(updatedId);
    if (!detail) throw new Error("ASSET_QR_READBACK_FAILED");
    return detail;
  }

  private async ancestors(parentAssetId: string | null) {
    const ancestors: AssetHierarchyItem[] = [];
    const visited = new Set<string>();
    let currentId = parentAssetId;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const row = await prisma.asset.findUnique({
        where: { id: currentId },
        select: {
          id: true,
          assetNumber: true,
          name: true,
          kind: true,
          status: true,
          parentAssetId: true,
        },
      });
      if (!row) break;
      ancestors.unshift(hierarchyItem(row));
      currentId = row.parentAssetId;
    }
    return ancestors;
  }

  private toListItem(row: AssetSummaryRow): AssetListItem {
    return {
      ...hierarchyItem(row),
      criticality: row.criticality,
      customer: {
        id: row.customer.id,
        customerNumber: row.customer.customerNumber,
        displayName: row.customer.displayName,
      },
      address: addressSummary(row.customerAddress),
      aquarium: row.aquarium
        ? {
            id: row.aquarium.id,
            aquariumNumber: row.aquarium.aquariumNumber,
            name: row.aquarium.name,
          }
        : undefined,
      parent: row.parentAsset ? hierarchyItem(row.parentAsset) : undefined,
      manufacturer: row.manufacturer ?? undefined,
      model: row.model ?? undefined,
      serialNumber: row.serialNumber ?? undefined,
      nextServiceAt: row.nextServiceAt?.toISOString(),
      childCount: row._count.childAssets,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetail(
    row: AssetDetailRow,
    ancestors: AssetHierarchyItem[],
  ): AssetDetail {
    return {
      ...this.toListItem(row),
      qrToken: row.qrToken,
      category: row.category ?? undefined,
      inventoryNumber: row.inventoryNumber ?? undefined,
      description: row.description ?? undefined,
      installedAt: row.installedAt?.toISOString(),
      purchasedAt: row.purchasedAt?.toISOString(),
      warrantyExpiresAt: row.warrantyExpiresAt?.toISOString(),
      serviceIntervalDays: row.serviceIntervalDays ?? undefined,
      lastServicedAt: row.lastServicedAt?.toISOString(),
      notes: row.notes ?? undefined,
      archivedAt: row.archivedAt?.toISOString(),
      product: row.productVariant
        ? {
            variantId: row.productVariant.id,
            sku: row.productVariant.sku,
            name: row.productVariant.name ?? row.productVariant.product.name,
          }
        : undefined,
      ancestors,
      children: row.childAssets.map(hierarchyItem),
      events: row.events.map(
        (event): AssetEventSummary => ({
          id: event.id,
          type: event.type,
          actor: event.actorUser
            ? {
                id: event.actorUser.id,
                displayName: event.actorUser.displayName,
              }
            : undefined,
          payload: event.payload as Record<string, unknown>,
          occurredAt: event.occurredAt.toISOString(),
        }),
      ),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
