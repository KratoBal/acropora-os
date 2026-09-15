#!/usr/bin/env node
/**
 * Refuses a test run whose TAP stream reports a failure the exit code does not.
 *
 * WHY THIS EXISTS, and it is not hypothetical. On 2026-09-15 the "Database
 * integration tests" step went GREEN while the log said otherwise:
 *
 *     not ok 24 - a hibajegy írási útjai valódi sorokon
 *       failureType: 'hookFailed'
 *       Foreign key constraint violated: User_customerId_fkey
 *     # tests 237  # suites 40  # pass 237  # fail 0
 *
 * All 237 assertions passed. An `after` hook - the suite's own cleanup - threw,
 * and `node --test` counts hooks as neither tests nor cancellations. The step
 * succeeded, so "Fail the job if the database integration tests failed" was
 * SKIPPED, and the job was success. In a thirty-thousand line log exactly one
 * line said otherwise, and nothing was reading it.
 *
 * MEASURED, WITH TWO NEGATIVE CONTROLS (node v22.23.2):
 *
 *     an `after` hook throws     not ok <suite>, failureType hookFailed,
 *                                but `# fail 0`, `# cancelled 0`, EXIT CODE 0
 *     a test fails               `# fail 1`, exit code 1
 *     a `before` hook throws     `# cancelled 1`, exit code 1
 *
 * So `after` is the one place a failure passes every gate we own. The controls
 * are what make that an assertion rather than an impression: the measurement
 * could have come out the other way, and for two of the three shapes it did.
 *
 * AND "a later run would catch it" IS FALSE HERE. The leftover rows would make
 * the next run's `before` hook throw, and that IS loud (exit 1) - but every CI
 * job gets a fresh PostgreSQL container, so that leftover never exists. On a
 * persistent database the hole is one run deep. In CI it is permanent.
 *
 * ---
 *
 * WHAT IT LOOKS FOR, AND WHY TWO MARKERS AND NOT ONE.
 *
 *   a TAP `not ok` line     the general shape: any subtest or suite the runner
 *                           itself called failed, whatever the exit code did
 *   `failureType: hookFailed`  the specific shape above, which is the one that
 *                           carries no exit code at all
 *
 * The second is a subset of the first in every case measured so far. It stays
 * because the pair NAMES the failure in the output: a reader who sees only
 * `not ok` starts by looking for a broken assertion, and a hook failure is not
 * one. A gate that reports the wrong cause costs more than the minutes it saves
 * - the same reason the repository keeps two error messages where one would
 * pass.
 *
 * WHAT IT DOES NOT COVER, said out loud so nobody reads more into it:
 *
 *   - a run that produces NO summary at all (the runner never started). That
 *     shape already exits non-zero, so the existing gate sees it.
 *   - a suite that was never discovered. Nothing in the output mentions it, so
 *     no scan of the output can find it; that needs a count against an expected
 *     number, which is a different measurement.
 *
 * THE OPTIONAL PREFIXES ARE NOT DECORATION. Two real forms carry one:
 *
 *   `@acropora/api:test: not ok 3 - ...`         turbo, package name
 *   `2026-09-15T09:13:10.7810218Z not ok 24 ...` a downloaded GitHub job log
 *
 * The second is what makes this script runnable against a PAST run's log,
 * which is how its own negative control works: pointed at the log of job
 * 104320965070 it must exit 1, and at a green run's log it must exit 0.
 * A gate that cannot be aimed at the failure it was written for is a claim,
 * not a guard.
 *
 * ---
 *
 * MEASURED, BOTH DIRECTIONS (2026-09-15). The reds matter less than the greens:
 * a gate that refuses everything is no cheaper to live with than one that
 * refuses nothing.
 *
 *   MUST REFUSE
 *     job 104320965070            the silent run: two findings, the `not ok`
 *                                 and the `failureType` line under it
 *     jobs 104324640109/650099/   three runs with genuinely red assertions
 *          654187
 *     a turbo-prefixed line       `@acropora/api:test: not ok 3 - ...`
 *     a timestamped line          a downloaded job log, both markers
 *
 *   MUST NOT
 *     job 104324309101            the same suites, green
 *     jobs 104314864015,          three consecutive main-branch runs
 *          104304584350,
 *          104304418889
 *     a test NAME containing      `ok 1 - a leirás említi a "not ok" szót`
 *     the words "not ok"          - the pattern is anchored, so it does not fire
 *
 * TWO DEAD BRANCHES THIS SCRIPT'S OWN FIXTURES CAUGHT BEFORE IT SHIPPED, and
 * both are worth naming because neither showed up as an error - only as a count
 * that was one lower than the log plainly justified:
 *
 *   the `failureType` marker      the prefix strip ate `failureType:` itself
 *   the turbo prefix              `[^\s:]+` stopped at the FIRST colon, and the
 *                                 real prefix carries two (`pkg:script: `)
 *
 * Each would have read as coverage while matching nothing.
 */
import { readFileSync } from "node:fs";

const RUNNER_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+/;
/**
 * `\S*` AND NOT `[^\s:]+`, BECAUSE THE TURBO PREFIX CARRIES TWO COLONS
 * (`@acropora/api:test: `). The first version stopped at the first one, left
 * `test: not ok 3 - ...` behind, and matched nothing - the second dead branch
 * my own fixtures caught in this file. `\S*` is greedy and cannot cross
 * whitespace, so on an unprefixed TAP line (`not ok 24 - ...`) there is no
 * colon to anchor on and the pattern simply does not apply.
 */
const TURBO_PREFIX = /^\S*:\s*/;

/** A TAP failure line, whatever indentation or prefix the runner put on it. */
const NOT_OK = /^not ok \d+ - /;
const HOOK_FAILED = /failureType:\s*'?hookFailed'?/;

/**
 * THE TWO MARKERS NEED DIFFERENT AMOUNTS OF STRIPPING, AND MY OWN CONTROL IS
 * WHAT SAID SO.
 *
 * The first version ran both patterns over the fully stripped line, and the
 * negative control reported ONE finding where the log plainly holds two: the
 * `not ok` line and the `failureType: 'hookFailed'` line under it. The turbo
 * prefix pattern (`^[^\s:]+:\s*`) had eaten `failureType:` itself, leaving
 * `'hookFailed'` - so that marker could never have fired. A marker that cannot
 * fire is worse than a missing one: it reads like coverage.
 *
 * So the timestamp comes off for both, and the package prefix only for the TAP
 * line, which is the only one that ever carries it.
 */
function withoutTimestamp(line) {
  return line.replace(RUNNER_TIMESTAMP, "");
}

function tapLine(line) {
  return withoutTimestamp(line).trimStart().replace(TURBO_PREFIX, "");
}

const path = process.argv[2];
if (!path) {
  console.error("Usage: tap-stream-gate.mjs <log file>");
  process.exit(2);
}

let text;
try {
  text = readFileSync(path, "utf8");
} catch (error) {
  // A MISSING LOG IS A FAILURE, NOT AN ABSENCE OF ONE. If the step that should
  // have written it did not, the safe reading is that nothing was measured.
  console.error(`tap-stream-gate: cannot read ${path}: ${String(error)}`);
  process.exit(2);
}

const findings = [];
for (const [index, raw] of text.split("\n").entries()) {
  const tap = tapLine(raw);
  const plain = withoutTimestamp(raw);
  if (NOT_OK.test(tap) || HOOK_FAILED.test(plain))
    findings.push({ number: index + 1, line: plain.trim() });
}

if (findings.length === 0) process.exit(0);

/**
 * THE MESSAGE HAS TO BE TRUE ON BOTH PATHS, and the first draft was not. It
 * read "failure line(s) that the exit code did not [report]" - which is a lie
 * on an ordinary red run, where the exit code reported it perfectly well and
 * this script merely says so a second time. A gate whose wording names the
 * wrong cause sends the next reader looking in the wrong place; this file
 * exists because of one of those.
 */
console.error(
  `::error::The TAP stream reports ${findings.length} failure line(s). ` +
    "This is checked separately from the exit code on purpose: a suite-level " +
    "hook failure (failureType: hookFailed) exits ZERO in node --test, so a " +
    "broken `after` cleanup would otherwise leave the step green.",
);
for (const { number, line } of findings.slice(0, 40))
  console.error(`  ${path}:${number}: ${line}`);
if (findings.length > 40)
  console.error(`  ... and ${findings.length - 40} more`);
process.exit(1);
