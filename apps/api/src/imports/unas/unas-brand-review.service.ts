import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  BrandResolutionResult,
  BrandReviewListItem,
  BrandReviewListResponse,
  BrandReviewReason,
  UnasImportReport,
  UnasApplySummary,
  UnasProductImportRow,
} from "@acropora/types";

import { BRAND_RESOLUTION_VERSIONS } from "./brand-resolution/brand-resolution.config.js";
import type {
  BrandReviewQueryDto,
  BulkBrandReviewDto,
  UpdateBrandReviewDto,
} from "./dto/brand-review.dto.js";
import { UnasBrandReviewRepository } from "./unas-brand-review.repository.js";

@Injectable()
export class UnasBrandReviewService {
  constructor(private readonly repository: UnasBrandReviewRepository) {}

  async list(
    batchId: string,
    query: BrandReviewQueryDto,
  ): Promise<BrandReviewListResponse> {
    const batch = await this.repository.getBatch(batchId);
    if (!batch) throw new NotFoundException("Az import batch nem található.");
    const brands = await this.repository.getBrandMasterData();
    const all = batch.brandResolutionReviews.map((review) =>
      this.item(review, brands),
    );
    const needle = query.search?.trim().toLocaleLowerCase("hu-HU");
    const filtered = all.filter((item) => {
      if (query.status && item.status !== query.status) return false;
      if (
        query.reason &&
        !item.reviewReasons.includes(query.reason as BrandReviewReason)
      )
        return false;
      if (
        query.suggestedBrand &&
        item.suggestedBrandKey !== query.suggestedBrand
      )
        return false;
      if (
        query.confidence &&
        confidenceBand(item.confidence) !== query.confidence
      )
        return false;
      if (query.entityType && query.entityType !== "PRODUCT") return false;
      if (
        needle &&
        ![
          item.sku,
          item.productName,
          item.suggestedBrandKey,
          ...item.candidates.flatMap((candidate) => [
            candidate.brandKey,
            candidate.brandName,
          ]),
        ].some((value) => value?.toLocaleLowerCase("hu-HU").includes(needle))
      )
        return false;
      return true;
    });
    const start = (query.page - 1) * query.pageSize;
    const report = batch.report as unknown as UnasImportReport | null;
    const pending = all.filter((item) => item.status === "PENDING").length;
    const accepted = all.filter((item) => item.status === "ACCEPTED").length;
    const noBrand = all.length - pending - accepted;
    const reasons: Partial<Record<BrandReviewReason, number>> = {};
    for (const item of all)
      for (const reason of item.reviewReasons)
        reasons[reason] = (reasons[reason] ?? 0) + 1;
    const bands = { high: 0, medium: 0, low: 0, none: 0 };
    for (const item of all) bands[confidenceBand(item.confidence)] += 1;
    const validationErrors =
      report?.summary.validationErrors ??
      batch.rows.filter((row) => row.status === "INVALID").length;
    const stale =
      batch.status === "STALE" ||
      batch.analysisVersion !== BRAND_RESOLUTION_VERSIONS.config;
    const readOnly = ["APPROVED", "APPLIED", "STALE"].includes(batch.status);
    return {
      items: filtered.slice(start, start + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / query.pageSize)),
      summary: {
        total: all.length,
        pending,
        accepted,
        noBrand,
        completionPercent: all.length
          ? Math.round(((all.length - pending) / all.length) * 100)
          : 100,
        reasons,
        confidenceBands: bands,
        batchStatus: batch.status,
        analysisVersion: batch.analysisVersion,
        stale,
        validationErrors,
        approvalEligible:
          batch.status === "VALIDATED" &&
          !stale &&
          validationErrors === 0 &&
          pending === 0,
        readOnly,
        applyReport: batch.applyReport
          ? (batch.applyReport as unknown as UnasApplySummary)
          : undefined,
      },
    };
  }

  async update(
    batchId: string,
    reviewId: string,
    input: UpdateBrandReviewDto,
    actorId: string,
  ) {
    const batch = await this.repository.getBatch(batchId);
    if (!batch) throw new NotFoundException("Az import batch nem található.");
    const review = batch.brandResolutionReviews.find(
      (item) => item.id === reviewId,
    );
    if (!review) throw new NotFoundException("A review sor nem található.");
    const resolution = review.resolution as unknown as BrandResolutionResult;
    const brands = await this.repository.getBrandMasterData();
    const candidate = resolution.candidates.find(
      (item) => item.brandKey === input.brandKey,
    );
    const master = candidate
      ? this.masterBrand(candidate.brandName, brands)
      : undefined;
    if (
      input.decision === "ACCEPT" &&
      (!input.brandKey || !candidate || !master || !master.brand.isActive)
    )
      throw new BadRequestException(
        "Csak aktív master-data rekordhoz kapcsolt, mentett brand jelölt fogadható el.",
      );
    const now = new Date();
    try {
      await this.repository.updateDecision(
        batchId,
        reviewId,
        new Date(input.expectedUpdatedAt),
        {
          status:
            input.decision === "RESET"
              ? "PENDING"
              : input.decision === "ACCEPT"
                ? "ACCEPTED"
                : "NO_BRAND",
          resolvedBrandKey: input.decision === "ACCEPT" ? input.brandKey : null,
          reviewedBy: input.decision === "RESET" ? null : actorId,
          reviewedAt: input.decision === "RESET" ? null : now,
        },
      );
    } catch (error) {
      this.mapMutationError(error);
    }
    const refreshed = await this.repository.getBatch(batchId);
    return this.item(
      refreshed!.brandResolutionReviews.find((item) => item.id === reviewId)!,
      brands,
    );
  }

  async bulk(batchId: string, input: BulkBrandReviewDto, actorId: string) {
    if (new Set(input.reviewIds).size !== input.reviewIds.length)
      throw new BadRequestException("Duplikált review azonosító.");
    const batch = await this.repository.getBatch(batchId);
    if (!batch) throw new NotFoundException("Az import batch nem található.");
    const byId = new Map(
      batch.brandResolutionReviews.map((review) => [review.id, review]),
    );
    const brands = await this.repository.getBrandMasterData();
    const now = new Date();
    const updates = input.reviewIds.map((id) => {
      const review = byId.get(id);
      if (!review)
        throw new BadRequestException(
          "A kijelölt review sor nem ehhez a batchhez tartozik.",
        );
      const resolution = review.resolution as unknown as BrandResolutionResult;
      const candidate =
        resolution.candidates.find(
          (item) => item.brandKey === review.proposedBrandKey,
        ) ?? resolution.candidates[0];
      if (input.decision === "ACCEPT_SUGGESTED" && !candidate)
        throw new BadRequestException(
          `A(z) ${review.sourceRowNumber}. sornak nincs elfogadható jelöltje.`,
        );
      if (
        input.decision === "ACCEPT_SUGGESTED" &&
        !this.masterBrand(candidate!.brandName, brands)?.brand.isActive
      )
        throw new BadRequestException(
          `A(z) ${review.sourceRowNumber}. sor javasolt márkája nem létező aktív master adat.`,
        );
      const expected = input.expectedUpdatedAt[id];
      if (!expected)
        throw new BadRequestException(
          "Minden kijelölt sorhoz concurrency token szükséges.",
        );
      return {
        id,
        expectedUpdatedAt: new Date(expected),
        data: {
          status:
            input.decision === "ACCEPT_SUGGESTED"
              ? ("ACCEPTED" as const)
              : ("NO_BRAND" as const),
          resolvedBrandKey:
            input.decision === "ACCEPT_SUGGESTED" ? candidate!.brandKey : null,
          reviewedBy: actorId,
          reviewedAt: now,
        },
      };
    });
    try {
      await this.repository.bulkUpdate(batchId, updates);
    } catch (error) {
      this.mapMutationError(error);
    }
    return { updated: updates.length };
  }

  private item(
    review: NonNullable<
      Awaited<ReturnType<UnasBrandReviewRepository["getBatch"]>>
    >["brandResolutionReviews"][number],
    brands: Awaited<
      ReturnType<UnasBrandReviewRepository["getBrandMasterData"]>
    >,
  ): BrandReviewListItem {
    const resolution = review.resolution as unknown as BrandResolutionResult;
    const row = review.importRow
      .parsedPayload as unknown as UnasProductImportRow;
    return {
      id: review.id,
      sourceRowNumber: review.sourceRowNumber,
      sku: review.sku,
      productName: review.productName,
      status: review.status,
      suggestedBrandKey: review.proposedBrandKey ?? undefined,
      resolvedBrandKey: review.resolvedBrandKey ?? undefined,
      confidence: review.confidence,
      reviewReasons: review.reviewReasons as unknown as BrandReviewReason[],
      candidates: resolution.candidates.map((candidate) => {
        const master = this.masterBrand(candidate.brandName, brands);
        return {
          ...candidate,
          masterData: master
            ? {
                brandId: master.brand.id,
                brandName: master.brand.name,
                status: master.brand.isActive ? "ACTIVE" : "ARCHIVED",
                match: master.match,
              }
            : undefined,
        };
      }),
      evidence: resolution.evidence,
      sourceFacts: {
        explicitBrand: row.brandName,
        manufacturerPartNumber: row.manufacturerPartNumber,
        primaryCategory: row.primaryCategoryPath,
        alternativeCategories: row.alternativeCategoryPaths ?? [],
      },
      updatedAt: review.updatedAt.toISOString(),
      reviewedAt: review.reviewedAt?.toISOString(),
    };
  }

  private masterBrand(
    candidateName: string,
    brands: Awaited<
      ReturnType<UnasBrandReviewRepository["getBrandMasterData"]>
    >,
  ) {
    const normalized = normalize(candidateName);
    for (const brand of brands) {
      if (brand.normalizedName === normalized)
        return { brand, match: "CANONICAL" as const };
      if (brand.aliases.some((alias) => alias.normalizedAlias === normalized))
        return { brand, match: "ALIAS" as const };
    }
    return undefined;
  }

  private mapMutationError(error: unknown): never {
    if (error instanceof Error && error.message === "CONCURRENT_UPDATE")
      throw new ConflictException(
        "A review sort egy másik felhasználó időközben módosította. Frissítsd a listát.",
      );
    if (error instanceof Error && error.message.startsWith("READ_ONLY"))
      throw new ConflictException(
        "A batch ebben az állapotban már csak olvasható.",
      );
    if (error instanceof Error && error.message === "NOT_FOUND")
      throw new NotFoundException("Az import batch nem található.");
    throw error;
  }
}

const normalize = (value: string) =>
  value
    .replace(/&/g, " and ")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

function confidenceBand(value: number): "high" | "medium" | "low" | "none" {
  if (value >= 75) return "high";
  if (value >= 50) return "medium";
  if (value > 0) return "low";
  return "none";
}
