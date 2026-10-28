import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { NotFoundException } from "@nestjs/common";
import { prisma } from "@acropora/database";

import { parseRunInput } from "../enrichment/enrichment-run.cli.js";
import { pageKey } from "../enrichment/enrichment-sources.js";
import type { ProductService } from "../product.service.js";
import {
  AUTO_ACCEPT_RULE,
  runAutoAccept,
  type AutoAcceptDeps,
  type AutoOutcome,
  type AutoResult,
} from "./knowledge-auto-accept.js";
import { PrismaKnowledgeStore } from "./knowledge.repository.js";
import { ProductKnowledgeService } from "./knowledge.service.js";

/**
 * THE RULE'S ACCEPT, BY HAND (Product Knowledge step 2, card 85c38ab1):
 *
 *   pnpm --filter @acropora/api knowledge:auto-accept --input <file.json> [--apply --actor <userId>]
 *
 * In the production image (no pnpm), in the container with `-w /app`:
 *
 *   node dist/products/knowledge/knowledge-auto-accept.cli.js --input <file.json> [--apply --actor <userId>]
 *
 * The input is the JEV run's own (`{ "products": [ { "productId": "..." } ] }`),
 * so the file a check ran on is the file its results are accepted from.
 *
 * WITHOUT `--apply` it only reads, and prints per product and field what it
 * would accept and what it leaves for a person, with the reason. WITH
 * `--apply` it accepts through the service's own accept (the same checks as a
 * person's: a finished run, the latest result, the field's definition), marked
 * `acceptedByRule`, with `--actor` (an existing user) as the one who ran it.
 * Such a fact stays in the OS: the Medusa projection does not take it.
 *
 * Exit: 0 finished; 2 bad input or unknown actor; 4 finished, but the service
 * refused at least one accept (each one printed).
 */
export interface AutoAcceptCliDeps extends AutoAcceptDeps {
  readInput(path: string): Promise<string>;
  actorExists(userId: string): Promise<boolean>;
}

type Output = { stdout: (t: string) => void; stderr: (t: string) => void };

function option(argv: readonly string[], name: string): string | null {
  const at = argv.indexOf(name);
  return at >= 0 ? (argv[at + 1] ?? null) : null;
}

export async function runAutoAcceptCli(
  argv: readonly string[],
  out: Output,
  deps: (actorId: string | null) => AutoAcceptCliDeps,
): Promise<number> {
  const inputPath = option(argv, "--input");
  const apply = argv.includes("--apply");
  const actor = option(argv, "--actor");
  if (!inputPath) {
    out.stderr("Hiányzik: --input <fájl.json>\n");
    return 2;
  }
  if (apply && !actor) {
    out.stderr("Az --apply mellé --actor <userId> kell: ki futtatta.\n");
    return 2;
  }
  const d = deps(apply ? actor : null);
  const parsed = parseRunInput(await d.readInput(inputPath));
  if (!parsed.ok) {
    out.stderr(`${parsed.problems.join("\n")}\n`);
    return 2;
  }
  if (apply && !(await d.actorExists(actor!))) {
    out.stderr(`Nincs ilyen felhasználó: ${actor}\n`);
    return 2;
  }
  const outcomes = await runAutoAccept(
    parsed.products.map((p) => p.productId),
    apply,
    d,
  );
  out.stdout(report(outcomes, apply));
  return outcomes.some((o) => o.kind === "FAILED") ? 4 : 0;
}

export function report(
  outcomes: readonly AutoOutcome[],
  apply: boolean,
): string {
  const lines = outcomes.map(
    (o) => `${o.kind.padEnd(13)} ${o.productId} ${o.field}  ${o.detail}`,
  );
  const n = (kind: AutoOutcome["kind"]) =>
    outcomes.filter((o) => o.kind === kind).length;
  lines.push(
    apply
      ? `Összesen: elfogadva ${n("ACCEPTED")} (${AUTO_ACCEPT_RULE}), emberhez ${n("SKIP")}, a szolgáltatás elutasította ${n("FAILED")}`
      : `Összesen: elfogadná ${n("WOULD_ACCEPT")}, emberhez ${n("SKIP")}. Ez a futás nem írt. Az íráshoz: --apply --actor <userId>`,
  );
  return `${lines.join("\n")}\n`;
}

/* c8 ignore start */
async function latestResult(
  productId: string,
  field: string,
): Promise<AutoResult | null> {
  // the same "latest" as the service's own (`PrismaKnowledgeStore.latestFieldResult`)
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT f.id
    FROM "ProductEnrichmentFieldResult" f
    JOIN "ProductEnrichmentRunProduct" c ON c.id = f."checkId"
    JOIN "ProductEnrichmentRun" r ON r.id = c."runId"
    WHERE c."productId" = ${productId}
      AND f.field = ${field}
      AND r.status IN ('COMPLETED', 'LIMIT_REACHED')
    ORDER BY c."checkedAt" DESC, f.id DESC
    LIMIT 1`;
  const id = rows[0]?.id;
  if (!id) return null;
  const row = await prisma.productEnrichmentFieldResult.findUnique({
    where: { id },
    select: { id: true, status: true, value: true, evidence: true },
  });
  return row
    ? {
        ...row,
        evidence: Array.isArray(row.evidence) ? (row.evidence as never) : [],
      }
    : null;
}

/**
 * Of a product's pages, those that belong to ANOTHER product too: its UNAS
 * manufacturer link, or a page in its run evidence (any field). Compared
 * without query, fragment, case and trailing slash (a UNAS link with
 * `?utm_source=` is the run's clean page; barracuda, #1810): a wider match
 * only sends more to a person.
 *
 * Each shared page comes with the dose every such product takes from it: its
 * latest VERIFIED `dosing` result, when an accepted page of it is this page;
 * `null` otherwise (a product with only the UNAS link has no dose from it).
 * The rule accepts from a shared page only when all of them equal its own
 * (acrobot 35067).
 */
export async function sharedPages(
  productId: string,
  pages: readonly string[],
): Promise<Map<string, (string | null)[]>> {
  const shared = new Map<string, (string | null)[]>();
  for (const page of pages) {
    const key = pageKey(page);
    const others = await prisma.$queryRaw<{ productId: string }[]>`
      SELECT s."productId"
      FROM "UnasProductSnapshot" s
      WHERE s."productId" <> ${productId}
        AND rtrim(lower(split_part(split_part(s."manufacturerUrl", '#', 1), '?', 1)), '/') = ${key}
      UNION
      SELECT c."productId"
      FROM "ProductEnrichmentFieldResult" f
      JOIN "ProductEnrichmentRunProduct" c ON c.id = f."checkId"
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(f.evidence) = 'array' THEN f.evidence ELSE '[]'::jsonb END
      ) e
      WHERE c."productId" <> ${productId}
        AND rtrim(lower(split_part(split_part(e->>'sourceRef', '#', 1), '?', 1)), '/') = ${key}
      ORDER BY 1`;
    if (others.length === 0) continue;
    const doses: (string | null)[] = [];
    for (const other of others) {
      const dose = await latestResult(other.productId, "dosing");
      const fromHere =
        dose?.status === "VERIFIED" &&
        dose.value !== null &&
        dose.evidence.some(
          (e) =>
            e.accepted &&
            e.sourceKind !== "OS" &&
            e.sourceRef !== null &&
            pageKey(e.sourceRef) === key,
        );
      doses.push(fromHere ? dose!.value : null);
    }
    shared.set(page, doses);
  }
  return shared;
}

async function main(): Promise<void> {
  const code = await runAutoAcceptCli(
    process.argv.slice(2),
    {
      stdout: (t) => process.stdout.write(t),
      stderr: (t) => process.stderr.write(t),
    },
    (actorId) => {
      const products = {
        getProduct: async (id: string) => {
          const row = await prisma.product.findUnique({
            where: { id },
            select: { id: true },
          });
          if (!row) throw new NotFoundException("A termék nem található.");
          return row;
        },
      } as unknown as ProductService;
      const service = new ProductKnowledgeService(
        products,
        new PrismaKnowledgeStore(),
      );
      return {
        readInput: (path) => readFile(path, "utf8"),
        actorExists: async (id) =>
          (await prisma.user.findUnique({
            where: { id },
            select: { id: true },
          })) !== null,
        latestResult,
        sharedPages,
        productFact: (productId, field) =>
          prisma.productKnowledgeFact.findUnique({
            where: {
              productId_scopeKey_field: { productId, scopeKey: "", field },
            },
            select: { fieldResultId: true, acceptedByRule: true, value: true },
          }),
        accept: async (productId, fieldResultId, rule) => {
          if (!actorId) throw new Error("no actor: a dry run does not accept");
          await service.accept(
            productId,
            fieldResultId,
            { id: actorId },
            undefined,
            rule,
          );
        },
      };
    },
  );
  await prisma.$disconnect();
  process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
/* c8 ignore stop */
