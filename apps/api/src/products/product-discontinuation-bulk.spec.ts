import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";

import {
  BULK_USAGE,
  parseBulkFile,
  runBulkDiscontinuation,
  type BulkDeps,
} from "./product-discontinuation-bulk.mag.js";

/** SKU to product id: the SKU `X-1` belongs to product `p-X-1`, and so on; `AMB` is on two products. */
const PRODUCTS: Record<string, string[]> = {
  "OLD-1": ["p-old-1"],
  "OLD-2": ["p-old-2"],
  "OLD-3": ["p-old-3"],
  "NEW-1": ["p-new-1"],
  "NEW-2": ["p-new-2"],
  AMB: ["p-a", "p-b"],
};

function harness(
  overrides: Partial<BulkDeps> = {},
  marks: Record<string, string | null> = {},
  refusals: Record<string, string> = {},
  replacers: Record<string, string[]> = {},
) {
  const calls: string[] = [];
  const deps: BulkDeps = {
    actorExists: async (id) => {
      calls.push(`actor:${id}`);
      return id === "user-1";
    },
    resolveSkus: async (skus) => {
      calls.push("resolve");
      return new Map(
        skus.filter((s) => s in PRODUCTS).map((s) => [s, PRODUCTS[s]!]),
      );
    },
    currentMark: async (productId) => {
      calls.push(`current:${productId}`);
      return productId in marks
        ? { replacementProductId: marks[productId]! }
        : null;
    },
    check: async (productId, replacementId, ignoreMarksOf) => {
      calls.push(`check:${productId}>${replacementId}`);
      // the database's own rule: a product some mark points at is refused, unless those marks are ignored
      if ((replacers[productId] ?? []).some((m) => !ignoreMarksOf.includes(m)))
        return "PRODUCT_IS_A_REPLACEMENT";
      return refusals[productId] ?? null;
    },
    write: async (productId, replacementId, actor) => {
      calls.push(`write:${productId}>${replacementId}:${actor}`);
    },
    ...overrides,
  };
  const out: string[] = [];
  const err: string[] = [];
  return {
    calls,
    out,
    err,
    deps,
    io: {
      stdout: (t: string) => out.push(t),
      stderr: (t: string) => err.push(t),
    },
  };
}

const run = (argv: string[], file: string, h: ReturnType<typeof harness>) =>
  runBulkDiscontinuation(argv, { readFile: () => file, env: {} }, h.deps, h.io);
const lines = (h: ReturnType<typeof harness>) => h.out.join("").split("\n");
const WRITES = (h: ReturnType<typeof harness>) =>
  h.calls.filter((c) => c.startsWith("write:"));

describe("parseBulkFile", () => {
  it("skips comments, empty lines and one header, accepts CRLF, and reports a bad row instead of guessing", () => {
    const parsed = parseBulkFile(
      "sku\treplacement\r\n# a comment\r\n\r\nOLD-1\tNEW-1\r\nOLD-2\r\nOLD-3\t\r\nX\tY\tZ\r\n\tNEW-1\r\n",
    );
    assert.deepEqual(parsed.rows, [
      { line: 4, sku: "OLD-1", replacementSku: "NEW-1" },
      { line: 5, sku: "OLD-2", replacementSku: null },
      { line: 6, sku: "OLD-3", replacementSku: null },
    ]);
    assert.deepEqual(parsed.badLines, [
      { line: 7, reason: "BAD_ROW" },
      { line: 8, reason: "BAD_ROW" },
    ]);
  });

  it("a byte order mark at the start (an Excel TSV) is harmless: the header is still a header and the first SKU is a SKU (trim() removes U+FEFF)", () => {
    const withHeader = parseBulkFile("\uFEFFsku\treplacement\nOLD-1\tNEW-1\n");
    assert.deepEqual(withHeader.rows, [
      { line: 2, sku: "OLD-1", replacementSku: "NEW-1" },
    ]);
    const withoutHeader = parseBulkFile("\uFEFFOLD-1\tNEW-1\n");
    assert.deepEqual(withoutHeader.rows, [
      { line: 1, sku: "OLD-1", replacementSku: "NEW-1" },
    ]);
  });

  it("a SKU that only looks like a header is a row when it is not the first data line", () => {
    const parsed = parseBulkFile("OLD-1\tNEW-1\nsku\tNEW-2\n");
    assert.equal(parsed.rows.length, 2);
  });
});

describe("the bulk command: arguments", () => {
  it("--actor is required, with no default: nothing is read or resolved", async () => {
    const h = harness();
    assert.equal(await run(["--file", "f.tsv"], "OLD-1\n", h), 2);
    assert.deepEqual(h.calls, []);
    assert.match(h.err.join(""), /--actor kotelezo/);
  });

  it("--file is required, an unknown argument stops, a missing value stops", async () => {
    for (const argv of [
      ["--actor", "user-1"],
      ["--file", "f.tsv", "--actor", "user-1", "--force"],
      ["--file", "--actor", "user-1"],
    ]) {
      const h = harness();
      assert.equal(await run(argv, "OLD-1\n", h), 2, argv.join(" "));
      assert.deepEqual(h.calls, []);
    }
  });

  it("an unknown actor stops everything before a row is read", async () => {
    const h = harness();
    assert.equal(
      await run(["--file", "f.tsv", "--actor", "ghost"], "OLD-1\n", h),
      2,
    );
    assert.deepEqual(h.calls, ["actor:ghost"]);
    assert.match(h.err.join(""), /ACTOR_NOT_FOUND/);
  });

  it("an unreadable file is a 2, with no path or system text in the message", async () => {
    const h = harness();
    const code = await runBulkDiscontinuation(
      ["--file", "/secret/f.tsv", "--actor", "user-1"],
      {
        readFile: () => {
          throw new Error("ENOENT: /secret/f.tsv");
        },
        env: {},
      },
      h.deps,
      h.io,
    );
    assert.equal(code, 2);
    assert.doesNotMatch(h.err.join(""), /secret|ENOENT/);
  });
});

describe("the bulk command: --input-env (a base64 TSV in an environment variable)", () => {
  const TSV = "sku\treplacement\nOLD-1\tNEW-1\nOLD-2\n";
  const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
  const runEnv = (
    argv: string[],
    env: Record<string, string | undefined>,
    h: ReturnType<typeof harness>,
  ) =>
    runBulkDiscontinuation(
      argv,
      {
        readFile: () => {
          throw new Error("the file must not be read");
        },
        env,
      },
      h.deps,
      h.io,
    );
  const ARGV = ["--input-env", "BULK_INPUT", "--actor", "user-1"];

  it("reads the TSV from the variable, and the output is the one the same file gives", async () => {
    const fromEnv = harness();
    const fromFile = harness();
    assert.equal(await runEnv(ARGV, { BULK_INPUT: b64(TSV) }, fromEnv), 0);
    await run(["--file", "f.tsv", "--actor", "user-1"], TSV, fromFile);
    assert.deepEqual(fromEnv.out, fromFile.out);
    assert.match(fromEnv.out.join(""), /2\tOLD-1\tNEW-1\tWOULD_WRITE/);
  });

  it("accepts a base64 wrapped over several lines and a TSV that starts with a byte order mark", async () => {
    const encoded = b64("\uFEFF" + TSV);
    const wrapped = (encoded.match(/.{1,20}/g) ?? []).join("\n");
    const h = harness();
    assert.equal(await runEnv(ARGV, { BULK_INPUT: wrapped }, h), 0);
    assert.match(h.out.join(""), /2\tOLD-1\tNEW-1\tWOULD_WRITE/);
  });

  it("--apply works from the variable too", async () => {
    const h = harness();
    assert.equal(
      await runEnv([...ARGV, "--apply"], { BULK_INPUT: b64(TSV) }, h),
      0,
    );
    assert.deepEqual(WRITES(h), [
      "write:p-old-1>p-new-1:user-1",
      "write:p-old-2>null:user-1",
    ]);
  });

  it("--file and --input-env together are refused, and so is neither, a bad variable name and a missing value", async () => {
    for (const argv of [
      ["--file", "f.tsv", "--input-env", "BULK_INPUT", "--actor", "user-1"],
      ["--actor", "user-1"],
      ["--input-env", "bad name", "--actor", "user-1"],
      ["--input-env"],
    ]) {
      const h = harness();
      assert.equal(await runEnv(argv, { BULK_INPUT: b64(TSV) }, h), 2);
      assert.deepEqual(h.calls, [], argv.join(" "));
    }
    // the "together" case is refused for THAT reason, not because the file happens to be unreadable
    const both = harness();
    await runEnv(
      ["--file", "f.tsv", "--input-env", "BULK_INPUT", "--actor", "user-1"],
      { BULK_INPUT: b64(TSV) },
      both,
    );
    assert.match(both.err.join(""), /egyutt nem adhato/);
  });

  it("an unset or empty variable stops with a code and reads nothing", async () => {
    for (const env of [{}, { BULK_INPUT: "" }, { BULK_INPUT: "   \n" }]) {
      const h = harness();
      assert.equal(await runEnv(ARGV, env, h), 2);
      assert.deepEqual(h.calls, []);
      assert.match(h.err.join(""), /INPUT_ENV_NOT_SET/);
    }
  });

  it("a variable that is not base64 stops with a code and the value is never printed", async () => {
    const secretish = "OLD-1\tNEW-1 not base64!";
    const h = harness();
    assert.equal(await runEnv(ARGV, { BULK_INPUT: secretish }, h), 2);
    assert.deepEqual(h.calls, []);
    assert.match(h.err.join(""), /INPUT_ENV_NOT_BASE64/);
    assert.doesNotMatch(h.err.join("") + h.out.join(""), /OLD-1|not base64/);
  });
});

describe("the bulk command: dry run and apply", () => {
  const ARGV = ["--file", "f.tsv", "--actor", "user-1"];
  const FILE = "sku\treplacement\nOLD-1\tNEW-1\nOLD-2\n";

  it("the default is a dry run: it prints what it would write and writes NOTHING", async () => {
    const h = harness();
    assert.equal(await run(ARGV, FILE, h), 0);
    assert.deepEqual(WRITES(h), []);
    assert.deepEqual(lines(h).slice(0, 4), [
      "MODE\tDRY_RUN\tactor=user-1\trows=2",
      "2\tOLD-1\tNEW-1\tWOULD_WRITE\t-",
      "3\tOLD-2\t-\tWOULD_WRITE\t-",
      "SUMMARY\twritten=0\twould_write=2\talready=0\trefused=0\terror=0",
    ]);
    assert.match(h.out.join(""), /SZARAZFUTAS: semmi nem irodott/);
  });

  it("--apply writes each row through the write path with the named actor, in file order", async () => {
    const h = harness();
    assert.equal(await run([...ARGV, "--apply"], FILE, h), 0);
    assert.deepEqual(WRITES(h), [
      "write:p-old-1>p-new-1:user-1",
      "write:p-old-2>null:user-1",
    ]);
    assert.match(h.out.join(""), /MODE\tAPPLY\tactor=user-1\trows=2/);
    assert.match(h.out.join(""), /written=2\twould_write=0/);
    assert.doesNotMatch(h.out.join(""), /SZARAZFUTAS/);
  });

  it("the dry run and the apply print the same rows (only the status word differs)", async () => {
    const file = "OLD-1\tNEW-1\nOLD-2\tNEW-1\nNOPE\nOLD-3\tNEW-2\nOLD-3\n";
    const refusals = { "p-old-2": "REPLACEMENT_NOT_SELLABLE" };
    const dry = harness({}, {}, refusals);
    const applied = harness({}, {}, refusals);
    await run(ARGV, file, dry);
    await run([...ARGV, "--apply"], file, applied);
    const rows = (h: ReturnType<typeof harness>) =>
      lines(h)
        .slice(1)
        .filter((l) => /^\d/.test(l))
        .map((l) => l.replace("WOULD_WRITE", "X").replace("WRITTEN", "X"));
    assert.deepEqual(rows(dry), rows(applied));
  });

  it("refuses an unknown SKU, an unknown replacement SKU, an ambiguous SKU, a repeated product and the repository's own refusal, each with its code, and goes on", async () => {
    const h = harness({}, {}, { "p-old-3": "REPLACEMENT_ALSO_DISCONTINUED" });
    const code = await run(
      ARGV,
      "NOPE\nOLD-1\tNOPE2\nAMB\nOLD-2\tNEW-1\nOLD-2\tNEW-2\nOLD-3\tNEW-2\n",
      h,
    );
    assert.equal(code, 1);
    assert.deepEqual(lines(h).slice(1, 7), [
      "1\tNOPE\t-\tREFUSED\tSKU_NOT_FOUND",
      "2\tOLD-1\tNOPE2\tREFUSED\tREPLACEMENT_SKU_NOT_FOUND",
      "3\tAMB\t-\tREFUSED\tSKU_AMBIGUOUS",
      "4\tOLD-2\tNEW-1\tWOULD_WRITE\t-",
      "5\tOLD-2\tNEW-2\tREFUSED\tDUPLICATE_ROW",
      "6\tOLD-3\tNEW-2\tREFUSED\tREPLACEMENT_ALSO_DISCONTINUED",
    ]);
  });

  it("the interplay inside the file is refused as a write would refuse it, in dry run and in apply", async () => {
    for (const apply of [false, true]) {
      const argv = apply ? [...ARGV, "--apply"] : ARGV;
      // a product that an earlier row made a replacement cannot be marked
      const a = harness();
      await run(argv, "OLD-1\tNEW-1\nNEW-1\n", a);
      assert.match(
        a.out.join(""),
        /NEW-1\t-\tREFUSED\tPRODUCT_IS_A_REPLACEMENT/,
      );
      // a replacement that an earlier row marks is a chain
      const b = harness();
      await run(argv, "NEW-1\nOLD-1\tNEW-1\n", b);
      assert.match(
        b.out.join(""),
        /OLD-1\tNEW-1\tREFUSED\tREPLACEMENT_ALSO_DISCONTINUED/,
      );
      assert.equal(WRITES(b).length, apply ? 1 : 0);
    }
  });

  it("a row that rewrites a mark frees its old replacement for a later row, in the dry run exactly as in apply", async () => {
    // A (old-1) points at B (new-1); the file moves A to C (new-2), then marks B
    const marks = { "p-old-1": "p-new-1" };
    const replacers = { "p-new-1": ["p-old-1"] };
    const file = "OLD-1\tNEW-2\nNEW-1\n";
    const dry = harness({}, marks, {}, replacers);
    const applied = harness({}, marks, {}, replacers);
    await run(ARGV, file, dry);
    await run([...ARGV, "--apply"], file, applied);
    assert.match(dry.out.join(""), /2\tNEW-1\t-\tWOULD_WRITE\t-/);
    assert.match(applied.out.join(""), /2\tNEW-1\t-\tWRITTEN\t-/);
    // and without the first row, B is still refused: the free-up comes from the file and nothing else
    const alone = harness({}, marks, {}, replacers);
    await run(ARGV, "NEW-1\n", alone);
    assert.match(
      alone.out.join(""),
      /1\tNEW-1\t-\tREFUSED\tPRODUCT_IS_A_REPLACEMENT/,
    );
  });

  it("the write is made with the bulk-cli marker in the command (the audit shows the path)", async () => {
    const source = readFileSync(
      "src/products/product-discontinuation-bulk.cli.ts",
      "utf8",
    );
    assert.match(source, /"bulk-cli"/);
  });

  it("a product that already has exactly this mark is ALREADY: no check and no write; a different replacement is written", async () => {
    const h = harness({}, { "p-old-1": "p-new-1", "p-old-2": "p-new-1" });
    await run([...ARGV, "--apply"], "OLD-1\tNEW-1\nOLD-2\tNEW-2\n", h);
    assert.match(h.out.join(""), /1\tOLD-1\tNEW-1\tALREADY\t-/);
    assert.match(h.out.join(""), /2\tOLD-2\tNEW-2\tWRITTEN\t-/);
    assert.deepEqual(WRITES(h), ["write:p-old-2>p-new-2:user-1"]);
    assert.equal(h.calls.includes("check:p-old-1>p-new-1"), false);
  });

  it("a failing write is an ERROR line with a generic code (never the error text), the next row still runs, the exit is 1", async () => {
    const h = harness({
      write: async (productId) => {
        if (productId === "p-old-1")
          throw new Error("connect ECONNREFUSED secret-host.example:5432");
      },
    });
    const code = await run([...ARGV, "--apply"], "OLD-1\tNEW-1\nOLD-2\n", h);
    assert.equal(code, 1);
    assert.match(h.out.join(""), /1\tOLD-1\tNEW-1\tERROR\tWRITE_FAILED/);
    assert.match(h.out.join(""), /2\tOLD-2\t-\tWRITTEN\t-/);
    assert.doesNotMatch(
      h.out.join("") + h.err.join(""),
      /secret-host|ECONNREFUSED/,
    );
  });

  it("a refusal that comes back from the write itself (a race after the check) is a REFUSED line with its code", async () => {
    const h = harness({
      write: async () => {
        throw Object.assign(new Error("REPLACEMENT_NOT_SELLABLE"), {
          refusal: "REPLACEMENT_NOT_SELLABLE",
        });
      },
    });
    assert.equal(await run([...ARGV, "--apply"], "OLD-1\tNEW-1\n", h), 1);
    assert.match(
      h.out.join(""),
      /OLD-1\tNEW-1\tREFUSED\tREPLACEMENT_NOT_SELLABLE/,
    );
  });

  it("bad lines are reported in file order with the rest and make the exit 1", async () => {
    const h = harness();
    const code = await run(ARGV, "OLD-1\nA\tB\tC\nOLD-2\n", h);
    assert.equal(code, 1);
    assert.deepEqual(lines(h).slice(1, 4), [
      "1\tOLD-1\t-\tWOULD_WRITE\t-",
      "2\t-\t-\tREFUSED\tBAD_ROW",
      "3\tOLD-2\t-\tWOULD_WRITE\t-",
    ]);
  });
});

/** The path of the package root (`apps/api`), because the spec runs from `test-dist`. */
const COMPILED = "dist/products/product-discontinuation-bulk.cli.js";
const SOURCE = "src/products/product-discontinuation-bulk";

describe("the bulk command: start", () => {
  it("starts in a separate process: --help prints the usage and exits 0", () => {
    // the diagnosis comes before the run: a missing `dist` is not the code's fault
    assert.ok(
      existsSync(COMPILED),
      `the compiled command is MISSING (${COMPILED}) -- this is NOT the code's fault: the package test does not build dist; run it the repo's way (turbo run test --filter=@acropora/api).`,
    );
    const stale = [".mag.ts", ".cli.ts"]
      .map((end) => `${SOURCE}${end}`)
      .filter((path) => statSync(path).mtimeMs > statSync(COMPILED).mtimeMs);
    assert.deepEqual(
      stale,
      [],
      "the compiled command is OLDER than its source -- rebuild it.",
    );
    const output = execFileSync("node", [COMPILED, "--help"], {
      encoding: "utf8",
    });
    assert.equal(output, BULK_USAGE);
  });

  it("the import direction runs one way: the body does not know the command", () => {
    const body = readFileSync(`${SOURCE}.mag.ts`, "utf8");
    const command = readFileSync(`${SOURCE}.cli.ts`, "utf8");
    assert.ok(body.length > 500 && command.length > 500);
    assert.doesNotMatch(body, /(?:from|import)\s+"[^"]*bulk\.cli\.js"/);
    assert.match(command, /product-discontinuation-bulk\.mag\.js/);
  });
});
