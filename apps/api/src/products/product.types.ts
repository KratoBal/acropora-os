import { Prisma } from "@acropora/database";
import type {
  ProductChannelListingSummary,
  ProductDetail,
  ProductImageSummary,
  ProductListItem,
} from "@acropora/types";

import { parseStoredUnasVariantValues } from "../common/unas-variant.util.js";

export type ProductWithRelations = Prisma.ProductGetPayload<{
  include: {
    brand: true;
    categories: { include: { category: true } };
    variants: {
      include: { extension: true; stockItems: true; barcodes: true };
    };
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

function packageComponents(
  value: Prisma.JsonValue | null | undefined,
): Array<{ sku: string; qty: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const sku = (item as Record<string, Prisma.JsonValue>).sku;
    const qty = (item as Record<string, Prisma.JsonValue>).qty;
    return typeof sku === "string" &&
      (typeof qty === "string" || typeof qty === "number")
      ? [{ sku, qty: String(qty) }]
      : [];
  });
}

/**
 * WHICH PRICE THE LIST SHOWS, AND WHY THE VALUE DOES NOT CHANGE HERE.
 *
 * The list price has one source and only one: the UNAS snapshot. That is fine
 * while the shop owns the product - the import keeps writing it. After an
 * authority takeover the import stops, so the same column goes on showing the
 * last price the shop had, and nothing on the row says which of the two it is.
 *
 * The product DETAIL screen already solves this by NAME: the same value appears
 * there under `unasMirror.grossPrice`, and a reader cannot mistake it for ours.
 * The list has no such name, so it gets the source as a field. This is the
 * existing habit carried through, not a new one.
 *
 * THE NUMBER IS DELIBERATELY UNCHANGED. We do have a price of our own
 * (`ProductVariant.sellingGrossPrice`, which the Medusa projection uses), and
 * showing it here instead would decide, on the business's behalf, what a
 * colleague sees on a screen they use today. That is a decision for the owner,
 * not a side effect of adding a label. What is forbidden is the SILENCE, not
 * the value.
 */
export type ProductListPriceSource = "unas" | "unas_frozen" | "none";

export function listPriceSource(product: {
  catalogAuthority: string | null;
  unasSnapshot: { grossPrice: unknown } | null;
}): ProductListPriceSource {
  if (!product.unasSnapshot) return "none";

  return product.catalogAuthority === "ACROPORA" ? "unas_frozen" : "unas";
}

export function toProductListItem(
  product: ProductWithRelations,
): ProductListItem {
  const primaryCategory = product.categories.find((item) => item.isPrimary);
  const unasListing = product.channelListings.find(
    (listing) => listing.channel === "UNAS",
  );
  const primaryVariant = product.variants.find((variant) => variant.isActive);
  const stockItems = product.variants
    .filter((variant) => variant.isActive)
    .flatMap((variant) => variant.stockItems);

  return {
    id: product.id,
    name: product.name,
    productType: product.type,
    origin: product.origin,
    catalogAuthority: product.catalogAuthority,
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
    primarySku: primaryVariant?.unasBaseSku ?? primaryVariant?.sku ?? null,
    thumbnail: product.images[0] ? imageSummary(product.images[0]) : null,
    unasListing: unasListing ? channelSummary(unasListing) : null,
    grossPrice: product.unasSnapshot?.grossPrice?.toString() ?? null,
    saleGrossPrice: product.unasSnapshot?.saleGrossPrice?.toString() ?? null,
    priceSource: listPriceSource(product),
    stockOnHand:
      !product.unasSnapshot?.isPackageProduct && stockItems.length > 0
        ? stockItems
            .reduce((sum, item) => sum.plus(item.onHand), new Prisma.Decimal(0))
            .toString()
        : null,
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
    webshopSellable: product.webshopSellable,
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
      unasBaseSku: variant.unasBaseSku,
      unasVariantValues: parseStoredUnasVariantValues(
        variant.unasVariantValues,
      ),
      unasReportedStock: variant.unasReportedStock?.toString() ?? null,
      unasReportedStockSyncedAt:
        variant.unasReportedStockSyncedAt?.toISOString() ?? null,
      barcodes: variant.barcodes.map((barcode) => ({
        id: barcode.id,
        code: barcode.code,
        isPrimary: barcode.isPrimary,
      })),
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
            isPackageProduct: snapshot?.isPackageProduct ?? false,
            packageComponents: packageComponents(snapshot?.packageComponents),
          }
        : null,
  };
}
