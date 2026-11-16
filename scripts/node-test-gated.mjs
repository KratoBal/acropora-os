#!/usr/bin/env node
/**
 * `node --test <files>` THAT FAILS WHEN THE TAP STREAM SAYS A SUITE FAILED, WHATEVER THE EXIT CODE DID (card 0225aaf3).
 *
 * WHY: a throw in a `describe` body, or in an `after` hook, is a `not ok` line in the TAP stream but exits 0 with
 * `# fail 0`. Measured on #2391 (2026-11-10): the wiring suite read its sources through `import.meta.url` in the
 * `describe` body, threw ENOENT in the compiled run, and the whole unit job stayed green: four assertions never ran, and
 * nothing in the log but one `not ok` line said so. `scripts/tap-stream-gate.mjs` already refuses exactly this shape for the
 * integration step (it reads the log after the run); the unit runs had no such reader, so the hole was open on every package.
 *
 * WHAT IT DOES: runs `node --test` with the SAME human output as before on stdout (the spec reporter on a terminal, TAP
 * otherwise, which is what CI logs and the scripts that read them expect), a second TAP copy goes to a temporary file, and the
 * gate script reads that copy after the run. The exit code is node's own when it is non-zero, else the gate's.
 *
 * WHAT IT DOES NOT COVER, said out loud: a suite that was never discovered or ran with `# SKIP` (that is
 * `integration-suite-gate.mjs`'s ground, for the integration specs); a run that crashes before producing any TAP at all
 * (node's own non-zero exit sees that one).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const files = process.argv.slice(2);
if (files.length === 0) {
  // No file is not a pass: `node --test` with no argument would walk the working directory and run whatever it finds.
  console.error("node-test-gated: no test file given, nothing was measured.");
  process.exit(2);
}

const gate = join(
  dirname(fileURLToPath(import.meta.url)),
  "tap-stream-gate.mjs",
);
const temporary = mkdtempSync(join(tmpdir(), "node-test-gated-"));
const tapCopy = join(temporary, "tap.log");

let status = 1;
try {
  const run = spawnSync(
    process.execPath,
    [
      "--test",
      `--test-reporter=${process.stdout.isTTY ? "spec" : "tap"}`,
      "--test-reporter-destination=stdout",
      "--test-reporter=tap",
      `--test-reporter-destination=${tapCopy}`,
      ...files,
    ],
    { stdio: "inherit" },
  );
  if (run.error) console.error(`node-test-gated: ${String(run.error)}`);
  // A signal (status null) or a spawn error is a failure, not a pass.
  const nodeStatus = run.status ?? 1;
  const gated = spawnSync(process.execPath, [gate, tapCopy], {
    stdio: "inherit",
  });
  status = nodeStatus !== 0 ? nodeStatus : (gated.status ?? 1);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
process.exit(status);
