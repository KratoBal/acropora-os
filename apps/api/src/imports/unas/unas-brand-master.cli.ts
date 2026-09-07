import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import { BrandsRepository } from "../../brands/brands.repository.js";
import { normalizeBrandName } from "../../brands/brands.repository.js";
import {
  describeBrandMasterPlan,
  type ExistingBrandRecord,
  parseBrandMaster,
  planBrandMaster,
  type BrandMasterPlan,
} from "./unas-brand-master.js";

/**
 * A MARKA-TORZS BETOLTESE, EGYSZER FUTO PARANCSKENT.
 *
 * Hasznalat:
 *   pnpm --filter @acropora/api unas:brand-master
 *   pnpm --filter @acropora/api unas:brand-master --apply --actor <azonosito>
 *
 * Az alapertelmezes a TERV, az iras `--apply` mogott, a szereplo kotelezo es a
 * letezeset ELOL ellenorizzuk -- ugyanaz a harom orzo, mint a visszatoltesnel,
 * es ugyanabbol az okbol.
 */

export interface CliOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

/**
 * A BEMENETI FAJL UTJA, A FORRASFABOL.
 *
 * A parancsok `tsc -p tsconfig.json && node dist/...` alakban futnak, tehat a
 * FORRASFA a futtatas pillanataban is ott van -- ezert olvashatunk a `src`
 * alol. A `dist` melle a tsc nem masolja a nem-TS fajlokat, es egy generalt
 * TS-modul ugyanannak a tartalomnak a MASODIK peldanya lenne.
 */
const ITT = dirname(fileURLToPath(import.meta.url));
/**
 * AZ UT A CSOMAG GYOKEREBOL SZAMOL, NEM A KONYVTAR NEVEBOL.
 *
 * Az elso valtozat a `dist` szot cserelte `src`-re. MERVE: a teszt-futas
 * `test-dist` alol indul, abbol `test-src` lett, es a fajl nem letezett -- a
 * SUITE elhasalt. A forditott konyvtar (`dist` vagy `test-dist`) mindig HAROM
 * szinttel van a csomag gyokere alatt, ezert onnan szamolunk.
 */
export const BRAND_MASTER_PATH = join(
  ITT,
  "..",
  "..",
  "..",
  "src",
  "imports",
  "unas",
  "brand-master",
  "marka-betolto-bemenet-v3.tsv",
);

export function readBrandMaster(path = BRAND_MASTER_PATH): string {
  return readFileSync(path, "utf8");
}

/**
 * A MA LETEZO MARKAK, ANNYIVAL, AMENNYI AZ ILLESZTESHEZ ES A POTLASHOZ KELL.
 *
 * Korabban ez csak a normalizalt KULCSOK lapos listajat adta vissza. Az eleg
 * volt annak eldontesehez, hogy egy kanonikus nev mar all-e; ahhoz viszont nem,
 * hogy MELYIK markara kell felvinni a hianyzo aliast, es hogy a tarolt neve
 * elter-e a kanonikustol.
 */
export async function existingBrands(): Promise<ExistingBrandRecord[]> {
  const markak = await prisma.brand.findMany({
    select: {
      id: true,
      name: true,
      normalizedName: true,
      aliases: { select: { normalizedAlias: true } },
    },
  });
  return markak.map((m) => ({
    id: m.id,
    name: m.name,
    normalizedName: m.normalizedName,
    normalizedAliases: m.aliases.map((a) => a.normalizedAlias),
  }));
}

export async function runBrandMasterCli(
  argv: readonly string[],
  out: CliOutput,
  deps: {
    master(): string;
    existing(): Promise<ExistingBrandRecord[]>;
    actorExists(actorId: string): Promise<boolean>;
    apply(
      plan: BrandMasterPlan,
      actorId: string,
    ): Promise<{ created: number; aliasesAdded: number }>;
  },
): Promise<number> {
  const apply = argv.includes("--apply");
  const actorIndex = argv.indexOf("--actor");
  const actorId =
    actorIndex >= 0 && actorIndex + 1 < argv.length
      ? argv[actorIndex + 1]!
      : null;

  let szoveg: string;
  try {
    szoveg = deps.master();
  } catch (error) {
    /**
     * A HIANYZO FAJL MEGALLIT, ES EZ A LEGFONTOSABB ORZO.
     *
     * Enelkul a fajl-alapu tiltasok CSENDBEN kiesnenek: a visszautasitottak
     * szama nullara menne, es az pontosan ugy nezne ki, mint egy tiszta adat.
     * A "nem volt mit" es a "nem volt mibol" kivulrol egyforma.
     */
    out.stderr(
      `A betöltő-bemenet nem olvasható (${BRAND_MASTER_PATH}): ` +
        `${error instanceof Error ? error.message : String(error)}\n` +
        "A futás EL SEM INDULT. E nélkül a fájl-alapú tiltások csendben " +
        "kiesnének, és a nulla visszautasítás tiszta adatnak látszana.\n",
    );
    return 1;
  }

  const { rows, errors } = parseBrandMaster(szoveg);
  if (errors.length) {
    out.stderr(
      `A betöltő-bemenet hibás, a futás EL SEM INDULT:\n  ${errors.join("\n  ")}\n`,
    );
    return 1;
  }

  const plan = planBrandMaster(rows, await deps.existing());
  out.stdout(describeBrandMasterPlan(plan));

  if (!apply) {
    out.stdout("\nEz a futás semmit nem írt. A végrehajtáshoz: --apply\n");
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

  const eredmeny = await deps.apply(plan, actorId);
  out.stdout(
    `\nLétrehozott márka-rekord: ${eredmeny.created}\n` +
      `Meglévő márkára felvitt alias: ${eredmeny.aliasesAdded}\n`,
  );
  return 0;
}

/* c8 ignore start -- a belépési pont: a mérhető rész a `runBrandMasterCli`. */
async function applyPlan(plan: BrandMasterPlan, actorId: string) {
  const repository = new BrandsRepository();
  let created = 0;
  let aliasesAdded = 0;
  for (const marka of plan.create) {
    await repository.create(
      {
        name: marka.name,
        aliases: marka.aliases.map((alias) => ({
          alias,
          source: "UNAS",
          isPreferred: false,
        })),
      } as never,
      actorId,
    );
    created += 1;
  }

  /**
   * ES A MAR LETEZO MARKAK ALIASAI. Atnevezes NINCS: a kanonikus irasmod is
   * ALIASKENT kerul fel, ha a tarolt nev mas. Igy a lekepezes felepul, es a
   * nev-kerdes nyitva marad annak, aki eldontheti.
   */
  for (const tetel of plan.aliasTopUp) {
    for (const alias of tetel.add) {
      await repository.addAlias(
        tetel.brandId,
        { alias, source: "UNAS", isPreferred: false } as never,
        actorId,
      );
      aliasesAdded += 1;
    }
  }
  return { created, aliasesAdded };
}

async function main(): Promise<void> {
  const out: CliOutput = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
  process.exitCode = await runBrandMasterCli(process.argv.slice(2), out, {
    master: () => readBrandMaster(),
    existing: existingBrands,
    actorExists: async (actorId: string) =>
      (await prisma.user.count({ where: { id: actorId } })) === 1,
    apply: applyPlan,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
/* c8 ignore stop */
export { normalizeBrandName };
