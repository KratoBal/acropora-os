import type { Prisma } from "@acropora/database";

export type ProductWithRelations = Prisma.ProductGetPayload<{
  include: { brand: true; category: true; variants: true };
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
