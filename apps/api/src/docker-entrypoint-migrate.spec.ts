import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

/**
 * THE REEFCLUB ROLE'S RIGHTS AFTER THE MIGRATIONS (card 4f0ad1be):
 * `applyReefclubRole` in `docker-entrypoint-migrate.cjs`, with the two steps
 * (does the role exist, run the file) stood in. The real steps were measured
 * on a PostgreSQL 17 database (see the PR): the file runs as one transaction.
 *
 * What turns these red: the file run where the role does not exist (it would
 * stop on the role's name); the file not run where it does; a failure or a
 * timeout that throws (the internal API would not start over the ReefClub's
 * grants) or that is not said on the error log; a manual command that is not
 * one transaction; a success or a skip said as an error.
 */
const load = createRequire(import.meta.url);
const { applyReefclubRole } = load("../docker-entrypoint-migrate.cjs") as {
  applyReefclubRole: (steps: {
    rolePresent: () => Promise<boolean>;
    execute: () => { status: number; timedOut: boolean };
    log: (line: string) => void;
    error: (line: string) => void;
  }) => Promise<"applied" | "skipped" | "error">;
};

function run(
  rolePresent: () => Promise<boolean>,
  status = 0,
  timedOut = false,
) {
  const lines = { log: [] as string[], error: [] as string[], executed: 0 };
  const outcome = applyReefclubRole({
    rolePresent,
    execute: () => (lines.executed++, { status, timedOut }),
    log: (line) => lines.log.push(line),
    error: (line) => lines.error.push(line),
  });
  return { outcome, lines };
}

describe("applyReefclubRole", () => {
  it("applies the file where the role exists, and says so", async () => {
    const { outcome, lines } = run(async () => true);
    assert.equal(await outcome, "applied");
    assert.equal(lines.executed, 1);
    assert.deepEqual(lines.error, []);
    assert.match(lines.log.join("\n"), /reefclub-role\.sql applied/);
  });

  it("skips the file where the role does not exist, on the normal log", async () => {
    const { outcome, lines } = run(async () => false);
    assert.equal(await outcome, "skipped");
    assert.equal(lines.executed, 0);
    assert.deepEqual(lines.error, []);
    assert.match(lines.log.join("\n"), /no reefclub_app role/);
  });

  it("a failed file is an ERROR line with the manual command, not a throw", async () => {
    const { outcome, lines } = run(async () => true, 1);
    assert.equal(await outcome, "error");
    assert.equal(lines.executed, 1);
    assert.equal(lines.error.length, 1);
    assert.match(lines.error[0]!, /^ERROR reefclub-role: .*exit 1/);
    assert.match(lines.error[0]!, /keeps the rights it had/);
    assert.match(
      lines.error[0]!,
      /-f packages\/database\/sql\/reefclub-role\.sql/,
    );
    // by hand it must be one transaction too (barracuda, #2437)
    assert.match(lines.error[0]!, /psql "\$DATABASE_URL" -1 /);
  });

  it("a run cut by the timeout is an ERROR line that says so, not a throw", async () => {
    const { outcome, lines } = run(async () => true, 1, true);
    assert.equal(await outcome, "error");
    assert.equal(lines.error.length, 1);
    assert.match(lines.error[0]!, /did not finish in 60 s and was stopped/);
    assert.match(lines.error[0]!, /next start tries again/);
  });

  it("a role check that fails is an ERROR line too, and the file is not run", async () => {
    const { outcome, lines } = run(async () => {
      throw new Error("connection refused");
    });
    assert.equal(await outcome, "error");
    assert.equal(lines.executed, 0);
    assert.match(lines.error.join("\n"), /connection refused/);
  });
});
