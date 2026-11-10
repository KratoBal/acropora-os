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

/*
  THE GATE'S TODO EXEMPTION (barracuda on #2393): a failing `todo` test is `not ok N - name # TODO` with the suite `ok`, and
  node exits 0 on purpose. A name that contains the words is escaped by node (`\\# TODO`), so a real failure keeps its line.
  The lines below are the shapes measured on node v22.23.3; the gate runs on a log file, as in CI.
*/
describe("tap-stream-gate: todo tests", () => {
  const GATE = "../../scripts/tap-stream-gate.mjs";

  function gateOn(...lines: string[]) {
    const path = join(
      directory,
      `tap-${Math.random().toString(36).slice(2)}.log`,
    );
    writeFileSync(path, `${lines.join("\n")}\n`);
    return spawnSync(process.execPath, [GATE, path], {
      encoding: "utf8",
      env: cleanEnvironment(),
    });
  }

  it("lets a failing todo test through, with or without a reason, indented or turbo-prefixed", () => {
    assert.equal(gateOn("    not ok 1 - failing todo # TODO later").status, 0);
    assert.equal(gateOn("not ok 2 - later # TODO").status, 0);
    assert.equal(
      gateOn("@acropora/api:test:     not ok 3 - x # TODO soon").status,
      0,
    );
    assert.equal(
      gateOn("2026-11-10T22:00:00.0000000Z     not ok 4 - y # TODO").status,
      0,
    );
  });

  it("still refuses a real failure, a suite failure, and a test whose NAME holds the words (node escapes the hash)", () => {
    assert.equal(gateOn("    not ok 1 - a failing test").status, 1);
    assert.equal(gateOn("not ok 2 - the suite").status, 1);
    assert.equal(
      gateOn("    not ok 2 - name with a hash \\# TODO in it").status,
      1,
    );
  });

  it("a hook failure is refused even next to a todo line", () => {
    const result = gateOn(
      "    not ok 1 - failing todo # TODO",
      "  failureType: 'hookFailed'",
    );
    assert.equal(result.status, 1);
  });

  it("the premise: node itself exits 0 and keeps the suite ok on a failing todo test", () => {
    const path = fixture(
      "todo",
      'describe("g", () => { it("t", { todo: true }, () => { throw new Error("no"); }); });',
    );
    const plain = spawnSync(process.execPath, ["--test", path], {
      encoding: "utf8",
      env: cleanEnvironment(),
    });
    assert.equal(plain.status, 0);
    assert.equal(run(path).status, 0);
  });
});
