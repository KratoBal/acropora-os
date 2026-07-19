import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";

@Injectable()
export class UnasBrandReviewRepository extends Repository {
  constructor() {
    super(prisma);
  }

  getBatch(batchId: string) {
    return prisma.catalogImportBatch.findUnique({
      where: { id: batchId },
      include: {
        rows: { select: { status: true } },
        brandResolutionReviews: {
          include: { importRow: { select: { parsedPayload: true } } },
          orderBy: [{ sourceRowNumber: "asc" }, { id: "asc" }],
        },
      },
    });
  }

  async updateDecision(
    batchId: string,
    reviewId: string,
    expectedUpdatedAt: Date,
    data: Prisma.BrandResolutionReviewUpdateManyMutationInput,
  ) {
    return prisma.$transaction(
      async (tx) => {
        const batch = await tx.catalogImportBatch.findUnique({
          where: { id: batchId },
        });
        if (!batch) throw new Error("NOT_FOUND");
        if (batch.status !== "VALIDATED")
          throw new Error(`READ_ONLY:${batch.status}`);
        const changed = await tx.brandResolutionReview.updateMany({
          where: { id: reviewId, batchId, updatedAt: expectedUpdatedAt },
          data,
        });
        if (changed.count !== 1) throw new Error("CONCURRENT_UPDATE");
        return tx.brandResolutionReview.findUniqueOrThrow({
          where: { id: reviewId },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async bulkUpdate(
    batchId: string,
    updates: Array<{
      id: string;
      expectedUpdatedAt: Date;
      data: Prisma.BrandResolutionReviewUpdateManyMutationInput;
    }>,
  ) {
    return prisma.$transaction(
      async (tx) => {
        const batch = await tx.catalogImportBatch.findUnique({
          where: { id: batchId },
        });
        if (!batch) throw new Error("NOT_FOUND");
        if (batch.status !== "VALIDATED")
          throw new Error(`READ_ONLY:${batch.status}`);
        for (const update of updates) {
          const changed = await tx.brandResolutionReview.updateMany({
            where: {
              id: update.id,
              batchId,
              updatedAt: update.expectedUpdatedAt,
            },
            data: update.data,
          });
          if (changed.count !== 1) throw new Error("CONCURRENT_UPDATE");
        }
        return updates.length;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
