import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { productEnrichmentAvailability } from "../product-enrichment-availability.js";
import {
  DEFAULT_PRODUCT_LIMIT,
  DEFAULT_REQUEST_LIMIT,
  MAX_PRODUCT_LIMIT,
  MAX_REQUEST_LIMIT,
  runEnrichment,
  sourcesFor,
  UnknownProductError,
  type EnrichmentFactsReader,
  type EnrichmentRunStore,
  type RunProductInput,
  type RunSummary,
} from "./enrichment-run.js";
import {
  PrismaEnrichmentFactsReader,
  PrismaEnrichmentRunStore,
} from "./enrichment-run.store.js";
import {
  baseDomainOf,
  isEnrichmentSourceKind,
  manufacturerSites,
  sourceUrlProblem,
} from "./enrichment-sources.js";
import type { EnrichmentFetch } from "./polite-fetcher.js";

/**
 * THE MANUAL START OF A JEV PRODUCT CHECK (PD-013 item 4).
 *
 *   pnpm --filter @acropora/api jev:enrich --input <file.json>
 *       [--max-products N] [--max-requests N] [--apply --actor <userId>]
 *
 * The input names a small product set by hand, with the page URL per source:
 *
 *   { "products": [ { "productId": "...", "sources": [
 *       { "kind": "BULK_REEF_SUPPLY", "url": "https://www.bulkreefsupply.com/..." },
 *       { "kind": "MARINE_AQUATICS",  "url": "https://marine-aquatics.eu/..." },
 *       { "kind": "MANUFACTURER",     "url": "https://<the brand's site>/..." },
 *       { "kind": "SUPPLIER", "supplierId": "...", "url": "https://<its site>/..." }
 *   ] } ] }
 *
 * The manufacturer link UNAS holds for a product is added on its own.
 *
 * WITHOUT `--apply` it only plans: it checks every product exists and every
 * URL's host against its source rule, and prints what it would read. Nothing
 * goes out on the network and nothing is stored.
 *
 * WITH `--apply` it reads the pages and stores the results in shadow. It needs
 * `JEV_PRODUCT_ENRICHMENT` not `off`, and `--actor` naming an existing user.
 * It never writes a product. There is no schedule and no whole-catalogue mode:
 * at most `MAX_PRODUCT_LIMIT` products and `MAX_REQUEST_LIMIT` requests.
 *
 * Exit: 0 finished; 1 the switch is off; 2 bad input or unknown actor or
 * product; 3 the run hit a limit and stopped (reported, not silent).
 */
export interface EnrichmentCliDeps {
  env: NodeJS.ProcessEnv;
  readInput: (path: string) => Promise<string>;
  facts: EnrichmentFactsReader;
  store: EnrichmentRunStore;
  actorExists: (userId: string) => Promise<boolean>;
  fetch: EnrichmentFetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

type Output = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

function option(argv: readonly string[], name: string): string | null {
  const at = argv.indexOf(name);
  return at >= 0 ? (argv[at + 1] ?? null) : null;
}

function limitOption(
  argv: readonly string[],
  name: string,
  fallback: number,
  max: number,
): number | string {
  const raw = option(argv, name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max)
    return `${name}: 1 és ${max} közötti egész szám kell (most: ${raw}).`;
  return value;
}

/** The input file, checked: every problem is listed, nothing is guessed. */
export function parseRunInput(
  text: string,
):
  | { ok: true; products: RunProductInput[] }
  | { ok: false; problems: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["A bemenet nem érvényes JSON."] };
  }
  const list = (json as { products?: unknown })?.products;
  if (!Array.isArray(list) || list.length === 0)
    return { ok: false, problems: ["A bemenetben nincs `products` lista."] };
  const problems: string[] = [];
  const products: RunProductInput[] = [];
  list.forEach((entry, i) => {
    const productId = (entry as { productId?: unknown })?.productId;
    const sources = (entry as { sources?: unknown })?.sources ?? [];
    if (typeof productId !== "string" || !productId.trim()) {
      problems.push(`products[${i}]: hiányzó productId.`);
      return;
    }
    if (!Array.isArray(sources)) {
      problems.push(`products[${i}]: a sources nem lista.`);
      return;
    }
    const parsed: RunProductInput["sources"][number][] = [];
    sources.forEach((source, j) => {
      const s = source as {
        kind?: unknown;
        url?: unknown;
        supplierId?: unknown;
      };
      if (!isEnrichmentSourceKind(s.kind))
        problems.push(`products[${i}].sources[${j}]: ismeretlen forrásfajta.`);
      else if (typeof s.url !== "string" || !s.url.trim())
        problems.push(`products[${i}].sources[${j}]: hiányzó url.`);
      else if (s.kind === "SUPPLIER" && typeof s.supplierId !== "string")
        problems.push(
          `products[${i}].sources[${j}]: beszállítói oldalhoz supplierId kell.`,
        );
      else
        parsed.push({
          kind: s.kind,
          url: s.url.trim(),
          ...(typeof s.supplierId === "string"
            ? { supplierId: s.supplierId }
            : {}),
        });
    });
    products.push({ productId: productId.trim(), sources: parsed });
  });
  return problems.length ? { ok: false, problems } : { ok: true, products };
}

export async function runEnrichmentCli(
  argv: readonly string[],
  out: Output,
  deps: EnrichmentCliDeps,
): Promise<number> {
  const inputPath = option(argv, "--input");
  if (!inputPath) {
    out.stderr(
      "Használat: --input <fájl.json> [--max-products N] [--max-requests N] [--apply --actor <userId>]\n",
    );
    return 2;
  }
  const productLimit = limitOption(
    argv,
    "--max-products",
    DEFAULT_PRODUCT_LIMIT,
    MAX_PRODUCT_LIMIT,
  );
  const requestLimit = limitOption(
    argv,
    "--max-requests",
    DEFAULT_REQUEST_LIMIT,
    MAX_REQUEST_LIMIT,
  );
  for (const limit of [productLimit, requestLimit])
    if (typeof limit === "string") {
      out.stderr(`${limit}\n`);
      return 2;
    }
  const parsed = parseRunInput(await deps.readInput(inputPath));
  if (!parsed.ok) {
    out.stderr(parsed.problems.map((p) => `- ${p}\n`).join(""));
    return 2;
  }

  // THE PLAN: every product and every URL, checked without the network.
  for (const product of parsed.products) {
    const facts = await deps.facts.productFacts(product.productId);
    if (!facts) {
      out.stderr(`Ismeretlen termék: ${product.productId}\n`);
      return 2;
    }
    out.stdout(`${facts.name} (${facts.productId})\n`);
    const manufacturer = manufacturerSites(
      facts.brandWebsiteUrl,
      facts.unasManufacturerUrl,
    );
    for (const source of sourcesFor(product, facts)) {
      const supplier =
        source.kind === "SUPPLIER" && source.supplierId
          ? baseDomainOf(await deps.facts.supplierWebsite(source.supplierId))
          : null;
      const refusal = sourceUrlProblem(source.kind, source.url, {
        manufacturer,
        supplier,
      });
      out.stdout(
        `  ${source.kind.padEnd(16)} ${refusal ? `ELUTASÍTVA (${refusal})` : "olvasható"}  ${source.url}\n`,
      );
    }
  }
  if (parsed.products.length > (productLimit as number))
    out.stdout(
      `Figyelem: ${parsed.products.length} termék, a korlát ${productLimit}; a futás a korlátnál megáll.\n`,
    );

  if (!argv.includes("--apply")) {
    out.stdout(
      "Terv: semmi nem ment ki a hálózatra, semmi nem tárolódott. Futtatás: --apply --actor <userId>\n",
    );
    return 0;
  }
  const mode = productEnrichmentAvailability(deps.env.JEV_PRODUCT_ENRICHMENT);
  if (mode === "off") {
    out.stderr("A futáshoz JEV_PRODUCT_ENRICHMENT nem lehet off.\n");
    return 1;
  }
  const actor = option(argv, "--actor");
  if (!actor || !(await deps.actorExists(actor))) {
    out.stderr("Az --apply-hoz létező felhasználó kell: --actor <userId>\n");
    return 2;
  }

  let summary: RunSummary;
  try {
    summary = await runEnrichment(
      parsed.products,
      {
        requestedById: actor,
        productLimit: productLimit as number,
        requestLimit: requestLimit as number,
      },
      {
        store: deps.store,
        facts: deps.facts,
        fetch: deps.fetch,
        sleep: deps.sleep,
        now: deps.now,
      },
    );
  } catch (error) {
    if (error instanceof UnknownProductError) {
      out.stderr(`Ismeretlen termék: ${error.productId}\n`);
      return 2;
    }
    throw error;
  }
  out.stdout(runReport(summary));
  return summary.status === "LIMIT_REACHED" ? 3 : 0;
}

export function runReport(summary: RunSummary): string {
  const lines = [
    `Futás ${summary.runId}: ${summary.status}, ${summary.productCount} termék, ${summary.requestCount} lekérés.`,
  ];
  if (summary.limit)
    lines.push(
      `KORLÁT ELÉRVE (${summary.limit === "PRODUCTS" ? "termékszám" : "lekérésszám"}): a futás itt megállt.`,
    );
  for (const check of summary.checks) {
    lines.push(
      `- ${check.productId}: ${check.sourceCount} elérhető forrás, ${check.fieldCount} mező forrásból`,
    );
    for (const fetch of check.fetches)
      lines.push(
        `    ${fetch.sourceKind.padEnd(16)} ${fetch.outcome}${fetch.reason ? ` (${fetch.reason})` : ""}, ${fetch.fieldCount} mező  ${fetch.url}`,
      );
    const counts = new Map<string, number>();
    for (const field of check.fields)
      counts.set(field.status, (counts.get(field.status) ?? 0) + 1);
    lines.push(
      `    mezők: ${[...counts].map(([status, n]) => `${status} ${n}`).join(", ")}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/* c8 ignore start */
async function main(): Promise<void> {
  const code = await runEnrichmentCli(
    process.argv.slice(2),
    {
      stdout: (t) => process.stdout.write(t),
      stderr: (t) => process.stderr.write(t),
    },
    {
      env: process.env,
      readInput: (path) => readFile(path, "utf8"),
      facts: new PrismaEnrichmentFactsReader(),
      store: new PrismaEnrichmentRunStore(),
      actorExists: async (id) =>
        (await prisma.user.findUnique({
          where: { id },
          select: { id: true },
        })) !== null,
      fetch: (url, init) => fetch(url, init),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => new Date(),
    },
  );
  await prisma.$disconnect();
  process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
/* c8 ignore stop */
