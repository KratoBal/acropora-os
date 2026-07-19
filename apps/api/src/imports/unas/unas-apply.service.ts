import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  BrandResolutionResult,
  UnasApplySummary,
  UnasApprovalResult,
  UnasImportReport,
} from "@acropora/types";

import { BRAND_RESOLUTION_VERSIONS } from "./brand-resolution/brand-resolution.config.js";
import type { ApproveUnasImportDto } from "./dto/approve-unas-import.dto.js";
import { UnasApplyRepository } from "./unas-apply.repository.js";

@Injectable()
export class UnasApplyService {
  constructor(private readonly repository: UnasApplyRepository) {}

  async approve(
    batchId: string,
    input: ApproveUnasImportDto,
    actorId: string,
  ): Promise<UnasApprovalResult> {
    const batch = await this.repository.getBatch(batchId);
    if (!batch) throw new NotFoundException("Az import batch nem található.");
    if (batch.status === "APPROVED" && batch.approvedAt && batch.approvedBy)
      return {
        batchId,
        status: "APPROVED",
        approvedAt: batch.approvedAt.toISOString(),
        approvedBy: batch.approvedBy,
        reviewedRows: batch.brandResolutionReviews.length,
      };
    if (batch.analysisVersion !== BRAND_RESOLUTION_VERSIONS.config) {
      await this.repository.markStale(batchId);
      throw new ConflictException(
        "A dry-run analysisVersion elavult; új elemzés szükséges.",
      );
    }
    if (batch.status !== "VALIDATED")
      throw new ConflictException(
        `A batch ${batch.status} állapotból nem hagyható jóvá.`,
      );
    const report = batch.report as unknown as UnasImportReport | null;
    if (
      !report ||
      report.summary.validationErrors > 0 ||
      batch.rows.some((row) => row.status === "INVALID")
    )
      throw new BadRequestException(
        "Validációs hibát tartalmazó batch nem hagyható jóvá.",
      );

    const decisions = input.brandDecisions ?? [];
    if (
      new Set(decisions.map((item) => item.sourceRowNumber)).size !==
      decisions.length
    )
      throw new BadRequestException("Duplikált brand review döntés.");
    const decisionByRow = new Map(
      decisions.map((decision) => [decision.sourceRowNumber, decision]),
    );
    if (
      decisions.length > 0 &&
      (decisions.length !== batch.brandResolutionReviews.length ||
        batch.brandResolutionReviews.some(
          (review) => !decisionByRow.has(review.sourceRowNumber),
        ))
    )
      throw new BadRequestException(
        "Minden brand review sorhoz explicit ACCEPT vagy NO_BRAND döntés szükséges.",
      );
    if (
      decisions.length === 0 &&
      batch.brandResolutionReviews.some(
        (review) =>
          review.status !== "ACCEPTED" && review.status !== "NO_BRAND",
      )
    )
      throw new BadRequestException(
        "Minden brand review sort le kell zárni jóváhagyás előtt.",
      );
    for (const review of decisions.length > 0
      ? batch.brandResolutionReviews
      : []) {
      const decision = decisionByRow.get(review.sourceRowNumber)!;
      if (decision.decision !== "ACCEPT") continue;
      const resolution = review.resolution as unknown as BrandResolutionResult;
      if (
        !decision.brandKey ||
        !resolution.candidates.some(
          (candidate) => candidate.brandKey === decision.brandKey,
        )
      )
        throw new BadRequestException(
          `A(z) ${review.sourceRowNumber}. sor elfogadott brandje nem szerepel a jelöltek között.`,
        );
    }
    try {
      const approved = await this.repository.approve(
        batchId,
        actorId,
        decisions,
      );
      return {
        batchId,
        status: "APPROVED",
        approvedAt: approved.approvedAt!.toISOString(),
        approvedBy: approved.approvedBy!,
        reviewedRows: batch.brandResolutionReviews.length,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("INVALID_APPROVAL_STATE")
      )
        throw new ConflictException("A batch állapota időközben megváltozott.");
      throw error;
    }
  }

  async apply(batchId: string, actorId: string): Promise<UnasApplySummary> {
    const batch = await this.repository.getBatch(batchId);
    if (!batch) throw new NotFoundException("Az import batch nem található.");
    if (batch.status === "APPLIED" && batch.applyReport)
      return batch.applyReport as unknown as UnasApplySummary;
    if (batch.analysisVersion !== BRAND_RESOLUTION_VERSIONS.config) {
      await this.repository.markStale(batchId);
      throw new ConflictException(
        "A jóváhagyott analysisVersion elavult; új dry-run szükséges.",
      );
    }
    if (batch.status !== "APPROVED")
      throw new ConflictException("Csak APPROVED batch alkalmazható.");
    try {
      return await this.repository.apply(
        batchId,
        actorId,
        BRAND_RESOLUTION_VERSIONS.config,
      );
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (error.message === "STALE_ANALYSIS_VERSION")
        throw new ConflictException("Az analysisVersion elavult.");
      if (error.message === "VALIDATION_ERRORS")
        throw new BadRequestException("A batch validációs hibát tartalmaz.");
      if (error.message === "PENDING_BRAND_REVIEWS")
        throw new BadRequestException("Függő brand review-k maradtak.");
      if (error.message.startsWith("INVALID_APPLY_STATE"))
        throw new ConflictException("A batch állapota időközben megváltozott.");
      throw error;
    }
  }
}
