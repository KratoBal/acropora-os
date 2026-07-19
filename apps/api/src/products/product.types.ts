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
    variants: true;
    channelListings: true;
    images: true;
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

export function toProductDetail(product: ProductWithRelations): ProductDetail {
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
    })),
    images: product.images.map(imageSummary),
    channelListings: product.channelListings.map(channelSummary),
  };
}
