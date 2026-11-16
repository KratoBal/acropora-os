import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseTrialResult } from "./trial-result.js";

/*
  THE TRIAL RESULT PARSER (S6). WHAT TURNS THIS RED: a result that passes on an exit code alone (a stub), on a check list that is
  empty, or on a malformed one; a failed check, or a non-zero exit code, that still passes; the last line of the output not being
  the one that is read (a trial prints progress before its result).
*/
const ok =
  '{"checks":[{"name":"invoice","passed":true},{"name":"work sheet","passed":true}]}';

describe("the trial command's result", () => {
  it("passes on exit code 0 with named checks that all passed, reading the LAST line (progress comes before it)", () => {
    const result = parseTrialResult(`starting\nstep 1\n${ok}\n`, 0);
    assert.equal(result.passed, true);
    assert.deepEqual(result.checks, [
      { name: "invoice", passed: true },
      { name: "work sheet", passed: true },
    ]);
  });

  it("does not pass on a non-zero exit code, or on one failed check, and keeps the checks so the report can name them", () => {
    assert.equal(parseTrialResult(ok, 1).passed, false);
    assert.equal(parseTrialResult(ok, null).passed, false);
    const failed = parseTrialResult(
      '{"checks":[{"name":"invoice","passed":true},{"name":"ticket","passed":false}]}',
      0,
    );
    assert.equal(failed.passed, false);
    assert.equal(failed.checks.length, 2);
  });

  it("gives NO checks, so the gate fails, for output that is not the agreed shape (a stub with exit code 0 passes nothing)", () => {
    for (const output of [
      "",
      "ok\n",
      "not json",
      "{}",
      '{"checks":[]}',
      '{"checks":"invoice"}',
      '{"checks":[{"name":"","passed":true}]}',
      '{"checks":[{"name":"invoice"}]}',
      '{"checks":[{"name":"invoice","passed":"yes"}]}',
      '{"checks":[{"name":"invoice","passed":true},{"passed":true}]}',
      "null",
    ]) {
      const result = parseTrialResult(output, 0);
      assert.equal(result.passed, false, output);
      assert.deepEqual(
        result.checks.length === 0 || output === '{"checks":[]}',
        true,
        output,
      );
    }
  });
});
