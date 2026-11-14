import { prisma } from "@acropora/database";

import { BrandsRepository } from "../brands/brands.repository.js";
import {
  brandFromNameDependencies,
  type CliOutput,
} from "./brand-from-name.cli.js";
import {
  type BrandListInput,
  type ListBrand,
  type ListProduct,
  brandListErrors,
  describeBrandListPlan,
  planBrandList,
} from "./brand-from-list.js";

/**
 * THE BRAND FROM AN EXPLICIT LIST, AS A CATALOG ACTION (`brand-from-list`; card 16d06aea). The rules are in
 * `brand-from-list.ts`; this is the run around them.
 *
 * A PLAN reads and writes nothing. An APPLY plans the SAME list again, writes only if that plan has no bad item, creates
 * the new brands first (each its own recorded `BrandsRepository.create`), then sets the brand on each product where it
 * still has none at that moment: a brand set between the plan and the write is left alone and named in the output.
 * What was done is skipped on a re-run (the brands now exist, the products now have a brand), so a run that stopped
 * halfway is finished by running it again.
 */
export interface BrandFromListDependencies {
  products(ids: string[]): Promise<ListProduct[]>;
  brands(): Promise<ListBrand[]>;
  actorExists(actorId: string): Promise<boolean>;
  createBrand(
    name: string,
    actorId: string,
  ): Promise<{ id: string; name: string }>;
  /** Sets the brand only if the product has none; `false`: it had one by then. */
  assign(productId: string, brandId: string): Promise<boolean>;
}

export async function runBrandFromListAction(
  apply: boolean,
  actorId: string,
  input: BrandListInput,
  out: CliOutput,
  deps: BrandFromListDependencies,
): Promise<number> {
  const plan = planBrandList(
    input,
    await deps.products(input.items.map((item) => item.productId)),
    await deps.brands(),
  );
  out.stdout(describeBrandListPlan(plan));

  const errors = brandListErrors(plan);
  if (errors > 0) {
    out.stderr(
      `\nA lista ${errors} hibás tételt tartalmaz, ezért a futás EL SEM INDULT. ` +
        "Javítsd a listát, és futtasd újra a próbát.\n",
    );
    return 1;
  }
  if (!apply) {
    out.stdout(
      "Ez a futás semmit nem írt. A végrehajtáshoz kell egy sikeres próba.\n",
    );
    return 0;
  }
  if (!(await deps.actorExists(actorId))) {
    out.stderr(`Nincs ilyen felhasználó: ${actorId}. Az írás EL SEM INDULT.\n`);
    return 1;
  }

  let created = 0;
  let assigned = 0;
  let skipped = 0;
  try {
    const createdIds = new Map<string, string>();
    for (const brand of plan.newBrands) {
      const made = await deps.createBrand(brand.name, actorId);
      createdIds.set(brand.normalizedName, made.id);
      created += 1;
      out.stdout(`MÁRKA LÉTREHOZVA\t${made.id}\t${made.name}\n`);
    }
    for (const row of plan.rows) {
      if (row.kind !== "ASSIGN" && row.kind !== "ASSIGN_NEW") continue;
      const brandId =
        row.kind === "ASSIGN"
          ? row.brandId
          : createdIds.get(row.normalizedName)!;
      const brandName =
        row.kind === "ASSIGN" ? row.brandName : row.newBrandName;
      if (await deps.assign(row.productId, brandId)) {
        assigned += 1;
        out.stdout(`BEÍRVA\t${row.productId}\t${brandName}\n`);
      } else {
        skipped += 1;
        out.stdout(
          `KIHAGYVA (közben márkát kapott)\t${row.productId}\t${brandName}\n`,
        );
      }
    }
  } catch (error) {
    out.stderr(
      "\nA futás FÉLBEHAGYVA: az írás közben hiba történt.\n" +
        `Eddig létrejött márka: ${created}, márkát kapott termék: ${assigned}\n` +
        "Az újrafuttatás ugyanazzal a listával a már kész részt kihagyja.\n",
    );
    throw error;
  }
  out.stdout(
    `\nLétrehozott márka: ${created}\nMárkát kapott termék: ${assigned}\nKihagyva, mert közben márkát kapott: ${skipped}\nFelelős: ${actorId}\n`,
  );
  return 0;
}

/* c8 ignore start -- the database side; the measurable part is `runBrandFromListAction` */
export const brandFromListDependencies: BrandFromListDependencies = {
  products: async (ids) =>
    (
      await prisma.product.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, brandId: true },
      })
    ).map((p) => ({ id: p.id, name: p.name, brandId: p.brandId })),
  brands: async () =>
    (
      await prisma.brand.findMany({
        select: {
          id: true,
          name: true,
          normalizedName: true,
          isActive: true,
          aliases: { select: { normalizedAlias: true } },
        },
      })
    ).map((b) => ({
      id: b.id,
      name: b.name,
      normalizedName: b.normalizedName,
      isActive: b.isActive,
      normalizedAliases: b.aliases.map((a) => a.normalizedAlias),
    })),
  actorExists: brandFromNameDependencies.actorExists,
  createBrand: async (name, actorId) => {
    const brand = await new BrandsRepository().create(
      { name, aliases: [] },
      actorId,
    );
    return { id: brand.id, name: brand.name };
  },
  assign: brandFromNameDependencies.assign,
};
/* c8 ignore stop */
