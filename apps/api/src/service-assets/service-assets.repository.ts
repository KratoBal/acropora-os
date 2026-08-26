import { createHash, randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  AssetAddressSummary,
  AssetDetail,
  AssetDocumentSummary,
  AssetEventSummary,
  AssetHierarchyItem,
  AssetListItem,
  AssetListResponse,
  AssetOwnerListResponse,
  AssetOwnerType,
} from "@acropora/types";

import { generateCode } from "../common/code-generator.util.js";
import type {
  AssetListQueryDto,
  CreateAssetDto,
  UpdateAssetDto,
} from "./dto/asset.dto.js";
import {
  SERVICE_OWNER_WHERE,
  assetDetailInclude,
  assetOwnerScopeWhere,
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

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
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

function supplierAddressSummary(
  row: AssetSummaryRow["supplier"],
): AssetAddressSummary | undefined {
  if (!row) return undefined;
  const formatted = [
    [row.postalCode, row.city].filter(Boolean).join(" "),
    row.addressLine1,
    row.addressLine2,
  ]
    .filter(Boolean)
    .join(", ");
  return formatted
    ? { id: `supplier:${row.id}`, name: undefined, formatted }
    : undefined;
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
      ...assetOwnerScopeWhere(query.ownerScope),
      ...(query.status === "ALL" ? {} : { status: query.status }),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.ownerType === "CUSTOMER" && query.ownerId
        ? { customerId: query.ownerId }
        : query.ownerType === "SUPPLIER" && query.ownerId
          ? { supplierId: query.ownerId }
          : {}),
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
              {
                inventoryNumber: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
              {
                customer: {
                  displayName: { contains: query.search, mode: "insensitive" },
                },
              },
              {
                supplier: {
                  name: { contains: query.search, mode: "insensitive" },
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

  /**
   * KI VÁLASZTHATÓ AZ ESZKÖZ TULAJDONOSÁNAK.
   *
   * A lista a SZERVIZ-jelölt partnereké. A `keep` az az egy tulajdonos, aki már
   * rá van írva egy MEGLÉVŐ eszközre: azt akkor is visszaadjuk, ha ma nem lenne
   * választható, mert a szerkesztő képernyő különben üres mezőt mutatna a
   * helyén, és a mentés vagy elakadna, vagy csendben más tulajdonost írna oda.
   * A sor megjelölve jön (`outsideServiceScope`), tehát a felület meg tudja
   * mutatni, hogy ez örökölt érték, nem ajánlat.
   */
  async owners(
    keep?: { type: AssetOwnerType; id: string } | null,
  ): Promise<AssetOwnerListResponse> {
    const suppliers = await prisma.supplier.findMany({
      where: SERVICE_OWNER_WHERE,
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const items: AssetOwnerListResponse["items"] = [
      ...suppliers.map((supplier) => {
        const formatted = [
          [supplier.postalCode, supplier.city].filter(Boolean).join(" "),
          supplier.addressLine1,
          supplier.addressLine2,
        ]
          .filter(Boolean)
          .join(", ");
        const address = formatted
          ? { id: `supplier:${supplier.id}`, formatted }
          : undefined;
        return {
          type: "SUPPLIER" as const,
          id: supplier.id,
          code: supplier.code,
          displayName: supplier.name,
          isActive: supplier.isActive,
          address,
          addresses: [],
        };
      }),
    ];

    const inherited =
      keep &&
      !items.some((item) => item.type === keep.type && item.id === keep.id)
        ? await this.ownerOutsideScope(keep)
        : null;

    return {
      items: [...items, ...(inherited ? [inherited] : [])].sort((left, right) =>
        left.displayName.localeCompare(right.displayName, "hu"),
      ),
    };
  }

  /**
   * Egy KONKRÉT tulajdonos, a szűrés megkerülésével, megjelölve.
   *
   * Az aktivitást sem nézi: egy inaktívvá tett partner is maradhat egy régi
   * eszközön, és az sem indok arra, hogy a szerkesztő elvegye.
   */
  private async ownerOutsideScope(keep: {
    type: AssetOwnerType;
    id: string;
  }): Promise<AssetOwnerListResponse["items"][number] | null> {
    if (keep.type === "SUPPLIER") {
      const supplier = await prisma.supplier.findUnique({
        where: { id: keep.id },
      });
      if (!supplier) return null;
      const formatted = [
        [supplier.postalCode, supplier.city].filter(Boolean).join(" "),
        supplier.addressLine1,
        supplier.addressLine2,
      ]
        .filter(Boolean)
        .join(", ");
      return {
        type: "SUPPLIER",
        id: supplier.id,
        code: supplier.code,
        displayName: supplier.name,
        isActive: supplier.isActive,
        address: formatted
          ? { id: `supplier:${supplier.id}`, formatted }
          : undefined,
        addresses: [],
        outsideServiceScope: true,
      };
    }

    const customer = await prisma.customer.findUnique({
      where: { id: keep.id },
      include: {
        addresses: { orderBy: [{ isDefault: "desc" }, { id: "asc" }] },
      },
    });
    if (!customer) return null;
    return {
      type: "CUSTOMER",
      id: customer.id,
      code: customer.customerNumber,
      displayName: customer.displayName,
      isActive: customer.isActive,
      addresses: customer.addresses.map((address) => ({
        id: address.id,
        name: address.name ?? undefined,
        formatted: `${address.postalCode} ${address.city}, ${address.line1}${address.line2 ? `, ${address.line2}` : ""}`,
      })),
      outsideServiceScope: true,
    };
  }

  async detail(id: string): Promise<AssetDetail | null> {
    const row = await prisma.asset.findUnique({
      where: { id },
      include: assetDetailInclude,
    });
    return row
      ? this.toDetail(row, await this.ancestors(row.parentAssetId))
      : null;
  }

  async detailByQrToken(qrToken: string): Promise<AssetDetail | null> {
    const row = await prisma.asset.findUnique({
      where: { qrToken },
      include: assetDetailInclude,
    });
    return row
      ? this.toDetail(row, await this.ancestors(row.parentAssetId))
      : null;
  }

  async validationContext(input: {
    ownerType: "CUSTOMER" | "SUPPLIER";
    ownerId: string;
    customerAddressId?: string | null;
    aquariumId?: string | null;
    parentAssetId?: string | null;
    productVariantId?: string | null;
  }) {
    const [customer, supplier, address, aquarium, parent, productVariant] =
      await Promise.all([
        input.ownerType === "CUSTOMER"
          ? prisma.customer.findUnique({
              where: { id: input.ownerId },
              select: { id: true, isActive: true },
            })
          : null,
        input.ownerType === "SUPPLIER"
          ? prisma.supplier.findUnique({
              where: { id: input.ownerId },
              select: { id: true, isActive: true },
            })
          : null,
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
                supplierId: true,
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
    return { customer, supplier, address, aquarium, parent, productVariant };
  }

  async basic(id: string) {
    return prisma.asset.findUnique({
      where: { id },
      select: {
        id: true,
        customerId: true,
        supplierId: true,
        customerAddressId: true,
        aquariumId: true,
        parentAssetId: true,
        productVariantId: true,
        status: true,
        installedAt: true,
        lastServicedAt: true,
        serviceIntervalDays: true,
        nextServiceAt: true,
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
            customerId: input.ownerType === "CUSTOMER" ? input.ownerId : null,
            supplierId: input.ownerType === "SUPPLIER" ? input.ownerId : null,
            customerAddressId:
              input.ownerType === "CUSTOMER" ? input.customerAddressId : null,
            aquariumId:
              input.ownerType === "CUSTOMER" ? input.aquariumId : null,
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
            nextServiceAt:
              optionalDate(input.nextServiceAt) ??
              (input.serviceIntervalDays
                ? addDays(
                    optionalDate(input.lastServicedAt) ??
                      optionalDate(input.installedAt) ??
                      new Date(),
                    input.serviceIntervalDays,
                  )
                : undefined),
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
              supplierId: row.supplierId,
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
        const maintenanceInputsChanged =
          input.serviceIntervalDays !== undefined ||
          input.lastServicedAt !== undefined ||
          input.installedAt !== undefined;
        const interval =
          input.serviceIntervalDays === undefined
            ? existing.serviceIntervalDays
            : input.serviceIntervalDays;
        const lastServicedAt =
          input.lastServicedAt === undefined
            ? existing.lastServicedAt
            : optionalDate(input.lastServicedAt);
        const installedAt =
          input.installedAt === undefined
            ? existing.installedAt
            : optionalDate(input.installedAt);
        const baseDate = lastServicedAt ?? installedAt ?? new Date();
        const data: Prisma.AssetUncheckedUpdateManyInput = {
          customerId:
            input.ownerType === undefined
              ? undefined
              : input.ownerType === "CUSTOMER"
                ? input.ownerId
                : null,
          supplierId:
            input.ownerType === undefined
              ? undefined
              : input.ownerType === "SUPPLIER"
                ? input.ownerId
                : null,
          customerAddressId:
            input.ownerType === "SUPPLIER" ? null : input.customerAddressId,
          aquariumId: input.ownerType === "SUPPLIER" ? null : input.aquariumId,
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
          nextServiceAt:
            input.nextServiceAt !== undefined
              ? optionalDate(input.nextServiceAt)
              : maintenanceInputsChanged
                ? interval
                  ? addDays(baseDate, interval)
                  : null
                : undefined,
          notes: optionalText(input.notes),
          archivedAt:
            input.status === "RETIRED"
              ? (existing.archivedAt ?? new Date())
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
          existing.customerId !== updated.customerId ||
          existing.supplierId !== updated.supplierId ||
          existing.customerAddressId !== updated.customerAddressId ||
          existing.aquariumId !== updated.aquariumId
        )
          events.push({
            type: "PLACEMENT_CHANGED",
            payload: jsonPayload({
              from: {
                customerId: existing.customerId,
                supplierId: existing.supplierId,
                customerAddressId: existing.customerAddressId,
                aquariumId: existing.aquariumId,
              },
              to: {
                customerId: updated.customerId,
                supplierId: updated.supplierId,
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
              "ownerType",
              "ownerId",
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

  async addDocument(input: {
    assetId: string;
    type: "INVOICE" | "WARRANTY" | "MANUAL" | "OTHER";
    fileName: string;
    content: Buffer;
    actorUserId: string;
  }): Promise<AssetDocumentSummary> {
    const id = randomUUID();
    const sha256 = createHash("sha256").update(input.content).digest("hex");
    await prisma.$transaction(async (tx) => {
      await tx.assetDocument.create({
        data: {
          id,
          assetId: input.assetId,
          type: input.type,
          fileName: input.fileName,
          contentType: "application/pdf",
          sizeBytes: input.content.length,
          sha256,
          content: Uint8Array.from(input.content),
          uploadedById: input.actorUserId,
        },
      });
      await tx.assetEvent.create({
        data: {
          id: randomUUID(),
          assetId: input.assetId,
          type: "DOCUMENT_UPLOADED",
          actorUserId: input.actorUserId,
          payload: {
            documentId: id,
            documentType: input.type,
            fileName: input.fileName,
          },
        },
      });
    });
    const document = await prisma.assetDocument.findUniqueOrThrow({
      where: { id },
      include: { uploadedBy: true },
    });
    return this.toDocumentSummary(document);
  }

  async document(assetId: string, documentId: string) {
    return prisma.assetDocument.findFirst({
      where: { id: documentId, assetId },
      select: { fileName: true, contentType: true, content: true },
    });
  }

  async deleteDocument(
    assetId: string,
    documentId: string,
    actorUserId: string,
  ) {
    return prisma.$transaction(async (tx) => {
      const document = await tx.assetDocument.findFirst({
        where: { id: documentId, assetId },
        select: { id: true, type: true, fileName: true },
      });
      if (!document) return false;
      await tx.assetDocument.delete({ where: { id: document.id } });
      await tx.assetEvent.create({
        data: {
          id: randomUUID(),
          assetId,
          type: "DOCUMENT_DELETED",
          actorUserId,
          payload: {
            documentId: document.id,
            documentType: document.type,
            fileName: document.fileName,
          },
        },
      });
      return true;
    });
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
    const owner = row.customer
      ? {
          type: "CUSTOMER" as const,
          id: row.customer.id,
          code: row.customer.customerNumber,
          displayName: row.customer.displayName,
        }
      : row.supplier
        ? {
            type: "SUPPLIER" as const,
            id: row.supplier.id,
            code: row.supplier.code,
            displayName: row.supplier.name,
          }
        : (() => {
            throw new Error("ASSET_OWNER_MISSING");
          })();
    return {
      ...hierarchyItem(row),
      criticality: row.criticality,
      owner,
      address:
        addressSummary(row.customerAddress) ??
        supplierAddressSummary(row.supplier),
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
      // A listában is kimegy, nem csak az adatlapon: a helyszíni katalógus
      // enélkül nem tudja feloldani a beolvasott kódot. Nem jár extra
      // adatbázis-költséggel - a lekérdezés `include`-ot használ, tehát a
      // mező már benne van a betöltött sorban.
      qrToken: row.qrToken,
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
      events: row.events.map((event): AssetEventSummary => ({
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
      })),
      documents: row.documents.map((document) =>
        this.toDocumentSummary(document),
      ),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toDocumentSummary(document: {
    id: string;
    type: AssetDocumentSummary["type"];
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    createdAt: Date;
    uploadedBy: { id: string; displayName: string } | null;
  }): AssetDocumentSummary {
    return {
      id: document.id,
      type: document.type,
      fileName: document.fileName,
      contentType: "application/pdf",
      sizeBytes: document.sizeBytes,
      sha256: document.sha256,
      uploadedBy: document.uploadedBy
        ? {
            id: document.uploadedBy.id,
            displayName: document.uploadedBy.displayName,
          }
        : undefined,
      createdAt: document.createdAt.toISOString(),
    };
  }
}
