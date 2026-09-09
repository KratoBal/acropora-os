import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  analyzeProduct,
  summarizeLivestockNameLevels,
  type CatalogProduct,
} from "./product-data-completeness.js";

const EXPECTED_LIVESTOCK_COUNTS = {
  species: 192,
  genus: 13,
  nonScientific: 0,
  invalidRecord: 1,
};

export async function runProductDataCompletenessCli(
  args: string[],
  out: { stdout(value: string): void; stderr(value: string): void } = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): Promise<number> {
  const catalogIndex = args.indexOf("--catalog");
  const catalogPath = catalogIndex >= 0 ? args[catalogIndex + 1] : undefined;
  const mapIndex = args.indexOf("--map");
  const mapPath = mapIndex >= 0 ? args[mapIndex + 1] : undefined;
  if (!catalogPath || !mapPath) {
    out.stderr(
      "Használat: product-data:analyze -- --map /utvonal/termekadat-terkep.md --catalog /utvonal/katalogus.jsonl [--verify-livestock-control]\n",
    );
    return 2;
  }

  try {
    const map = await readFile(mapPath, "utf8");
    if (!map.includes("## 4") || !map.includes("## 5")) {
      throw new Error("A térképből hiányzik a 4. vagy az 5. tiltási szakasz.");
    }
  } catch (error) {
    out.stderr(
      `A termékadat-térkép nem használható: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  let products: CatalogProduct[];
  try {
    const content = await readFile(catalogPath, "utf8");
    products = content
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line, index) => {
        try {
          return JSON.parse(line) as CatalogProduct;
        } catch {
          throw new Error(`Érvénytelen JSONL sor: ${index + 1}.`);
        }
      });
  } catch (error) {
    out.stderr(
      `A katalógus nem olvasható: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  const results = products.map(analyzeProduct);
  for (const item of results) out.stdout(`${JSON.stringify(item)}\n`);

  const livestock = results.filter((item) => item.nameLevel !== null);
  const summary = summarizeLivestockNameLevels(livestock);
  out.stderr(
    `${JSON.stringify({ products: results.length, livestockNameLevels: summary })}\n`,
  );

  if (args.includes("--verify-livestock-control")) {
    const matches = Object.entries(EXPECTED_LIVESTOCK_COUNTS).every(
      ([key, value]) => summary[key as keyof typeof summary] === value,
    );
    if (!matches) {
      out.stderr(
        `A névszint-kontroll eltér: várt ${JSON.stringify(EXPECTED_LIVESTOCK_COUNTS)}.\n`,
      );
      return 1;
    }
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(await runProductDataCompletenessCli(process.argv.slice(2)));
}
