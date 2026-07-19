import type { Prisma } from "@acropora/database";

export type ProductWithRelations = Prisma.ProductGetPayload<{
  include: {
    brand: true;
    categories: { include: { category: true } };
    variants: true;
    channelListings: true;
    images: true;
  };
}>;

export interface ProductListResult {
  items: ProductWithRelations[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}
