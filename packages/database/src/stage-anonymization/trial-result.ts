import type { TrialCheck } from "./verification-gate.js";

/**
 * THE WORKING TRIAL'S RESULT FROM ITS COMMAND (stage anonymization chain, slice S6). The trial command (a script that starts an
 * application instance bound to the TEMPORARY database and runs a stub invoice, an order flow, a work sheet and a ticket) reports
 * on its STANDARD OUTPUT, last non-empty line, one JSON object:
 *
 *   {"checks":[{"name":"a work sheet is created","passed":true}, ...]}
 *
 * and its exit code. The result is `passed` only when the exit code is 0 AND there is at least one check AND every check passed.
 * An output that is not that shape (no JSON, no `checks`, a check without a name or a boolean) gives NO checks, so the gate fails
 * on "reported no checks": a bare exit code 0 cannot be told from a stub (owner's operating decision, 2026-11-09).
 */
export function parseTrialResult(
  stdout: string,
  exitCode: number | null,
): { passed: boolean; checks: TrialCheck[] } {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1];
  let checks: TrialCheck[] = [];
  if (last !== undefined) {
    try {
      const parsed: unknown = JSON.parse(last);
      const raw = (parsed as { checks?: unknown } | null)?.checks;
      if (
        Array.isArray(raw) &&
        raw.every(
          (item): item is TrialCheck =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as TrialCheck).name === "string" &&
            (item as TrialCheck).name.trim() !== "" &&
            typeof (item as TrialCheck).passed === "boolean",
        )
      )
        checks = raw.map((item) => ({ name: item.name, passed: item.passed }));
    } catch {
      checks = [];
    }
  }
  return {
    passed:
      exitCode === 0 &&
      checks.length > 0 &&
      checks.every((check) => check.passed),
    checks,
  };
}
