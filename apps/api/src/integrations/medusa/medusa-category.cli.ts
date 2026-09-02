import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import type { MedusaAdminClient } from "./medusa-admin.client.js";
import {
  MedusaCategoryImportRefusedError,
  MedusaCategoryImportService,
} from "./medusa-category-import.service.js";
import { MedusaCategoryLinkRepository } from "./medusa-category-link.repository.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import type { OurCategoryNode } from "./medusa-category-tree.js";
import {
  describeCredentialFailure,
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.cli.js";

/**
 * A KATEGORIAFA ATVITELE A MEDUSABA, kezzel inditva.
 *
 * Hasznalat:
 *   pnpm --filter @acropora/api medusa:categories            # TERV, iras nelkul
 *   pnpm --filter @acropora/api medusa:categories --apply    # a tenyleges betoltes
 *
 * AZ ALAPERTELMEZES A TERV, ES EZ NEM KENYELMI DONTES. Az `--apply` nelkuli
 * futas utan CSAK TUDAS marad; utana viszont kategoriak allnak egy kulso
 * rendszerben. A ketto nem ugyanaz a muvelet, tehat nem szabad, hogy ugyanaz a
 * parancs legyen. Ha az iras lenne az alapertelmezes, egy "megnezem, mit
 * csinalna" szandeku futas hozna letre 219 kategoriat.
 */

export interface CliOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

/** A MI faank, a `Category` tablabol. */
export async function ourCategoryTree(): Promise<OurCategoryNode[]> {
  const rows = await prisma.category.findMany({
    select: { id: true, parentId: true, name: true },
  });
  return rows;
}

export function describePlan(plan: {
  create: { ourId: string }[];
  skip: string[];
  mapOnly: unknown[];
  staleMapping: string[];
  conflict: { ourId: string }[];
}): string {
  const sorok = [
    `Létrehozandó: ${plan.create.length}`,
    `Már áll, leképezéssel: ${plan.skip.length}`,
    `Már áll, de a leképezés hiányzik: ${plan.mapOnly.length}`,
    `Elavult leképezés (újra létrehozandó): ${plan.staleMapping.length}`,
    `Ütközés (érintetlen marad): ${plan.conflict.length}`,
  ];
  if (plan.conflict.length)
    sorok.push(
      `Az ütköző kategóriák: ${plan.conflict.map((c) => c.ourId).join(", ")}`,
    );
  return sorok.join("\n") + "\n";
}

/**
 * A HAROM SZAM, ES AMIT JELENTENEK -- NEM NYERSEN.
 *
 * Egy nyers szamharmas ugyanaz a problema, mint egy szokas: az olvasonak
 * tudnia kell, mit hasonlitson mihez. Ezert a parancs KIMONDJA az iteletet, es
 * csak az elteres eseten sorolja a reszleteket.
 *
 * A ket nema hiba, amit ez a harom szam megfog:
 *   - a Medusa nem tarolta el az aktiv jelolot -> lathatatlan katalogus
 *   - a lekepezes-sorok nem szulettek meg nalunk -> kategoria nelkuli vetites
 * Egyikrol sem szol semmi mas.
 */
export function describeVerification(v: {
  carryingOurId: number;
  activeAmongThem: number;
  mappingRowsHere: number;
  expected: number;
}): string {
  const rendben =
    v.carryingOurId === v.expected &&
    v.activeAmongThem === v.expected &&
    v.mappingRowsHere === v.expected;
  const fej =
    `Ellenőrzés (${v.expected} kategóriára): a Medusában ${v.carryingOurId} hordozza ` +
    `a mi azonosítónkat, ebből ${v.activeAmongThem} aktív; nálunk ${v.mappingRowsHere} ` +
    `leképezés-sor áll.\n`;
  if (rendben) return fej + "A három szám egyezik.\n";
  const bajok: string[] = [];
  if (v.carryingOurId !== v.expected)
    bajok.push(
      `Hiányzik ${v.expected - v.carryingOurId} kategória a Medusából.`,
    );
  if (v.activeAmongThem !== v.carryingOurId)
    bajok.push(
      `${v.carryingOurId - v.activeAmongThem} kategória INAKTÍV: a Medusa nem ` +
        `tárolta el az aktív jelölőt, tehát a katalógus nem látszik.`,
    );
  if (v.mappingRowsHere !== v.expected)
    bajok.push(
      `Nálunk csak ${v.mappingRowsHere} leképezés-sor áll: a vetítés ennyi ` +
        `kategóriát találna meg, a többi termék kategória nélkül menne ki.`,
    );
  return fej + bajok.join("\n") + "\n";
}

export async function runCategoryCli(
  argv: readonly string[],
  out: CliOutput,
  deps: {
    client(): Promise<MedusaAdminClient>;
    tree(): Promise<OurCategoryNode[]>;
    service(): MedusaCategoryImportService;
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

  const nodes = await deps.tree();
  const service = deps.service();

  try {
    if (!apply) {
      const { plan } = await service.plan(client, nodes);
      out.stdout("TERV, írás nélkül:\n");
      out.stdout(describePlan(plan));
      out.stdout("Ez a futás semmit nem írt. A betöltéshez: --apply\n");
      return 0;
    }

    const report = await service.run(client, nodes, deps.now());
    out.stdout(
      [
        `Létrehozva: ${report.created}`,
        `Csak leképezés írva: ${report.linkedOnly}`,
        `Elavult leképezés átírva: ${report.relinked}`,
        `Változatlan: ${report.skipped}`,
        `Ütközés, érintetlen: ${report.conflicts.length}`,
        `A szülőjük miatt kimaradt: ${report.blockedByConflict.length}`,
      ].join("\n") + "\n",
    );
    out.stdout(describeVerification(report.verification));
    /**
     * AZ UTKOZES NEM NULLA KILEPESI KOD, ES EZ SZANDEKOS. A futas tobbi resze
     * SIKERULT, es azt nem szabad kudarcnak jelolni -- de az utkozes ember
     * dontese, tehat nem szabad elrejteni sem. Ezert a kilepesi kod 2: nem
     * hiba, hanem "megnezendo".
     */
    return report.conflicts.length || report.blockedByConflict.length ? 2 : 0;
  } catch (error) {
    if (error instanceof MedusaCategoryImportRefusedError) {
      out.stderr(`A betöltés megállt: ${error.reason}\n`);
      return 1;
    }
    throw error;
  }
}

/* c8 ignore start -- a belépési pont: a mérhető rész a `runCategoryCli`. */
async function main(): Promise<void> {
  const out: CliOutput = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
  const code = await runCategoryCli(process.argv.slice(2), out, {
    client: () => medusaClientForProjection(storedCredentialProvider(), out),
    tree: ourCategoryTree,
    service: () =>
      new MedusaCategoryImportService(new MedusaCategoryLinkRepository()),
    now: () => new Date(),
  });
  process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
/* c8 ignore stop */
