import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

/*
  THE UNIT RUNNER'S GATE (card 0225aaf3): `scripts/node-test-gated.mjs` must fail on the shapes plain `node --test` passes.

  The wrapper's path is the package root's (`../../scripts`, the cwd of the test run), not `import.meta.url`'s: the compiled run
  executes from `test-dist/`. Each fixture is a tiny spec file written at run time, run by the real wrapper in a child process.
*/
const WRAPPER = "../../scripts/node-test-gated.mjs";

const directory = mkdtempSync(join(tmpdir(), "node-test-gated-spec-"));
after(() => rmSync(directory, { recursive: true, force: true }));

/** Inside a `node --test` run the variable makes a child `node --test` skip its files ("called recursively"): the child must start clean. */
const cleanEnvironment = (): NodeJS.ProcessEnv => {
  const { NODE_TEST_CONTEXT: _context, ...rest } = process.env;
  return rest;
};

function fixture(name: string, body: string): string {
  const path = join(directory, `${name}.spec.mjs`);
  writeFileSync(
    path,
    `import { after, describe, it } from "node:test";\n${body}`,
  );
  return path;
}

function run(...files: string[]) {
  return spawnSync(process.execPath, [WRAPPER, ...files], {
    encoding: "utf8",
    env: cleanEnvironment(),
  });
}

describe("node-test-gated", () => {
  it("passes a green spec (the positive control: the gate does not refuse everything)", () => {
    const result = run(
      fixture("green", 'describe("g", () => { it("a", () => {}); });'),
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /# pass 1/);
  });

  it("fails a describe body that throws, which plain node --test passes with exit 0", () => {
    const path = fixture(
      "describe-throw",
      'describe("g", () => { throw new Error("boom"); });',
    );
    const plain = spawnSync(process.execPath, ["--test", path], {
      encoding: "utf8",
      env: cleanEnvironment(),
    });
    assert.equal(plain.status, 0, "the premise: node alone is green here");
    const result = run(path);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /TAP stream reports/);
  });

  it("fails an after hook that throws", () => {
    const result = run(
      fixture(
        "after-throw",
        'describe("g", () => { after(() => { throw new Error("boom"); }); it("a", () => {}); });',
      ),
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /hookFailed/);
  });

  it("fails a failing test by node's own exit code", () => {
    const result = run(
      fixture(
        "failing",
        'describe("g", () => { it("a", () => { throw new Error("no"); }); });',
      ),
    );
    assert.notEqual(result.status, 0);
  });

  it("does not take no file for a pass", () => {
    const result = run();
    assert.equal(result.status, 2);
  });
});
