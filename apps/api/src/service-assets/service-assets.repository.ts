import {
  rowBelongsToScope,
  scopeMaySeeDocumentType,
  type PartnerScope,
} from "../auth/partner-scope.util.js";

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

import { withUniqueCode } from "../common/unique-code.util.js";
import { buildUnitPaths } from "./unit-path.js";
import type {
  AssetListQueryDto,
  CreateAssetDto,
  UpdateAssetDto,
} from "./dto/asset.dto.js";
import {
  SERVICE_OWNER_PICKABLE_WHERE,
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
    const paths = await this.unitPaths(rows);
    return {
      items: rows.map((row) => this.toListItem(row, paths)),
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
      where: SERVICE_OWNER_PICKABLE_WHERE,
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

  /**
   * A KOTELEZO `scope` a mechanizmus maga (lasd a partner-scope.util.ts
   * jegyzetet): elem-lekeresnel az elfelejtett ellenorzes NEMA. Az ellenorzes a
   * BETOLTOTT soron all, es a nem egyezo sor `null` -- tehat 404, nem 403.
   *
   * AZ ESZKOZ KET OLDALON KOTODHET (`customerId` VAGY `supplierId`), es a
   * `rowBelongsToScope` pont ezt kezeli: egy vevo-hatokoru kero nem lat
   * szerviz-partner eszkozt attol, hogy a masik oszlopban all az azonosito.
   */
  async detail(id: string, scope: PartnerScope): Promise<AssetDetail | null> {
    const row = await prisma.asset.findUnique({
      where: { id },
      include: assetDetailInclude,
    });
    if (!row) return null;
    if (!rowBelongsToScope(row, scope)) return null;
    return this.toDetail(
      row,
      await this.ancestors(row.parentAssetId),
      await this.unitPaths([row]),
    );
  }

  async detailByQrToken(qrToken: string): Promise<AssetDetail | null> {
    const row = await prisma.asset.findUnique({
      where: { qrToken },
      include: assetDetailInclude,
    });
    return row
      ? this.toDetail(
          row,
          await this.ancestors(row.parentAssetId),
          await this.unitPaths([row]),
        )
      : null;
  }

  async validationContext(input: {
    ownerType: "CUSTOMER" | "SUPPLIER";
    ownerId: string;
    customerAddressId?: string | null;
    departmentId?: string | null;
    aquariumId?: string | null;
    parentAssetId?: string | null;
    productVariantId?: string | null;
  }) {
    const [
      customer,
      supplier,
      address,
      department,
      aquarium,
      parent,
      productVariant,
    ] = await Promise.all([
      input.ownerType === "CUSTOMER"
        ? prisma.customer.findUnique({
            where: { id: input.ownerId },
            select: { id: true, isActive: true },
          })
        : null,
      input.ownerType === "SUPPLIER"
        ? prisma.supplier.findUnique({
            where: { id: input.ownerId },
            // `customerId` a TÜKÖR vevő-sor: az alegységek azon lógnak, nem
            // magán a szállítón.
            select: { id: true, isActive: true, customerId: true },
          })
        : null,
      input.customerAddressId
        ? prisma.customerAddress.findUnique({
            where: { id: input.customerAddressId },
            select: { id: true, customerId: true },
          })
        : null,
      input.departmentId
        ? prisma.worksheetDepartment.findUnique({
            where: { id: input.departmentId },
            select: { id: true, customerId: true, isActive: true },
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
    return {
      customer,
      supplier,
      address,
      department,
      aquarium,
      parent,
      productVariant,
    };
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
    /**
     * AZ ESZKOZSZAM UTKOZESE UJRAPROBALKOZAST KAP. Ket eszkoz akkor kap azonos
     * szamot, ha ugyanabban a masodpercben keszul es a generator ugyanazt a
     * negyjegyu veget huzza. A burkolat CSAK a tranzakciot ismetli meg, UJ
     * kodddal; a tranzakcion BELUL nem lehet ujraprobalni, mert Postgres az
     * elso elbukott utasitas utan megszakitja.
     */
    const id = await withUniqueCode(
      /**
       * AZ EGYETLEN HELY, AHOL A BELYEG HELYI IDO SZERINT ALL.
       *
       * Az eszkozszam kerul CIMKERE, es ott egy ember olvassa le. A tobbi
       * csalad belyege UTC marad -- a beszerzesi bizonylatszam es a POS
       * rendelesszam kulso rendszerbe is kimegy, es azok alakjat ez a kor
       * szandekosan nem valtoztatja.
       *
       * A `h` a valtas jelolese: a mar kiadott szamok visszamenoleg nem
       * valtoznak, tehat jeloles nelkul ugyanaz a mezo ket dolgot jelentene,
       * kivulrol megkulonboztethetetlenul.
       */
      { prefix: "ESZK", field: "assetNumber", stamp: "local-marked" },
      (assetNumber) =>
        prisma.$transaction(
          async (tx) => {
            const row = await tx.asset.create({
              data: {
                assetNumber,
                customerId:
                  input.ownerType === "CUSTOMER" ? input.ownerId : null,
                supplierId:
                  input.ownerType === "SUPPLIER" ? input.ownerId : null,
                customerAddressId:
                  input.ownerType === "CUSTOMER"
                    ? input.customerAddressId
                    : null,
                aquariumId:
                  input.ownerType === "CUSTOMER" ? input.aquariumId : null,
                // Az alegyseg a masik iranyban all: SZERVIZ PARTNER eszkozehez
                // tartozik, vevoehez nem. A ket mezo nem ugyanaz a fogalom.
                departmentId:
                  input.ownerType === "SUPPLIER" ? input.departmentId : null,
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
        ),
    );
    const detail = await this.detail(id, {
      // BELSOS UT: irasi muvelet vegen a SAJAT, epp irt sort adjuk vissza. A
      // hivo vegpont SERVICE_MANAGE jog alatt all. A hatokort a kotelezo
      // parameter miatt ki KELL mondani, es ez helyes: itt nem szukitunk.
      kind: "internal",
    });
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
          // Vevo tulajdonosra valtaskor az alegyseg TORLODIK, ahogy a cim is
          // torlodik szallitora valtaskor: a ket mezo egymast zarja ki.
          departmentId:
            input.ownerType === "CUSTOMER" ? null : input.departmentId,
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
    const detail = await this.detail(updatedId, {
      // BELSOS UT: irasi muvelet vegen a SAJAT, epp irt sort adjuk vissza. A
      // hivo vegpont SERVICE_MANAGE jog alatt all. A hatokort a kotelezo
      // parameter miatt ki KELL mondani, es ez helyes: itt nem szukitunk.
      kind: "internal",
    });
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
    const detail = await this.detail(updatedId, {
      // BELSOS UT: irasi muvelet vegen a SAJAT, epp irt sort adjuk vissza. A
      // hivo vegpont SERVICE_MANAGE jog alatt all. A hatokort a kotelezo
      // parameter miatt ki KELL mondani, es ez helyes: itt nem szukitunk.
      kind: "internal",
    });
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

  /**
   * A DOKUMENTUMNAL KET ELLENORZES KELL, NEM EGY, es a masodik a tipuson all.
   *
   * 1. AZ ESZKOZ a keroe -- ugyanaz a szabaly, mint a tobbi elem-lekeresnel.
   * 2. A DOKUMENTUM TIPUSA engedett-e partner szamara. A tulajdonos-egyeztetes
   *    ONMAGABAN nem eleg: egy sajat eszkozhoz tartozo SZAMLA sem megy ki.
   *
   * A tipus-tablazat forrasa KULON van jelolve, mert nem mind ugyanonnan jon:
   *    INVOICE   nem     BALAZS DONTESE, szo szerint: "szamlat nem"
   *    WARRANTY  igen    a mi olvasatunk
   *    MANUAL    igen    a mi olvasatunk
   *    OTHER     nem     a mi olvasatunk -- es az indok NEM az, hogy alapertek
   *                      (a semaban nincs alapertelmezese), hanem hogy az OTHER
   *                      DEFINICIO SZERINT az, amit nem soroltak be, tehat a
   *                      tartalmarol nincs allitasunk. Ha kiderul, hogy kell
   *                      belole valami a partnernek, az EGY KERDES lesz, nem egy
   *                      csendes szivargas.
   */
  async document(assetId: string, documentId: string, scope: PartnerScope) {
    const row = await prisma.assetDocument.findFirst({
      where: { id: documentId, assetId },
      select: {
        fileName: true,
        contentType: true,
        content: true,
        type: true,
        asset: { select: { customerId: true, supplierId: true } },
      },
    });
    if (!row) return null;
    if (!rowBelongsToScope(row.asset, scope)) return null;
    if (!scopeMaySeeDocumentType(row.type, scope)) return null;
    return {
      fileName: row.fileName,
      contentType: row.contentType,
      content: row.content,
    };
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

  /**
   * AZ ALEGYSÉGEK TELJES ÚTJA, EGY KÖTEGBEN.
   *
   * Egy lekérdezés, nem soronként egy: az érintett partnerek ÖSSZES egységét
   * behúzzuk, és az utakat abból építjük. Egy partner egységei elférnek egy
   * kötegben (ugyanez az indok áll a partner képernyő lapos lekérdezésénél is),
   * és így egy száz soros lista sem lesz száz lekérdezés.
   *
   * Rekurzív SQL helyett azért ez: a fának NINCS mélység-korlátja, tehát egy
   * rögzített mélységű `include` csendben levágná a mély utakat -- pontosan azt
   * a hibát, ami ellen az egész mező készül.
   */
  private async unitPaths(
    rows: readonly AssetSummaryRow[],
  ): Promise<Map<string, string[]>> {
    const customerIds = [
      ...new Set(
        rows
          .map((row) => row.department?.customerId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (customerIds.length === 0) return new Map();
    const units = await prisma.worksheetDepartment.findMany({
      where: { customerId: { in: customerIds } },
      select: { id: true, name: true, parentId: true },
    });
    return buildUnitPaths(units);
  }

  private toListItem(
    row: AssetSummaryRow,
    paths: Map<string, string[]>,
  ): AssetListItem {
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
      // AZ ALEGYSEG A PONTOS HELY, a fenti `address` pedig a visszaeses:
      // partner-tulajdonosnal az a partner postai cime. A kettot a felulet
      // egyutt olvassa -- ha `unit` van, az a valasztott hely; ha nincs, az
      // `address` latszik, jelolve, hogy nem valasztas eredmenye.
      unit: row.department
        ? {
            id: row.department.id,
            code: row.department.code,
            name: row.department.name,
            // A `paths` KÖTELEZŐ paraméter, nem opcionális: ha elmaradna, a
            // fordító mutatja meg, hol -- egy néma visszaesés a levél nevére
            // pont az a hiba lenne, amit ez a mező megszüntet.
            path: paths.get(row.department.id) ?? [row.department.name],
          }
        : undefined,
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
      /**
       * AZ ÜGYFÉL SAJÁT KÓDJA A LISTASORON is, nem csak az adatlapon: a keresés
       * eddig is nézte, a sor viszont nem mutatta, tehát a találatról nem
       * látszott, MIRE illeszkedett. Nem jár extra adatbázis-költséggel, a mező
       * már benne van a betöltött sorban.
       */
      inventoryNumber: row.inventoryNumber ?? undefined,
      childCount: row._count.childAssets,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetail(
    row: AssetDetailRow,
    ancestors: AssetHierarchyItem[],
    paths: Map<string, string[]>,
  ): AssetDetail {
    return {
      ...this.toListItem(row, paths),
      category: row.category ?? undefined,
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
