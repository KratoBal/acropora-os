import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  describeBackfillPlan,
  planBarcodeBackfill,
} from "./barcode-backfill.js";

/**
 * A VONALKÓD-BACKFILL PARANCSA (SEO P0 PR 4). Alapból SZÁRAZFUTÁS: kiírja a tervet,
 * és nem ír semmit. `--apply` mellett egy tranzakcióban kitölti a meglévő sorok
 * `type`-ját és `source`-át, és létrehozza a gyártói cikkszám kódjainak sorát.
 *
 * Az alkalmazás jóváhagyáshoz kötött (a stage-en is): a szárazfutás számait előbb
 * valakinek látnia kell.
 */
export interface BackfillCliOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

export async function main(
  args: string[],
  out: BackfillCliOutput = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  db = prisma,
): Promise<number> {
  const unknown = args.filter((a) => a !== "--apply");
  if (unknown.length) {
    out.stderr(`Ismeretlen kapcsolo: ${unknown.join(" ")} (csak --apply)\n`);
    return 1;
  }
  const apply = args.includes("--apply");

  const [barcodes, variants] = await Promise.all([
    db.productBarcode.findMany({
      orderBy: { code: "asc" },
      select: {
        id: true,
        variantId: true,
        code: true,
        type: true,
        source: true,
      },
    }),
    db.productVariant.findMany({
      where: { manufacturerPartNumber: { not: null } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        sku: true,
        manufacturerPartNumber: true,
        isActive: true,
      },
    }),
  ]);
  const plan = planBarcodeBackfill(
    barcodes,
    variants.map((v) => ({
      variantId: v.id,
      sku: v.sku,
      manufacturerPartNumber: v.manufacturerPartNumber,
      isActive: v.isActive,
    })),
  );
  out.stdout(describeBackfillPlan(plan));
  if (!apply) {
    out.stdout("SZARAZFUTAS: semmi nem irodott. Alkalmazas: --apply\n");
    return 0;
  }

  await db.$transaction([
    ...plan.typeUpdates.map((u) =>
      db.productBarcode.update({
        where: { id: u.id },
        data: { type: u.type, ...(u.setSource ? { source: "IMPORT" } : {}) },
      }),
    ),
    ...plan.newRows.map((r) =>
      db.productBarcode.create({
        data: {
          variantId: r.variantId,
          code: r.code,
          type: r.type,
          source: "UNAS",
          isPrimary: true,
        },
      }),
    ),
  ]);
  out.stdout(
    `ALKALMAZVA: ${plan.typeUpdates.length} sor tipusa, ${plan.newRows.length} uj sor\n`,
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
