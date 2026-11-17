import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * THE CI SETUP'S RETRY (task t-20261117-ci-akadas; .github/actions/ci-setup/retry-on-timeout.sh and its action.yml).
 *
 * WHAT TURNS RED: a command that finishes in time run more than once; a command that FAILS by itself (exit 3) run twice (a lockfile that does
 * not match would show its error twice and cost a minute); a command the limit cut NOT run again, or run a third time; a command that ignores the
 * polite stop and is never ended; the exit status of the command lost; the two installs of the action no longer going through the script.
 * Every timing case uses a 1 s limit and a 1 s grace (RETRY_KILL_AFTER), so the whole file takes a few seconds.
 */
const root = (path: string) =>
  fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const SCRIPT = root(".github/actions/ci-setup/retry-on-timeout.sh");
const dir = mkdtempSync(join(tmpdir(), "retry-on-timeout-"));
after(() => rmSync(dir, { recursive: true, force: true }));

let counter = 0;
/** Runs the script with a 1 s limit around `bash -c <body>`; the body counts its own runs in a file. */
function run(body: string, limit = "1") {
  const file = join(dir, `runs-${counter++}`);
  writeFileSync(file, "0");
  const started = Date.now();
  const result = spawnSync(
    "bash",
    [
      SCRIPT,
      limit,
      "bash",
      "-c",
      `n=$(cat "$F"); echo $((n+1)) > "$F"; ${body}`,
    ],
    {
      env: { ...process.env, RETRY_KILL_AFTER: "1", F: file },
      encoding: "utf8",
      timeout: 40_000,
    },
  );
  return {
    status: result.status,
    runs: Number(readFileSync(file, "utf8")),
    out: `${result.stdout}${result.stderr}`,
    seconds: (Date.now() - started) / 1000,
  };
}

describe("retry-on-timeout.sh", () => {
  it("a command that finishes in time runs once, with no warning", () => {
    const r = run("exit 0");
    assert.equal(r.status, 0);
    assert.equal(r.runs, 1);
    assert.ok(!r.out.includes("::warning::"));
  });

  it("CONTROL: a command that FAILS by itself is not run again, and its exit status is the answer", () => {
    const r = run("exit 3");
    assert.equal(r.status, 3);
    assert.equal(r.runs, 1);
    assert.ok(!r.out.includes("::warning::"));
  });

  it("a command the limit cut is run once more, and when that one is fine the whole is fine", () => {
    const r = run('if [ "$n" -eq 0 ]; then sleep 10; fi');
    assert.equal(r.status, 0);
    assert.equal(r.runs, 2);
    assert.ok(r.out.includes("::warning::"));
    assert.ok(r.out.includes("was cut after 1s"));
  });

  it("CONTROL: a command cut twice is NOT run a third time, and exits 124", () => {
    const r = run("sleep 10");
    assert.equal(r.status, 124);
    assert.equal(r.runs, 2);
  });

  it("a command that ignores the polite stop is ended by the kill after the grace, and counts as cut (137), once more, then 137", () => {
    const r = run("trap '' TERM; sleep 30");
    assert.equal(r.status, 137);
    assert.equal(r.runs, 2);
    // two attempts of 1 s limit plus 1 s grace each, nowhere near the 30 s of the command
    assert.ok(r.seconds < 15, `took ${r.seconds}s`);
  });

  it("the second attempt's own failure is its status: cut once, then fails with 5", () => {
    const r = run('if [ "$n" -eq 0 ]; then sleep 10; else exit 5; fi');
    assert.equal(r.status, 5);
    assert.equal(r.runs, 2);
  });

  it("refuses to run without a command or without a limit", () => {
    assert.equal(
      spawnSync("bash", [SCRIPT, "1"], { encoding: "utf8" }).status,
      2,
    );
    assert.notEqual(
      spawnSync("bash", [SCRIPT], { encoding: "utf8" }).status,
      0,
    );
  });
});

describe("the ci-setup action", () => {
  const action = readFileSync(
    root(".github/actions/ci-setup/action.yml"),
    "utf8",
  );

  it("both installs go through the script, with a limit, from the action's own directory", () => {
    assert.match(
      action,
      /run: bash "\$\{\{ github\.action_path \}\}\/retry-on-timeout\.sh" \d+ pnpm install --frozen-lockfile/,
    );
    assert.match(
      action,
      /run: bash "\$\{\{ github\.action_path \}\}\/retry-on-timeout\.sh" \d+ npm --prefix apps\/mobile ci --ignore-scripts --no-audit --no-fund/,
    );
  });

  it("CONTROL: no install is left running bare", () => {
    assert.doesNotMatch(action, /run: pnpm install/);
    assert.doesNotMatch(action, /run: npm --prefix apps\/mobile ci/);
  });
});
