import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  jevState,
  navState,
  summarizeDecisionRuns,
  syncRunState,
  type DecisionRunGroup,
} from "./jev-system.js";

const g = (
  policyKey: string,
  exposure: DecisionRunGroup["exposure"],
  resolution: DecisionRunGroup["resolution"],
  status: DecisionRunGroup["status"],
  count: number,
): DecisionRunGroup => ({ policyKey, exposure, resolution, status, count });

describe("JEV intelligencia", () => {
  it("splits shown runs by resolution, shadow runs by agreement, errors apart", () => {
    const data = summarizeDecisionRuns(
      [
        g("acropora-letter-class-v1", "SHOWN", "ACCEPTED", "OK", 5),
        g("acropora-letter-class-v1", "SHOWN", "OVERRIDDEN", "OK", 2),
        g("acropora-letter-class-v1", "SHOWN", "EXPIRED", "OK", 1),
        g("acropora-letter-class-v1", "SHOWN", null, "OK", 3),
        g(
          "acropora-missing-invoice-pair-v1",
          "HIDDEN",
          "SHADOW_MATCH",
          "OK",
          7,
        ),
        g(
          "acropora-missing-invoice-pair-v1",
          "HIDDEN",
          "SHADOW_MISMATCH",
          "OK",
          2,
        ),
        g("acropora-missing-invoice-pair-v1", "HIDDEN", null, "OK", 4),
        g("acropora-missing-invoice-pair-v1", "HIDDEN", null, "ERROR", 1),
      ],
      [
        { status: "OK", count: 6 },
        { status: "ERROR", count: 1 },
      ],
    );
    assert.deepEqual(data.today, { runs: 7, errors: 1 });
    assert.deepEqual(data.week, {
      runs: 25,
      errors: 1,
      shown: { accepted: 5, overridden: 2, lapsed: 1, open: 3 },
      shadow: { match: 7, mismatch: 2, open: 4 },
    });
    const pair = data.policies.find(
      (p) => p.policyKey === "acropora-missing-invoice-pair-v1",
    );
    // the shadow-mode pairing never produces a "shown" figure: it is no suggestion
    assert.deepEqual(pair?.shown, {
      accepted: 0,
      overridden: 0,
      lapsed: 0,
      open: 0,
    });
    assert.deepEqual(pair?.shadow, { match: 7, mismatch: 2, open: 4 });
    assert.equal(pair?.errors, 1);
  });

  it("an errored SHOWN run is an error, never an open item", () => {
    const data = summarizeDecisionRuns([g("p", "SHOWN", null, "ERROR", 3)], []);
    assert.equal(data.week.errors, 3);
    assert.equal(data.week.shown.open, 0);
  });

  it("no runs: zeros and no policies", () => {
    const data = summarizeDecisionRuns([], []);
    assert.equal(data.week.runs, 0);
    assert.deepEqual(data.policies, []);
    assert.deepEqual(data.today, { runs: 0, errors: 0 });
  });
});

describe("Rendszerállapot", () => {
  const at = new Date("2026-10-01T08:00:00.000Z");

  it("a source's state is its last run's: none, failed, running, partly failed, applied", () => {
    assert.equal(syncRunState(null).state, "no-data");
    assert.equal(
      syncRunState({ status: "FAILED", at, errorCode: "X" }).state,
      "error",
    );
    assert.equal(
      syncRunState({ status: "RUNNING", at, errorCode: null }).state,
      "ok",
    );
    assert.equal(
      syncRunState({ status: "APPLIED", at, errorCode: null, failedCount: 2 })
        .state,
      "warning",
    );
    assert.equal(
      syncRunState({ status: "APPLIED", at, errorCode: null, failedCount: 0 })
        .state,
      "ok",
    );
  });

  it("NAV is the worse of the last run and the stored verification", () => {
    const applied = { status: "APPLIED", at, errorCode: null };
    assert.equal(navState(applied, "SUCCESS").state, "ok");
    assert.equal(navState(applied, "FAILED").state, "error");
    assert.equal(navState(applied, "NEVER").state, "warning");
    assert.equal(navState(applied, null).state, "warning");
    assert.equal(
      navState({ status: "FAILED", at, errorCode: "E" }, "SUCCESS").state,
      "error",
    );
    assert.equal(navState(null, "SUCCESS").state, "no-data");
  });

  it("JEV: no run today is no data; all failing is an error; some failing a warning", () => {
    assert.equal(jevState({ runs: 0, errors: 0 }).state, "no-data");
    assert.equal(jevState({ runs: 3, errors: 3 }).state, "error");
    assert.equal(jevState({ runs: 3, errors: 1 }).state, "warning");
    assert.equal(jevState({ runs: 3, errors: 0 }).state, "ok");
  });
});
