import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, ConflictException } from "@nestjs/common";
import type { UnasApplySummary } from "@acropora/types";

import { BRAND_RESOLUTION_VERSIONS } from "./brand-resolution/brand-resolution.config.js";
import type { UnasApplyRepository } from "./unas-apply.repository.js";
import { UnasApplyService } from "./unas-apply.service.js";

const report = (validationErrors = 0) => ({
  batchId: "batch-1",
  provider: "UNAS" as const,
  sourceFileName: "catalog.xlsx",
  generatedAt: "2026-07-19T00:00:00.000Z",
  summary: {
    productsToCreate: 1,
    productsToUpdate: 0,
    productsUnchanged: 0,
    categoriesToCreate: 1,
    categoriesToUpdate: 0,
    validationErrors,
    warnings: 0,
  },
  products: [],
  issues: [],
});

const batch = (overrides: Record<string, unknown> = {}) => ({
  id: "batch-1",
  status: "VALIDATED",
  analysisVersion: BRAND_RESOLUTION_VERSIONS.config,
  report: report(),
  applyReport: null,
  approvedAt: null,
  approvedBy: null,
  rows: [],
  brandResolutionReviews: [],
  ...overrides,
});

describe("UNAS apply approval", () => {
  it("rejects validation errors", async () => {
    const service = new UnasApplyService({
      getBatch: async () => batch({ report: report(1) }),
    } as unknown as UnasApplyRepository);
    await assert.rejects(
      () => service.approve("batch-1", { brandDecisions: [] }, "owner"),
      BadRequestException,
    );
  });

  it("marks stale analysis and rejects approval", async () => {
    let stale = false;
    const service = new UnasApplyService({
      getBatch: async () => batch({ analysisVersion: "old" }),
      markStale: async () => {
        stale = true;
      },
    } as unknown as UnasApplyRepository);
    await assert.rejects(
      () => service.approve("batch-1", { brandDecisions: [] }, "owner"),
      ConflictException,
    );
    assert.equal(stale, true);
  });

  it("requires a valid explicit decision for every review row", async () => {
    const service = new UnasApplyService({
      getBatch: async () =>
        batch({
          brandResolutionReviews: [
            {
              sourceRowNumber: 2,
              resolution: {
                candidates: [{ brandKey: "tunze" }],
              },
            },
          ],
        }),
    } as unknown as UnasApplyRepository);
    await assert.rejects(
      () => service.approve("batch-1", { brandDecisions: [] }, "owner"),
      /Minden brand review/,
    );
    await assert.rejects(
      () =>
        service.approve(
          "batch-1",
          {
            brandDecisions: [
              {
                sourceRowNumber: 2,
                decision: "ACCEPT",
                brandKey: "not-a-candidate",
              },
            ],
          },
          "owner",
        ),
      /nem szerepel a jelöltek között/,
    );
  });
});

describe("UNAS apply execution", () => {
  const applied: UnasApplySummary = {
    batchId: "batch-1",
    status: "APPLIED",
    categoriesCreated: 1,
    categoriesUpdated: 0,
    productsCreated: 1,
    productsUpdated: 0,
    variantsCreated: 1,
    imagesSynchronized: 1,
    categoryLinksSynchronized: 1,
    relationsSynchronized: 0,
    channelListingsSynchronized: 1,
    externalReferencesSynchronized: 2,
    domainEventsCreated: 2,
    unresolvedBrandAssociations: 0,
    appliedAt: "2026-07-19T00:00:00.000Z",
    appliedBy: "owner",
  };

  it("accepts only APPROVED batches", async () => {
    const service = new UnasApplyService({
      getBatch: async () => batch(),
    } as unknown as UnasApplyRepository);
    await assert.rejects(
      () => service.apply("batch-1", "owner"),
      ConflictException,
    );
  });

  it("delegates an approved apply and returns an APPLIED report idempotently", async () => {
    let calls = 0;
    const repository = {
      getBatch: async () =>
        batch({
          status: calls ? "APPLIED" : "APPROVED",
          applyReport: calls ? applied : null,
        }),
      apply: async () => {
        calls += 1;
        return applied;
      },
    } as unknown as UnasApplyRepository;
    const service = new UnasApplyService(repository);
    assert.deepEqual(await service.apply("batch-1", "owner"), applied);
    assert.deepEqual(await service.apply("batch-1", "owner"), applied);
    assert.equal(calls, 1);
  });
});
