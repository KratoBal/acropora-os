import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, ConflictException } from "@nestjs/common";

import { BRAND_RESOLUTION_VERSIONS } from "./brand-resolution/brand-resolution.config.js";
import type { UnasBrandReviewRepository } from "./unas-brand-review.repository.js";
import { UnasBrandReviewService } from "./unas-brand-review.service.js";

const review = (overrides: Record<string, unknown> = {}) => ({
  id: "review-1",
  batchId: "batch-1",
  importRowId: "row-1",
  sourceRowNumber: 2,
  sku: "REEF-1",
  productName: "Tunze Reef Pump",
  status: "PENDING",
  proposedBrandKey: "tunze",
  resolvedBrandKey: null,
  reviewedBy: null,
  reviewedAt: null,
  confidence: 82,
  reviewReasons: ["LOW_CONFIDENCE"],
  resolverVersion: "v1",
  configVersion: "v1",
  schemaVersion: "v1",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-02"),
  resolution: {
    candidates: [
      {
        brandKey: "tunze",
        brandName: "Tunze",
        confidence: 82,
        rank: 1,
        sources: [],
        evidence: [],
        conflicts: [],
      },
    ],
    evidence: [],
  },
  importRow: {
    parsedPayload: {
      sku: "REEF-1",
      name: "Tunze Reef Pump",
      rawPayload: {},
      brandName: "Tunze",
      alternativeCategoryPaths: [],
    },
  },
  ...overrides,
});
const batch = (reviews = [review()]) => ({
  id: "batch-1",
  status: "VALIDATED",
  analysisVersion: BRAND_RESOLUTION_VERSIONS.config,
  report: { summary: { validationErrors: 0 } },
  rows: [],
  brandResolutionReviews: reviews,
});

describe("UNAS brand review service", () => {
  it("paginates and filters deterministically", async () => {
    const service = new UnasBrandReviewService({
      getBrandMasterData: async () => [],
      getBatch: async () =>
        batch([
          review(),
          review({
            id: "review-2",
            sourceRowNumber: 3,
            sku: "OTHER",
            status: "NO_BRAND",
          }),
        ]),
    } as unknown as UnasBrandReviewRepository);
    const result = await service.list("batch-1", {
      page: 1,
      pageSize: 10,
      status: "PENDING",
      search: "tunze",
    });
    assert.equal(result.total, 1);
    assert.equal(result.items[0]?.id, "review-1");
    assert.equal(result.summary.pending, 1);
    assert.equal(result.summary.noBrand, 1);
  });

  it("accepts only a persisted candidate and rejects free text", async () => {
    const repository = {
      getBrandMasterData: async () => [],
      getBatch: async () => batch(),
      updateDecision: async () => review({ status: "ACCEPTED" }),
    } as unknown as UnasBrandReviewRepository;
    const service = new UnasBrandReviewService(repository);
    await assert.rejects(
      () =>
        service.update(
          "batch-1",
          "review-1",
          {
            decision: "ACCEPT",
            brandKey: "free-text",
            expectedUpdatedAt: "2026-01-02T00:00:00.000Z",
          },
          "owner",
        ),
      BadRequestException,
    );
  });

  it("maps optimistic concurrency failure to conflict", async () => {
    const repository = {
      getBrandMasterData: async () => [],
      getBatch: async () => batch(),
      updateDecision: async () => {
        throw new Error("CONCURRENT_UPDATE");
      },
    } as unknown as UnasBrandReviewRepository;
    await assert.rejects(
      () =>
        new UnasBrandReviewService(repository).update(
          "batch-1",
          "review-1",
          {
            decision: "NO_BRAND",
            expectedUpdatedAt: "2026-01-02T00:00:00.000Z",
          },
          "owner",
        ),
      ConflictException,
    );
  });

  it("keeps bulk updates explicit and validates every concurrency token", async () => {
    let calls = 0;
    const repository = {
      getBrandMasterData: async () => [
        {
          id: "brand-1",
          name: "Tunze",
          normalizedName: "tunze",
          isActive: true,
          aliases: [],
        },
      ],
      getBatch: async () => batch(),
      bulkUpdate: async (_batchId: string, updates: unknown[]) => {
        calls = updates.length;
        return calls;
      },
    } as unknown as UnasBrandReviewRepository;
    const service = new UnasBrandReviewService(repository);
    await assert.rejects(
      () =>
        service.bulk(
          "batch-1",
          {
            reviewIds: ["review-1"],
            decision: "NO_BRAND",
            expectedUpdatedAt: {},
          },
          "owner",
        ),
      BadRequestException,
    );
    await service.bulk(
      "batch-1",
      {
        reviewIds: ["review-1"],
        decision: "ACCEPT_SUGGESTED",
        expectedUpdatedAt: { "review-1": "2026-01-02T00:00:00.000Z" },
      },
      "owner",
    );
    assert.equal(calls, 1);
  });

  it("reports approval eligibility only at complete valid state", async () => {
    const service = new UnasBrandReviewService({
      getBrandMasterData: async () => [],
      getBatch: async () => batch([review({ status: "ACCEPTED" })]),
    } as unknown as UnasBrandReviewRepository);
    const result = await service.list("batch-1", { page: 1, pageSize: 25 });
    assert.equal(result.summary.approvalEligible, true);
    assert.equal(result.summary.completionPercent, 100);
  });
});
