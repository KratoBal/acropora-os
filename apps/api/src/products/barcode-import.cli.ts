import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { prisma } from "@acropora/database";

import {
  parseImportFile,
  summarise,
  type ImportRowOutcome,
} from "./barcode-import.js";

export interface ImportCliOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

const processOutput: ImportCliOutput = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

/**
 * One-off loader for the barcodes that currently live in the SKU field.
 *
 * Three properties matter more than speed here, because this runs once,
 * against the production database, by hand:
 *
 * - It never writes `sku`. It only reads it, to find the variant. The whole
 *   point of this step is that the barcode gains a home of its own *while*
 *   staying in the SKU field; nothing is renamed yet.
 * - It is idempotent. A code already on its variant counts as ALREADY_PRESENT
 *   and the run continues, so re-running after a partial failure is safe and
 *   boring.
 * - No single row can end the run. Every row gets an outcome, and the summary
 *   at the end says how many of each - a run that stopped at row 412 would
 *   leave nobody knowing what did and did not happen.
 *
 * `--dry-run` performs every lookup and every decision but writes nothing.
 */
export async function main(
  argv: readonly string[],
  output: ImportCliOutput = processOutput,
): Promise<number> {
  const filePath = argv.find((argument) => !argument.startsWith("--"));
  const dryRun = argv.includes("--dry-run");

  if (!filePath) {
    output.stderr(
      "Használat: barcode-import <fájl.csv> [--dry-run]\n" +
        "A fájl fejléce: sku,barcode[,isPrimary]\n",
    );
    return 1;
  }

  let parsed;
  try {
    parsed = parseImportFile(readFileSync(filePath, "utf8"));
  } catch (error) {
    output.stderr(
      `${error instanceof Error ? error.message : "A fájl nem olvasható."}\n`,
    );
    return 1;
  }

  const outcomes: ImportRowOutcome[] = parsed.rejected.map(
    (row) => row.outcome,
  );
  for (const row of parsed.rejected)
    output.stdout(`${row.line}. sor  ${row.outcome}  ${row.reason}\n`);

  if (dryRun) output.stdout("\n-- PRÓBAFUTÁS: semmi nem íródik ki --\n\n");

  for (const row of parsed.rows) {
    const variant = await prisma.productVariant.findUnique({
      where: { sku: row.sku },
      select: { id: true },
    });
    if (!variant) {
      outcomes.push("UNKNOWN_SKU");
      output.stdout(`${row.line}. sor  UNKNOWN_SKU  ${row.sku}\n`);
      continue;
    }

    const owner = await prisma.productBarcode.findUnique({
      where: { code: row.code },
      select: { variantId: true, variant: { select: { sku: true } } },
    });
    if (owner) {
      const same = owner.variantId === variant.id;
      outcomes.push(same ? "ALREADY_PRESENT" : "TAKEN_BY_OTHER_VARIANT");
      output.stdout(
        same
          ? `${row.line}. sor  ALREADY_PRESENT  ${row.sku}  ${row.code}\n`
          : `${row.line}. sor  TAKEN_BY_OTHER_VARIANT  ${row.code} már a(z) ${owner.variant.sku} változaté\n`,
      );
      continue;
    }

    if (!dryRun) {
      const count = await prisma.productBarcode.count({
        where: { variantId: variant.id },
      });
      const primary = row.isPrimary ?? count === 0;
      if (primary)
        await prisma.productBarcode.updateMany({
          where: { variantId: variant.id, isPrimary: true },
          data: { isPrimary: false },
        });
      await prisma.productBarcode.create({
        data: { variantId: variant.id, code: row.code, isPrimary: primary },
      });
    }

    outcomes.push("CREATED");
    const warning =
      row.eanCheckDigitValid === false
        ? "  (EAN ellenőrző számjegy hibás)"
        : "";
    output.stdout(
      `${row.line}. sor  CREATED  ${row.sku}  ${row.code}${warning}\n`,
    );
  }

  const totals = summarise(outcomes);
  output.stdout(
    "\n" +
      `Feldolgozott sorok:        ${outcomes.length}\n` +
      `  létrehozva:              ${totals.CREATED}${dryRun ? " (próbafutás, nem íródott ki)" : ""}\n` +
      `  már megvolt:             ${totals.ALREADY_PRESENT}\n` +
      `  más változaté:           ${totals.TAKEN_BY_OTHER_VARIANT}\n` +
      `  ismeretlen cikkszám:     ${totals.UNKNOWN_SKU}\n` +
      `  érvénytelen vonalkód:    ${totals.INVALID_BARCODE}\n` +
      `  hibás sor:               ${totals.MALFORMED_ROW}\n` +
      `  duplikátum a fájlban:    ${totals.DUPLICATE_IN_FILE}\n`,
  );

  // A completed run is a success even with skipped rows: the skips are facts
  // about the data, and the operator can see every one of them above.
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
