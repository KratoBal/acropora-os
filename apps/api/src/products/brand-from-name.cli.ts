import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  type BrandFromNameRow,
  type NameBrand,
  describeBrandFromNamePlan,
  planBrandFromName,
} from "./brand-from-name.js";

/**
 * THE BRAND FROM THE NAME, BY HAND OR AS A CATALOG ACTION (`brand-from-name`; acrobot 51093):
 *
 *   pnpm --filter @acropora/api products:brand-from-name            # PLAN, nothing written
 *   pnpm --filter @acropora/api products:brand-from-name --apply --actor <userId>
 *
 * The plan prints every product it would write, so the plan IS the measurement: the rule is the one function in
 * `brand-from-name.ts`. The write sets the brand only where the product still has none at that moment (one conditional
 * update per product): a brand set between the plan and the write is left alone and named in the output.
 */
export interface CliOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

export interface BrandFromNameDependencies {
  rows(): Promise<BrandFromNameRow[]>;
  brands(): Promise<NameBrand[]>;
  actorExists(actorId: string): Promise<boolean>;
  /** Sets the brand only if the product has none; `false`: it had one by then. */
  assign(productId: string, brandId: string): Promise<boolean>;
}

export async function runBrandFromNameCli(
  argv: readonly string[],
  out: CliOutput,
  deps: BrandFromNameDependencies,
): Promise<number> {
  const apply = argv.includes("--apply");
  const actorIndex = argv.indexOf("--actor");
  const actorId =
    actorIndex >= 0 && actorIndex + 1 < argv.length
      ? argv[actorIndex + 1]!
      : null;

  const plan = planBrandFromName(await deps.rows(), await deps.brands());
  out.stdout(describeBrandFromNamePlan(plan));

  if (!apply) {
    out.stdout("Ez a futás semmit nem írt. A végrehajtáshoz: --apply\n");
    return 0;
  }
  if (!actorId) {
    out.stderr(
      "Az íráshoz meg kell nevezni, KI indítja: --actor <felhasználó azonosítója>.\n",
    );
    return 1;
  }
  if (!(await deps.actorExists(actorId))) {
    out.stderr(`Nincs ilyen felhasználó: ${actorId}. Az írás EL SEM INDULT.\n`);
    return 1;
  }

  let assigned = 0;
  let skipped = 0;
  try {
    for (const item of plan.assign) {
      if (await deps.assign(item.productId, item.brandId)) {
        assigned += 1;
        out.stdout(`BEÍRVA\t${item.productId}\t${item.brandName}\n`);
      } else {
        skipped += 1;
        out.stdout(
          `KIHAGYVA (közben márkát kapott)\t${item.productId}\t${item.brandName}\n`,
        );
      }
    }
  } catch (error) {
    out.stderr(
      `\nA futás FÉLBEHAGYVA: az írás közben hiba történt.\n` +
        `Eddig márkát kapott termék: ${assigned}\n` +
        "Az újrafuttatás csak a még márka nélküli termékekre ír.\n",
    );
    throw error;
  }
  out.stdout(
    `\nMárkát kapott termék: ${assigned}\nKihagyva, mert közben márkát kapott: ${skipped}\nFelelős: ${actorId}\n`,
  );
  return 0;
}

/* c8 ignore start -- the database side; the measurable part is `runBrandFromNameCli` */
export const brandFromNameDependencies: BrandFromNameDependencies = {
  rows: async () =>
    (
      await prisma.product.findMany({
        select: { id: true, name: true, brandId: true },
      })
    ).map((p) => ({ productId: p.id, name: p.name, brandId: p.brandId })),
  brands: async () =>
    (
      await prisma.brand.findMany({
        where: { isActive: true },
        select: { id: true, name: true, aliases: { select: { alias: true } } },
      })
    ).map((b) => ({
      id: b.id,
      name: b.name,
      aliases: b.aliases.map((a) => a.alias),
    })),
  actorExists: async (actorId) =>
    (await prisma.user.count({ where: { id: actorId } })) === 1,
  assign: async (productId, brandId) =>
    (
      await prisma.product.updateMany({
        where: { id: productId, brandId: null },
        data: { brandId },
      })
    ).count === 1,
};

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const out: CliOutput = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
  runBrandFromNameCli(process.argv.slice(2), out, brandFromNameDependencies)
    .then(async (code) => {
      await prisma.$disconnect();
      process.exit(code);
    })
    .catch(async (error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      await prisma.$disconnect();
      process.exit(1);
    });
}
/* c8 ignore stop */
