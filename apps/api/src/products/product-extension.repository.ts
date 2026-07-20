import { randomUUID } from "node:crypto";

import { Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type { ProductExtensionDetail } from "@acropora/types";

import type { UpsertProductExtensionDto } from "./dto/upsert-product-extension.dto.js";

type ExtensionRecord = NonNullable<
  Awaited<ReturnType<typeof prisma.productExtension.findUnique>>
>;
interface ProductExtensionTransaction {
  productExtension: {
    findUnique(args: unknown): Promise<ExtensionRecord | null>;
    upsert(args: unknown): Promise<ExtensionRecord>;
  };
  auditLog: { create(args: unknown): Promise<unknown> };
  domainEvent: { create(args: unknown): Promise<unknown> };
}

export interface ProductExtensionDatabase {
  productVariant: {
    findUnique(args: unknown): Promise<{ id: string } | null>;
  };
  productExtension: {
    findUnique(args: unknown): Promise<ExtensionRecord | null>;
  };
  $transaction<T>(
    operation: (transaction: ProductExtensionTransaction) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
}

export const PRODUCT_EXTENSION_DATABASE = Symbol("PRODUCT_EXTENSION_DATABASE");
const auditFields = [
  "preferredSupplierId",
  "defaultPurchaseCurrency",
  "defaultWarehouseId",
  "defaultLocationId",
  "minimumStock",
  "optimalStock",
  "reorderPoint",
  "safetyStock",
  "stockTrackingEnabled",
  "purchasingDisabled",
  "phaseOut",
  "autoReorderEnabled",
  "internalNote",
] as const satisfies readonly (keyof UpsertProductExtensionDto)[];

const comparable = (value: unknown) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "object" && "toString" in value) return String(value);
  return value;
};

function toDetail(extension: ExtensionRecord): ProductExtensionDetail {
  return {
    variantId: extension.variantId,
    preferredSupplierId: extension.preferredSupplierId,
    defaultPurchaseCurrency: extension.defaultPurchaseCurrency,
    defaultWarehouseId: extension.defaultWarehouseId,
    defaultLocationId: extension.defaultLocationId,
    minimumStock: extension.minimumStock?.toString() ?? null,
    optimalStock: extension.optimalStock?.toString() ?? null,
    reorderPoint: extension.reorderPoint?.toString() ?? null,
    safetyStock: extension.safetyStock?.toString() ?? null,
    stockTrackingEnabled: extension.stockTrackingEnabled,
    purchasingDisabled: extension.purchasingDisabled,
    phaseOut: extension.phaseOut,
    autoReorderEnabled: extension.autoReorderEnabled,
    internalNote: extension.internalNote,
    updatedAt: extension.updatedAt.toISOString(),
  };
}

@Injectable()
export class ProductExtensionRepository extends Repository {
  private readonly extensionDatabase: ProductExtensionDatabase;

  constructor(
    @Optional()
    @Inject(PRODUCT_EXTENSION_DATABASE)
    database?: ProductExtensionDatabase,
  ) {
    super(prisma);
    this.extensionDatabase =
      database ?? (prisma as unknown as ProductExtensionDatabase);
  }

  async variantExists(variantId: string): Promise<boolean> {
    return Boolean(
      await this.extensionDatabase.productVariant.findUnique({
        where: { id: variantId },
        select: { id: true },
      }),
    );
  }

  async findByVariantId(
    variantId: string,
  ): Promise<ProductExtensionDetail | null> {
    const extension = await this.extensionDatabase.productExtension.findUnique({
      where: { variantId },
    });
    return extension ? toDetail(extension) : null;
  }

  async upsert(
    variantId: string,
    input: UpsertProductExtensionDto,
    actorUserId: string,
  ): Promise<ProductExtensionDetail> {
    return this.extensionDatabase.$transaction(
      async (transaction) => {
        const existing = await transaction.productExtension.findUnique({
          where: { variantId },
        });
        const changedFields = auditFields.filter(
          (field) =>
            input[field] !== undefined &&
            comparable(input[field]) !== comparable(existing?.[field]),
        );
        if (existing && !changedFields.length) return toDetail(existing);

        const extension = await transaction.productExtension.upsert({
          where: { variantId },
          update: input,
          create: { variantId, ...input },
        });
        const action = existing
          ? "product_extension.updated"
          : "product_extension.created";
        const metadata = {
          variantId,
          changedFields: existing
            ? changedFields
            : auditFields.filter((field) => input[field] !== undefined),
        } satisfies Prisma.JsonObject;
        await transaction.auditLog.create({
          data: {
            userId: actorUserId,
            action,
            entityType: "ProductExtension",
            entityId: extension.id,
            metadata,
          },
        });
        await transaction.domainEvent.create({
          data: {
            id: randomUUID(),
            eventType: action,
            aggregateType: "ProductVariant",
            aggregateId: variantId,
            actorUserId,
            payload: metadata,
            occurredAt: new Date(),
          },
        });
        return toDetail(extension);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
