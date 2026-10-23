import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Plan v4, section 7 (mode B) and the S1 acceptance condition: there is NO
 * code path that writes a claim from a research draft. A draft is model text
 * from external sources; it becomes knowledge only by the editor recording
 * the claim through the normal workflow.
 *
 * Two layers:
 *   1. The schema: the draft model has no relation to the claim tables and
 *      the other way round, so a draft cannot even be linked to a claim.
 *   2. The code: no production source file both touches the draft model and
 *      writes a claim (through the Prisma client, or with raw SQL).
 *
 * What layer 2 cannot see: a write hidden behind a destructured client
 * (`const { knowledgeClaim } = prisma`) or split across two files that pass
 * the draft's content along. It is a tripwire for the direct path, the
 * schema layer is the structural part.
 */

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const up = dirname(dir);
    if (up === dir)
      throw new Error("pnpm-workspace.yaml not found above the test");
    dir = up;
  }
  return dir;
}

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "test-dist",
  ".next",
  ".turbo",
  "coverage",
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith("dist.")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (
      /\.(ts|tsx|mts|js|mjs)$/.test(name) &&
      !/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)
    )
      out.push(path);
  }
  return out;
}

const TOUCHES_DRAFT =
  /\.knowledgeResearchDraft\.\w+\(|"KnowledgeResearchDraft"/;
const WRITES_CLAIM =
  /\.knowledge(?:Claim|ClaimEvidence)\.(?:create|createMany|createManyAndReturn|upsert|update|updateMany)\(|INSERT\s+INTO\s+"KnowledgeClaim(?:Evidence)?"|UPDATE\s+"KnowledgeClaim(?:Evidence)?"/i;

/** The detector, separate so its own positive and negative controls can run. */
export function writesClaimFromDraft(source: string): boolean {
  return TOUCHES_DRAFT.test(source) && WRITES_CLAIM.test(source);
}

function modelBlock(schema: string, model: string): string {
  const m = new RegExp(`^model ${model} \\{[\\s\\S]*?^\\}`, "m").exec(schema);
  assert.ok(m, `model ${model} not found in the schema`);
  return m[0];
}

describe("the detector itself", () => {
  it("fires on the nearest real mistake: read a draft, create a claim", () => {
    assert.ok(
      writesClaimFromDraft(
        "const d = await prisma.knowledgeResearchDraft.findUnique({ where: { id } });\n" +
          "await tx.knowledgeClaim.create({ data: { subject: d.question } });",
      ),
    );
    assert.ok(
      writesClaimFromDraft(
        'await db.knowledgeResearchDraft.findMany();\nawait db.$executeRaw`INSERT INTO "KnowledgeClaim" ...`;',
      ),
    );
  });

  it("stays quiet on a draft read alone and on a claim write alone", () => {
    assert.ok(
      !writesClaimFromDraft("await prisma.knowledgeResearchDraft.findMany();"),
    );
    assert.ok(
      !writesClaimFromDraft("await prisma.knowledgeClaim.create({ data });"),
    );
    assert.ok(
      !writesClaimFromDraft(
        "await prisma.knowledgeResearchDraft.findMany(); prisma.knowledgeClaim.findMany();",
      ),
    );
  });
});

describe("no research draft becomes a claim", () => {
  const root = repoRoot();

  it("the schema has no relation between the draft and the claim tables", () => {
    const schema = readFileSync(
      join(root, "packages/database/prisma/schema.prisma"),
      "utf8",
    );
    const draft = modelBlock(schema, "KnowledgeResearchDraft");
    assert.doesNotMatch(
      draft,
      /\sKnowledge(?:Claim|ClaimEvidence|Passage|FieldAnchor)\b/,
    );
    for (const model of [
      "KnowledgeClaim",
      "KnowledgeClaimEvidence",
      "KnowledgeFieldAnchor",
    ])
      assert.doesNotMatch(
        modelBlock(schema, model),
        /KnowledgeResearchDraft/,
        model,
      );
  });

  it("no production source file writes a claim next to a draft", () => {
    const files = [
      ...readdirSync(join(root, "apps")).flatMap((a) => {
        const src = join(root, "apps", a, "src");
        return existsSync(src) ? sourceFiles(src) : [];
      }),
      ...readdirSync(join(root, "packages")).flatMap((p) => {
        const src = join(root, "packages", p, "src");
        return existsSync(src) ? sourceFiles(src) : [];
      }),
    ];
    // The search must see the codebase at all before its silence means anything.
    assert.ok(files.length > 500, `only ${files.length} source files scanned`);
    assert.ok(
      files.some((f) => f.endsWith(join("apps", "api", "src", "main.ts"))),
      "apps/api/src/main.ts was not among the scanned files",
    );
    const offenders = files.filter((f) =>
      writesClaimFromDraft(readFileSync(f, "utf8")),
    );
    assert.deepEqual(
      offenders.map((f) => relative(root, f)),
      [],
    );
  });
});
