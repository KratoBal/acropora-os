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
        "A fájl fejléce: unas_id,barcode[,isPrimary]  (vagy sku,barcode[,isPrimary])\n",
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
    const resolved = await resolveVariant(parsed.keyKind, row.key);
    if (resolved.kind === "none") {
      outcomes.push("UNKNOWN_KEY");
      output.stdout(`${row.line}. sor  UNKNOWN_KEY  ${row.key}\n`);
      continue;
    }
    if (resolved.kind === "ambiguous") {
      // A UNAS id names a *product*, and a product may hold several variants
      // (UNAS variant-stock products are separated locally, one row each). A
      // barcode belongs to exactly one of them, and nothing in the file says
      // which. Guessing would put the code on the wrong shelf, so the row is
      // reported with its candidates and left for a human decision.
      outcomes.push("AMBIGUOUS_VARIANT");
      output.stdout(
        `${row.line}. sor  AMBIGUOUS_VARIANT  ${row.key} -> ${resolved.skus.length} változat: ${resolved.skus.join(", ")}\n`,
      );
      continue;
    }
    const variant = { id: resolved.variantId };

    const owner = await prisma.productBarcode.findUnique({
      where: { code: row.code },
      select: { variantId: true, variant: { select: { sku: true } } },
    });
    if (owner) {
      const same = owner.variantId === variant.id;
      outcomes.push(same ? "ALREADY_PRESENT" : "TAKEN_BY_OTHER_VARIANT");
      output.stdout(
        same
          ? `${row.line}. sor  ALREADY_PRESENT  ${row.key}  ${row.code}\n`
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
    output.stdout(`${row.line}. sor  CREATED  ${row.key}  ${row.code}\n`);
  }

  const totals = summarise(outcomes);
  const label = parsed.keyKind === "unasId" ? "UNAS-azonosító" : "cikkszám";
  output.stdout(
    "\n" +
      `Azonosító oszlop:            ${label}\n` +
      `Feldolgozott sorok:          ${outcomes.length}\n` +
      `  létrehozva:                ${totals.CREATED}${dryRun ? " (próbafutás, nem íródott ki)" : ""}\n` +
      `  már megvolt:               ${totals.ALREADY_PRESENT}\n` +
      `  más változaté:             ${totals.TAKEN_BY_OTHER_VARIANT}\n` +
      `  ismeretlen ${label}:${" ".repeat(Math.max(1, 14 - label.length))}${totals.UNKNOWN_KEY}\n` +
      `  több változat, döntés kell: ${totals.AMBIGUOUS_VARIANT}\n` +
      `  érvénytelen vonalkód:      ${totals.INVALID_BARCODE}\n` +
      `  hibás EAN ellenőrző jegy:  ${totals.INVALID_EAN_CHECK_DIGIT}\n` +
      `  hibás sor:                 ${totals.MALFORMED_ROW}\n` +
      `  duplikátum a fájlban:      ${totals.DUPLICATE_IN_FILE}\n`,
  );

  if (totals.AMBIGUOUS_VARIANT)
    output.stdout(
      "\nA több változatot adó sorok NEM kerültek be. Egy UNAS-azonosító a\n" +
        "terméket nevezi meg, egy vonalkód viszont pontosan egy változaté; a\n" +
        "fájl nem mondja meg, melyiké. Ezekhez változatonkénti döntés kell.\n",
    );

  // A completed run is a success even with skipped rows: the skips are facts
  // about the data, and the operator can see every one of them above.
  return 0;
}

type ResolvedVariant =
  | { kind: "one"; variantId: string }
  | { kind: "ambiguous"; skus: string[] }
  | { kind: "none" };

/**
 * Finds the variant a row refers to.
 *
 * A SKU identifies a variant directly. A UNAS id does not: it is recorded on
 * `ExternalReference(UNAS, "Product", externalId)` and points at a *Product*,
 * exactly as the UNAS sync writes it. A product with one variant resolves
 * cleanly; a UNAS variant-stock product is separated locally into one row per
 * combination, and then the file alone cannot say which one the barcode
 * belongs to.
 */
async function resolveVariant(
  keyKind: "unasId" | "sku",
  key: string,
): Promise<ResolvedVariant> {
  if (keyKind === "sku") {
    const variant = await prisma.productVariant.findUnique({
      where: { sku: key },
      select: { id: true },
    });
    return variant ? { kind: "one", variantId: variant.id } : { kind: "none" };
  }

  const reference = await prisma.externalReference.findUnique({
    where: {
      system_entityType_externalId: {
        system: "UNAS",
        entityType: "Product",
        externalId: key,
      },
    },
    select: { entityId: true },
  });
  if (!reference) return { kind: "none" };

  const variants = await prisma.productVariant.findMany({
    where: { productId: reference.entityId },
    select: { id: true, sku: true },
    orderBy: { sku: "asc" },
  });
  if (variants.length === 0) return { kind: "none" };
  if (variants.length > 1)
    return { kind: "ambiguous", skus: variants.map((v) => v.sku) };
  return { kind: "one", variantId: variants[0]!.id };
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
