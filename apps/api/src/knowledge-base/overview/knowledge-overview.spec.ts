import assert from "node:assert/strict";
import { describe, it } from "node:test";
import "reflect-metadata";

import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import {
  KnowledgeOverviewController,
  KnowledgeOverviewService,
} from "./knowledge-overview.controller.js";
import { overviewOf, type OverviewCounts } from "./knowledge-overview.js";

/**
 * THE OVERVIEW (S4, Figma 3:2). WHAT TURNS IT RED: a stage called done while
 * its work waits; a conclusion or article stage guessed; a problem count that
 * misses the open questions or the claims on a retracted work.
 */
const ZERO: OverviewCounts = {
  sources: 0,
  sourcesPending: 0,
  sourcesIncluded: 0,
  sourcesExtracted: 0,
  claimsCandidate: 0,
  claimsVerified: 0,
  anchorsPending: 0,
  questionsOpen: 0,
  claimsOnRetracted: 0,
};
const states = (c: Partial<OverviewCounts>) =>
  overviewOf({ ...ZERO, ...c }).stages.map((s) => s.state);

describe("the research workflow's stages", () => {
  it("nothing yet: every stage to do, the badge on discovery", () => {
    assert.deepEqual(states({}), [
      "TODO",
      "TODO",
      "TODO",
      "TODO",
      "TODO",
      "TODO",
    ]);
    assert.equal(overviewOf(ZERO).project.stage, "DISCOVERY");
  });

  it("the stage today: 439 sources, none screened", () => {
    const o = overviewOf({ ...ZERO, sources: 439, sourcesPending: 439 });
    assert.deepEqual(
      o.stages.map((s) => s.state),
      ["DONE", "TODO", "TODO", "TODO", "TODO", "TODO"],
    );
    assert.equal(o.project.stage, "SCREENING");
    assert.equal(o.waiting.sourcesToScreen, 439);
  });

  it("screening under way, extraction begun, claims waiting", () => {
    assert.deepEqual(
      states({
        sources: 82,
        sourcesPending: 35,
        sourcesIncluded: 24,
        sourcesExtracted: 3,
        claimsCandidate: 14,
        anchorsPending: 90,
      }),
      ["DONE", "ACTIVE", "ACTIVE", "ACTIVE", "TODO", "TODO"],
    );
  });

  it("all screened, every included source read, every claim decided: checking is done, conclusion is next", () => {
    const o = overviewOf({
      ...ZERO,
      sources: 82,
      sourcesIncluded: 24,
      sourcesExtracted: 24,
      claimsVerified: 9,
    });
    assert.deepEqual(
      o.stages.map((s) => s.state),
      ["DONE", "DONE", "DONE", "DONE", "TODO", "TODO"],
    );
    assert.equal(o.project.stage, "CONCLUSION");
  });

  it("a claim still CANDIDATE, or an anchor still PENDING, keeps checking active", () => {
    assert.equal(
      states({
        sources: 1,
        sourcesIncluded: 1,
        sourcesExtracted: 1,
        claimsVerified: 1,
        anchorsPending: 1,
      })[3],
      "ACTIVE",
    );
    assert.equal(
      states({
        sources: 1,
        sourcesIncluded: 1,
        sourcesExtracted: 1,
        claimsCandidate: 1,
      })[3],
      "ACTIVE",
    );
  });

  it("problems are the open questions plus the claims on a retracted work", () => {
    const o = overviewOf({
      ...ZERO,
      questionsOpen: 4,
      claimsOnRetracted: 2,
      claimsVerified: 9,
    });
    assert.deepEqual(o.waiting, {
      sourcesToScreen: 0,
      claimsToCheck: 0,
      problems: 6,
    });
    assert.equal(o.project.openChecks, 6);
    assert.equal(o.project.acceptedClaims, 9);
  });
});

describe("the overview route", () => {
  it("needs knowledge.view, and the service builds from the counts", async () => {
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        KnowledgeOverviewController.prototype.get,
      ),
      [PERMISSIONS.KNOWLEDGE_VIEW],
    );
    const svc = new KnowledgeOverviewService(async () => ({
      ...ZERO,
      sources: 5,
      sourcesPending: 5,
    }));
    assert.equal((await svc.overview()).waiting.sourcesToScreen, 5);
  });
});
