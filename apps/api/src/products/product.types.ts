import type { Prisma } from "@acropora/database";
import type {
  ProductChannelListingSummary,
  ProductDetail,
  ProductImageSummary,
  ProductListItem,
} from "@acropora/types";

export type ProductWithRelations = Prisma.ProductGetPayload<{
  include: {
    brand: true;
    categories: { include: { category: true } };
    variants: { include: { extension: true } };
    channelListings: true;
    images: true;
    unasSnapshot: true;
  };
}>;

function imageSummary(
  image: ProductWithRelations["images"][number],
): ProductImageSummary {
  return {
    id: image.id,
    url: image.url,
    sortOrder: image.sortOrder,
    altText: image.altText,
    title: image.title,
  };
}

function channelSummary(
  listing: ProductWithRelations["channelListings"][number],
): ProductChannelListingSummary {
  return {
    channel: listing.channel,
    externalStatus: listing.externalStatus,
    isPublished: listing.isPublished,
    slug: listing.slug,
    productUrl: listing.productUrl,
    seoTitle: listing.seoTitle,
    backorderAllowed: listing.backorderAllowed,
  };
}

export function toProductListItem(
  product: ProductWithRelations,
): ProductListItem {
  const primaryCategory = product.categories.find((item) => item.isPrimary);
  const unasListing = product.channelListings.find(
    (listing) => listing.channel === "UNAS",
  );

  return {
    id: product.id,
    name: product.name,
    productType: product.type,
    isActive: product.isActive,
    archivedAt: product.archivedAt?.toISOString() ?? null,
    brand: product.brand
      ? { id: product.brand.id, name: product.brand.name }
      : null,
    primaryCategory: primaryCategory
      ? {
          id: primaryCategory.category.id,
          name: primaryCategory.category.name,
          isPrimary: true,
          sortOrder: primaryCategory.sortOrder,
        }
      : null,
    primarySku:
      product.variants.find((variant) => variant.isActive)?.sku ?? null,
    thumbnail: product.images[0] ? imageSummary(product.images[0]) : null,
    unasListing: unasListing ? channelSummary(unasListing) : null,
  };
}

export function toProductDetail(
  product: ProductWithRelations,
  externalId: string | null = null,
): ProductDetail {
  const snapshot = product.unasSnapshot;
  return {
    ...toProductListItem(product),
    description: product.description,
    categories: product.categories.map((item) => ({
      id: item.category.id,
      name: item.category.name,
      isPrimary: item.isPrimary,
      sortOrder: item.sortOrder,
    })),
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      unit: variant.unit,
      isActive: variant.isActive,
      vatRate: variant.vatRate?.toString() ?? null,
      manufacturerPartNumber: variant.manufacturerPartNumber,
      secondaryUnit: variant.secondaryUnit,
      secondaryUnitFactor: variant.secondaryUnitFactor?.toString() ?? null,
      extension: variant.extension
        ? {
            variantId: variant.id,
            preferredSupplierId: variant.extension.preferredSupplierId,
            defaultPurchaseCurrency: variant.extension.defaultPurchaseCurrency,
            defaultWarehouseId: variant.extension.defaultWarehouseId,
            defaultLocationId: variant.extension.defaultLocationId,
            minimumStock: variant.extension.minimumStock?.toString() ?? null,
            optimalStock: variant.extension.optimalStock?.toString() ?? null,
            reorderPoint: variant.extension.reorderPoint?.toString() ?? null,
            safetyStock: variant.extension.safetyStock?.toString() ?? null,
            lastPurchaseNetPrice:
              variant.extension.lastPurchaseNetPrice?.toString() ?? null,
            lastPurchaseVatRate:
              variant.extension.lastPurchaseVatRate?.toString() ?? null,
            stockTrackingEnabled: variant.extension.stockTrackingEnabled,
            purchasingDisabled: variant.extension.purchasingDisabled,
            phaseOut: variant.extension.phaseOut,
            autoReorderEnabled: variant.extension.autoReorderEnabled,
            internalNote: variant.extension.internalNote,
            updatedAt: variant.extension.updatedAt.toISOString(),
          }
        : null,
    })),
    images: product.images.map(imageSummary),
    channelListings: product.channelListings.map(channelSummary),
    unasMirror:
      product.mirrorSource === "UNAS"
        ? {
            source: "UNAS",
            state: product.mirrorState,
            externalId,
            sourceCreatedAt: product.sourceCreatedAt?.toISOString() ?? null,
            sourceUpdatedAt: product.sourceUpdatedAt?.toISOString() ?? null,
            lastSyncedAt: product.lastSyncedAt?.toISOString() ?? null,
            missingSince: product.missingSince?.toISOString() ?? null,
            currency: snapshot?.currency ?? null,
            netPrice: snapshot?.netPrice?.toString() ?? null,
            grossPrice: snapshot?.grossPrice?.toString() ?? null,
            saleNetPrice: snapshot?.saleNetPrice?.toString() ?? null,
            saleGrossPrice: snapshot?.saleGrossPrice?.toString() ?? null,
            saleStartsAt: snapshot?.saleStartsAt?.toISOString() ?? null,
            saleEndsAt: snapshot?.saleEndsAt?.toISOString() ?? null,
            priceDisplay: snapshot?.priceDisplay ?? null,
            productUrl: snapshot?.productUrl ?? null,
            manufacturerUrl: snapshot?.manufacturerUrl ?? null,
            minimumOrderQuantity:
              snapshot?.minimumOrderQuantity?.toString() ?? null,
            maximumOrderQuantity:
              snapshot?.maximumOrderQuantity?.toString() ?? null,
            orderQuantityStep: snapshot?.orderQuantityStep?.toString() ?? null,
            lowStockThreshold: snapshot?.lowStockThreshold?.toString() ?? null,
            backorderAllowed: snapshot?.backorderAllowed ?? null,
            variantStockEnabled: snapshot?.variantStockEnabled ?? null,
            reportedStock: snapshot?.reportedStock?.toString() ?? null,
            reportedStockSyncedAt:
              snapshot?.reportedStockSyncedAt?.toISOString() ?? null,
          }
        : null,
  };
}
