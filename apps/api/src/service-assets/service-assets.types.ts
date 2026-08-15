import type { Prisma } from "@acropora/database";

export const assetSummaryInclude = {
  customer: true,
  customerAddress: true,
  aquarium: true,
  parentAsset: true,
  _count: { select: { childAssets: true } },
} satisfies Prisma.AssetInclude;

export const assetDetailInclude = {
  ...assetSummaryInclude,
  productVariant: { include: { product: true } },
  childAssets: { orderBy: [{ name: "asc" as const }, { id: "asc" as const }] },
  events: {
    include: { actorUser: true },
    orderBy: { occurredAt: "desc" as const },
    take: 100,
  },
} satisfies Prisma.AssetInclude;

export type AssetSummaryRow = Prisma.AssetGetPayload<{
  include: typeof assetSummaryInclude;
}>;

export type AssetDetailRow = Prisma.AssetGetPayload<{
  include: typeof assetDetailInclude;
}>;
