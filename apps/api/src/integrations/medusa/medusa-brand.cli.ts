import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import type { MedusaAdminClient } from "./medusa-admin.client.js";
import {
  MedusaBrandImportRefusedError,
  MedusaBrandImportService,
} from "./medusa-brand-import.service.js";
import { MedusaBrandLinkRepository } from "./medusa-brand-link.repository.js";
import type { OurBrand } from "./medusa-brand-plan.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import type { CliOutput } from "./medusa-category.cli.js";
import {
  describeCredentialFailure,
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.cli.js";

/**
 * A MARKAK ATVITELE A MEDUSABA, GYUJTEMENYKENT, kezzel inditva.
 *
 * Hasznalat:
 *   pnpm --filter @acropora/api medusa:brands            # TERV, iras nelkul
 *   pnpm --filter @acropora/api medusa:brands --apply    # a tenyleges betoltes
 *
 * AZ ALAPERTELMEZES A TERV, ES EZ NEM KENYELMI DONTES -- ugyanaz az indok, mint
 * a kategoria-parancsnal. Az `--apply` nelkuli futas utan CSAK TUDAS marad;
 * utana viszont gyujtemenyek allnak egy kulso rendszerben. A ketto nem ugyanaz
 * a muvelet, tehat nem szabad, hogy ugyanaz a parancs legyen.
 */

/** A MI markaink, a `Brand` tablabol. */
export async function ourBrands(): Promise<OurBrand[]> {
  return prisma.brand.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      archivedAt: true,
    },
  });
}

export function describeBrandPlan(plan: {
  create: { ourId: string }[];
  skip: string[];
  mapOnly: unknown[];
  staleMapping: string[];
  conflict: { ourId: string }[];
  skipArchived: string[];
}): string {
  const sorok = [
    `Létrehozandó: ${plan.create.length}`,
    `Már áll, leképezéssel: ${plan.skip.length}`,
    `Már áll, de a leképezés hiányzik: ${plan.mapOnly.length}`,
    `Elavult leképezés (újra létrehozandó): ${plan.staleMapping.length}`,
    `Ütközés (érintetlen marad): ${plan.conflict.length}`,
    `Archivált vagy inaktív, ezért kimarad: ${plan.skipArchived.length}`,
  ];
  if (plan.conflict.length)
    sorok.push(
      `Az ütköző márkák: ${plan.conflict.map((c) => c.ourId).join(", ")}`,
    );
  return sorok.join("\n") + "\n";
}

/**
 * A KET SZAM, ES AMIT JELENTENEK -- NEM NYERSEN.
 *
 * A kategoria-parancs HARMAT ir ki, mert ott az `is_active` jelolo egy harmadik
 * nema hibat hordoz. A gyujtemenynek NINCS ilyen mezoje (merve a telepitett
 * 2.19.0 `CreateCollection` validatorabol), tehat itt ket szam van, es a
 * harmadik nem "elmaradt", hanem nem letezik.
 *
 * A ket nema hiba, amit ez a ket szam megfog:
 *   - a gyujtemeny nem keletkezett meg a Medusan -> a marka-oldal nincs
 *   - a lekepezes-sor nem szuletett meg nalunk   -> a vetites nem talalja meg,
 *     es a termek gyujtemeny nelkul megy ki, csendben
 */
export function describeBrandVerification(v: {
  carryingOurId: number;
  mappingRowsHere: number;
  expected: number;
}): string {
  const fej =
    `Ellenőrzés (${v.expected} aktív márkára): a Medusában ${v.carryingOurId} ` +
    `gyűjtemény hordozza a mi azonosítónkat; nálunk ${v.mappingRowsHere} ` +
    `leképezés-sor áll.\n`;
  if (v.carryingOurId === v.expected && v.mappingRowsHere === v.expected)
    return fej + "A két szám egyezik.\n";
  const bajok: string[] = [];
  if (v.carryingOurId !== v.expected)
    bajok.push(
      `Hiányzik ${v.expected - v.carryingOurId} gyűjtemény a Medusából.`,
    );
  if (v.mappingRowsHere !== v.expected)
    bajok.push(
      `Nálunk csak ${v.mappingRowsHere} leképezés-sor áll: a vetítés ennyi ` +
        `márkát találna meg, a többi termék gyűjtemény nélkül menne ki.`,
    );
  return fej + bajok.join("\n") + "\n";
}

export async function runBrandCli(
  argv: readonly string[],
  out: CliOutput,
  deps: {
    client(): Promise<MedusaAdminClient>;
    brands(): Promise<OurBrand[]>;
    service(): MedusaBrandImportService;
    now(): Date;
  },
): Promise<number> {
  const apply = argv.includes("--apply");
  let client: MedusaAdminClient;
  try {
    client = await deps.client();
  } catch (error) {
    if (error instanceof MedusaConnectionError) {
      out.stderr(describeCredentialFailure(error) + "\n");
      return 1;
    }
    throw error;
  }

  const brands = await deps.brands();
  const service = deps.service();

  try {
    if (!apply) {
      const plan = await service.plan(client, brands);
      out.stdout("TERV, írás nélkül:\n");
      out.stdout(describeBrandPlan(plan));
      out.stdout("Ez a futás semmit nem írt. A betöltéshez: --apply\n");
      return 0;
    }

    const report = await service.run(client, brands, deps.now());
    out.stdout(
      [
        `Létrehozva: ${report.created}`,
        `Csak leképezés írva: ${report.linkedOnly}`,
        `Elavult leképezés átírva: ${report.relinked}`,
        `Változatlan: ${report.skipped}`,
        `Ütközés, érintetlen: ${report.conflicts.length}`,
        `Archivált, kimaradt: ${report.skippedArchived.length}`,
      ].join("\n") + "\n",
    );
    out.stdout(describeBrandVerification(report.verification));
    /**
     * AZ UTKOZES NEM NULLA KILEPESI KOD, ES EZ SZANDEKOS -- ugyanaz az indok,
     * mint a kategoria-parancsnal. A futas tobbi resze SIKERULT, es azt nem
     * szabad kudarcnak jelolni; az utkozes viszont ember dontese, tehat nem
     * szabad elrejteni sem. A kilepesi kod 2: nem hiba, hanem "megnezendo".
     */
    return report.conflicts.length ? 2 : 0;
  } catch (error) {
    if (error instanceof MedusaBrandImportRefusedError) {
      out.stderr(`A betöltés megállt: ${error.reason}\n`);
      return 1;
    }
    throw error;
  }
}

/* c8 ignore start -- a belépési pont: a mérhető rész a `runBrandCli`. */
async function main(): Promise<void> {
  const out: CliOutput = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
  const code = await runBrandCli(process.argv.slice(2), out, {
    client: () => medusaClientForProjection(storedCredentialProvider(), out),
    brands: ourBrands,
    service: () =>
      new MedusaBrandImportService(new MedusaBrandLinkRepository()),
    now: () => new Date(),
  });
  process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
/* c8 ignore stop */
