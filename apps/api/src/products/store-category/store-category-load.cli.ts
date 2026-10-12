import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  describeStoreCategoryLoad,
  parseStoreCategoryFile,
  planStoreCategoryLoad,
} from "./store-category-load.js";
import {
  applyStoreCategoryLoad,
  loadStoreCategoryState,
} from "./store-category-load.repository.js";

/**
 * AZ ACROPORA-KATEGÓRIAFA BETÖLTŐJE (SEO P0 PR 10, D1). Alapból SZÁRAZFUTÁS:
 * kiírja a tervet és az ütközéseket, és nem ír. `--apply` mellett egy
 * tranzakcióban alkalmazza, de csak ütközésmentes tervet. Idempotens: ugyanaz
 * a fájl másodszor nulla változást ad.
 *
 *     node dist/products/store-category/store-category-load.cli.js <fajl.json> [--apply]
 */
export async function main(
  args: string[],
  out: { stdout(value: string): void; stderr(value: string): void } = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  db = prisma,
  read: (path: string) => Promise<string> = (path) => readFile(path, "utf8"),
): Promise<number> {
  const apply = args.includes("--apply");
  const rest = args.filter((a) => a !== "--apply");
  const [path, ...tobb] = rest;
  if (!path || tobb.length > 0 || path.startsWith("--")) {
    out.stderr("Használat: store-category-load <fajl.json> [--apply]\n");
    return 1;
  }
  let json: unknown;
  try {
    json = JSON.parse(await read(path));
  } catch (error) {
    out.stderr(
      `A fájl nem olvasható JSON: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
  const parsed = parseStoreCategoryFile(json);
  if (!parsed.ok) {
    out.stderr(
      `A fájl alakja hibás:\n${parsed.errors.map((e) => `  ${e}`).join("\n")}\n`,
    );
    return 1;
  }
  const plan = planStoreCategoryLoad(
    parsed.file,
    await loadStoreCategoryState(db, parsed.file),
  );
  out.stdout(describeStoreCategoryLoad(plan));
  if (plan.conflicts.length > 0) return 2;
  if (!apply) {
    out.stdout("SZARAZFUTAS: semmi nem irodott. Alkalmazas: --apply\n");
    return 0;
  }
  const { redirects } = await db.$transaction(
    (tx) => applyStoreCategoryLoad(tx, plan),
    { timeout: 60_000 },
  );
  out.stdout(
    `ALKALMAZVA: ${plan.create.length} új, ${plan.update.length} módosított kategória, ${plan.slugChange.length} slugcsere (${redirects} átirányítás), ${plan.products.length} termék, ${plan.mappings.length} UNAS-leképezés\n`,
  );
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv.slice(2))
    .then(async (code) => {
      await prisma.$disconnect();
      process.exit(code);
    })
    .catch(async (error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "Ismeretlen hiba."}\n`,
      );
      await prisma.$disconnect();
      process.exit(1);
    });
}
