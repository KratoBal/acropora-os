import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { BrandsRepository } from "../../brands/brands.repository.js";
import {
  brandValueFromParameters,
  describeBrandBackfillPlan,
  planBrandBackfill,
  type BrandBackfillPlan,
  type BrandBackfillRow,
  type ExistingBrand,
} from "./unas-brand-backfill.js";

/**
 * MARKA A TAROLT PILLANATKEPBOL A TERMEKRE, VISSZAMENOLEG -- EGYSZER FUTO PARANCS.
 *
 * Hasznalat:
 *   pnpm --filter @acropora/api unas:brand-backfill            # TERV, iras nelkul
 *   pnpm --filter @acropora/api unas:brand-backfill --apply    # a tenyleges iras
 *
 * === AZ ALAPERTELMEZES A TERV, ES EZ NEM KENYELMI DONTES ===
 *
 * Ugyanaz az indok, mint a kategoria- es marka-parancsnal: egy `--apply` nelkuli
 * futas utan CSAK TUDAS marad; utana viszont marka-rekordok allnak az
 * adatbazisban es 683 termeken egy mezo. A ketto nem ugyanaz a muvelet, tehat
 * nem szabad, hogy ugyanaz a parancs legyen.
 *
 * A vetitesnel ma pont az hianyzik, hogy nincs proba-alakja. Ne ismereljuk meg.
 *
 * === MIERT NEM A BrandImportAssistantService ===
 *
 * Az a szolgaltatas KOTEGHEZ van kotve: `batchId`, sor-azonosito,
 * `expectedUpdatedAt`, es a sor `classification` erteke `MISSING_BRAND` kell
 * legyen. A mi 683 termekunk API-SZINKRONON jott be, ahol nincs koteg es nincs
 * atnezes-sor -- azokat eloszor gyartani kellene, ami epp a C) ut.
 *
 * Ezert a KOTEG NELKULI, mar letezo utat hasznalja: `BrandsRepository.create`.
 * Ez nem uj marka-letrehozo kod, hanem a masik meglevo.
 */

export interface CliOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

/** A pillanatkeppel rendelkezo termekek, a nyers marka-ertekkel. */
export async function backfillRows(): Promise<BrandBackfillRow[]> {
  const termekek = await prisma.product.findMany({
    where: { unasSnapshot: { isNot: null } },
    select: {
      id: true,
      brandId: true,
      unasSnapshot: { select: { parameters: true } },
    },
  });

  const sorok: BrandBackfillRow[] = [];
  for (const termek of termekek) {
    const brandValue = brandValueFromParameters(
      termek.unasSnapshot?.parameters,
    );
    if (!brandValue) continue;
    sorok.push({
      productId: termek.id,
      brandValue,
      currentBrandId: termek.brandId,
    });
  }
  return sorok;
}

/** A MA letezo markak, a parositashoz szukseges ket mezovel. */
export async function existingBrands(): Promise<ExistingBrand[]> {
  const markak = await prisma.brand.findMany({
    where: { isActive: true },
    select: {
      id: true,
      normalizedName: true,
      aliases: { select: { normalizedAlias: true } },
    },
  });
  return markak.map((marka) => ({
    id: marka.id,
    normalizedName: marka.normalizedName,
    normalizedAliases: marka.aliases.map((alias) => alias.normalizedAlias),
  }));
}

export async function runBrandBackfillCli(
  argv: readonly string[],
  out: CliOutput,
  deps: {
    rows(): Promise<BrandBackfillRow[]>;
    brands(): Promise<ExistingBrand[]>;
    apply(
      plan: BrandBackfillPlan,
    ): Promise<{ created: number; assigned: number }>;
  },
): Promise<number> {
  const apply = argv.includes("--apply");
  const plan = planBrandBackfill(await deps.rows(), await deps.brands());

  out.stdout(describeBrandBackfillPlan(plan));

  if (!apply) {
    out.stdout("\nEz a futás semmit nem írt. A végrehajtáshoz: --apply\n");
    return 0;
  }

  const eredmeny = await deps.apply(plan);
  out.stdout(
    `\nLétrehozott márka-rekord: ${eredmeny.created}\n` +
      `Termék, amire márka került: ${eredmeny.assigned}\n`,
  );
  return 0;
}

/* c8 ignore start -- a belépési pont: a mérhető rész a `runBrandBackfillCli`. */
async function applyPlan(plan: BrandBackfillPlan) {
  const repository = new BrandsRepository();
  let created = 0;

  /**
   * ELOSZOR A REKORDOK, AZTAN A HOZZARENDELES, es a sorrend kotott: a
   * hozzarendeles a most szuletett azonositokat hasznalja. Forditva a masodik
   * lepes egy meg nem letezo markara mutatna.
   */
  const ujAzonositok = new Map<string, string>();
  for (const marka of plan.createBrands) {
    /**
     * AZ `aliases` URES TOMBKENT MEGY: a DTO kotelezo mezoje, es a
     * `BrandsRepository.create` epp ezt olvassa. Egy `undefined` itt csendben
     * mas agra vinne a letrehozast.
     */
    const brand = await repository.create(
      { name: marka.name, aliases: [] },
      "unas-backfill",
    );
    created += 1;
    ujAzonositok.set(marka.name, brand.id);
  }

  const frissBrands = await existingBrands();
  const ujraTervezve = planBrandBackfill(await backfillRows(), frissBrands);

  let assigned = 0;
  for (const tetel of ujraTervezve.assign) {
    await prisma.product.update({
      where: { id: tetel.productId },
      data: { brandId: tetel.brandId },
    });
    assigned += 1;
  }
  return { created, assigned };
}

async function main(): Promise<void> {
  const out: CliOutput = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
  process.exitCode = await runBrandBackfillCli(process.argv.slice(2), out, {
    rows: backfillRows,
    brands: existingBrands,
    apply: applyPlan,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
/* c8 ignore stop */
