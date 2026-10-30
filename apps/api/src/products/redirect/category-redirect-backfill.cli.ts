import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  describeCategoryRedirectBackfill,
  planCategoryRedirectBackfill,
  type CategoryHandleForm,
} from "./category-redirect-backfill.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * A KATEGÓRIA-ÁTIRÁNYÍTÁS PARANCSA (commerce audit P1, régi UNAS-linkek). Alapból
 * SZÁRAZFUTÁS: kiírja a jelentést, és nem ír. `--apply` mellett a memóriabeli futás
 * naplója egy tranzakcióban íródik ki; ha a jelentés láncot vagy elutasítást
 * mutat, az `--apply` nem ír.
 *
 *   --paths <fájl>   a régi bolt útjai, soronként egy (a sitemap); `#` sor kimarad; `-`: a standard bemenet
 *   --form current|legacy   a kategória-cím képlete (alap: current); lásd a tervezőt
 *   --apply
 */
export async function main(
  args: string[],
  out: { stdout(value: string): void; stderr(value: string): void } = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  db = prisma,
  readPaths: (file: string) => Promise<string> = (file) =>
    file === "-" ? readStdin() : readFile(file, "utf8"),
): Promise<number> {
  let file: string | null = null;
  let form: CategoryHandleForm = "current";
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--apply") apply = true;
    else if (a === "--paths") file = args[++i] ?? null;
    else if (a === "--form") {
      const v = args[++i];
      if (v !== "current" && v !== "legacy") {
        out.stderr("A --form értéke current vagy legacy lehet.\n");
        return 1;
      }
      form = v;
    } else {
      out.stderr(
        `Ismeretlen kapcsolo: ${a} (--paths <fajl>, --form current|legacy, --apply)\n`,
      );
      return 1;
    }
  }
  if (!file) {
    out.stderr(
      "Hianyzik: --paths <fajl> (a regi bolt utjai, soronkent egy).\n",
    );
    return 1;
  }
  const paths = (await readPaths(file))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  const [categories, unasRefs, meglevo] = await Promise.all([
    db.category.findMany({
      orderBy: { id: "asc" },
      select: { id: true, name: true, parentId: true },
    }),
    db.externalReference.findMany({
      where: { system: "UNAS", entityType: "Category" },
      select: { entityId: true, externalId: true },
    }),
    db.urlRedirect.findMany({
      select: {
        id: true,
        sourcePath: true,
        destinationPath: true,
        isActive: true,
      },
    }),
  ]);
  const unasId = new Map(unasRefs.map((r) => [r.entityId, r.externalId]));
  const { store, report } = await planCategoryRedirectBackfill(
    paths,
    categories.map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parentId,
      unasId: unasId.get(c.id) ?? null,
    })),
    meglevo,
    { form },
  );
  out.stdout(describeCategoryRedirectBackfill(report, form));
  if (!apply) {
    out.stdout("SZARAZFUTAS: semmi nem irodott. Alkalmazas: --apply\n");
    return 0;
  }
  if (report.refused.length || report.invariantViolations.length) {
    out.stderr(
      "NEM IRTAM: a jelentes elutasitott szabalyt vagy lancot mutat.\n",
    );
    return 1;
  }
  const ujak = store.created();
  const modositasok = store.updated();
  await db.$transaction([
    ...(ujak.length ? [db.urlRedirect.createMany({ data: ujak })] : []),
    ...modositasok.map((m) =>
      db.urlRedirect.update({ where: { id: m.id }, data: m.data }),
    ),
  ]);
  out.stdout(
    `ALKALMAZVA: ${ujak.length} uj szabaly, ${modositasok.length} modositott\n`,
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
