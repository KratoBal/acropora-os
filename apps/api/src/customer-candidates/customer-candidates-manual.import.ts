import { createHash } from "node:crypto";

import {
  ManualListError,
  parseManualEntries,
  planManualReplace,
  type ManualPlanNext,
  type ParsedManualEntry,
  type RejectedRow,
} from "./customer-candidates-manual.rules.js";
import type {
  ManualListStore,
  ManualRowToStore,
} from "./customer-candidates-manual.repository.js";

/**
 * A KÉZI TERMÉKLISTA IMPORTJA (V3.4 S2c, kártya ce6c5cc9): `customer-candidates:import <fájl> [--apply --approved-by "<név és forrás>" --fingerprint <lenyomat>]`.
 *
 * ALAPBÓL PRÓBA: semmi nem íródik. A próba kiírja a célt, a sorok számát, minden elutasított és fel nem oldott sort az OKÁVAL, a tábla
 * változását (hozzáadott, módosított, törölt, változatlan), a PENDING sorokat (a táblában vannak, de a vevő felé nem mennek), és a LENYOMATOT.
 * Az `--apply` CSAK ha: a jóváhagyó neve meg van adva (a CHECK és a napló is ezt várja), a lenyomat az, amit a próba mutatott (amit az
 * ember látott, csak az íródik), és NINCS elutasított, fel nem oldott vagy kétértelmű sor (a hívó dönt, de a jelentés teljes, és egy
 * félig érvényes lista nem megy be). A fájl a TELJES lista: a tábla egy tranzakcióban a fájl tartalmára cserélődik.
 */
export interface ImportOptions {
  file: string;
  apply: boolean;
  approvedBy: string | null;
  fingerprint: string | null;
}

export interface ImportDeps {
  store: ManualListStore;
  readFile: (path: string) => Promise<string>;
  now: () => Date;
  /** The target database, shown in the first line (no password). */
  target: string;
}

export interface ImportOutput {
  stdout(text: string): void;
  stderr(text: string): void;
}

export function parseImportArgs(
  argv: readonly string[],
): ImportOptions | { error: string } {
  let file: string | null = null;
  let apply = false;
  let approvedBy: string | null = null;
  let fingerprint: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--apply") apply = true;
    else if (arg === "--approved-by") approvedBy = argv[++index] ?? null;
    else if (arg === "--fingerprint") fingerprint = argv[++index] ?? null;
    else if (arg.startsWith("--"))
      return { error: `Ismeretlen kapcsoló: ${arg}` };
    else if (file === null) file = arg;
    else return { error: "Egy fájl adható meg." };
  }
  if (file === null) return { error: "Hiányzik a fájl (egy JSON tömb)." };
  return { file, apply, approvedBy, fingerprint };
}

const fingerprintOf = (rows: readonly ManualRowToStore[]): string =>
  createHash("sha256")
    .update(
      JSON.stringify(
        [...rows]
          .sort((a, b) =>
            `${a.productId}|${a.parameter}|${a.direction}`.localeCompare(
              `${b.productId}|${b.parameter}|${b.direction}`,
            ),
          )
          .map((row) => [
            row.productId,
            row.parameter,
            row.direction,
            row.referenceUrl,
            row.basis,
            row.sideEffects,
            row.sideEffectsStatus,
            row.note,
          ]),
      ),
    )
    .digest("hex");

export async function runManualImport(
  options: ImportOptions,
  deps: ImportDeps,
  out: ImportOutput,
): Promise<number> {
  out.stdout(`CÉL-ADATBÁZIS: ${deps.target}\n`);
  let raw: unknown;
  try {
    raw = JSON.parse(await deps.readFile(options.file));
  } catch {
    out.stderr("A fájl nem olvasható vagy nem JSON.\n");
    return 1;
  }
  let parsed;
  try {
    parsed = parseManualEntries(raw);
  } catch (error) {
    if (error instanceof ManualListError) {
      out.stderr(`${error.message}\n`);
      return 1;
    }
    throw error;
  }

  const resolved = await deps.store.resolve([
    ...new Set(parsed.entries.map((entry) => entry.sku)),
  ]);
  const problems: RejectedRow[] = [...parsed.rejected];
  const rows: ManualRowToStore[] = [];
  const warnings: string[] = [];
  const rowNumber = new Map<ParsedManualEntry, number>();
  parsed.entries.forEach((entry, index) => rowNumber.set(entry, index + 1));
  for (const entry of parsed.entries) {
    const matches = resolved.get(entry.sku) ?? [];
    if (matches.length === 0) {
      problems.push({
        row: rowNumber.get(entry)!,
        sku: entry.sku,
        reason: "nincs ilyen cikkszám a katalógusban",
      });
      continue;
    }
    if (matches.length > 1) {
      problems.push({
        row: rowNumber.get(entry)!,
        sku: entry.sku,
        reason: "a cikkszám több termékhez tartozik",
      });
      continue;
    }
    const product = matches[0]!;
    if (!product.active)
      warnings.push(
        `${entry.sku} (${product.productName}): a termék inaktív vagy archivált, a vetítés nem veszi be`,
      );
    rows.push({
      productId: product.productId,
      sku: entry.sku,
      parameter: entry.parameter,
      direction: entry.direction,
      referenceUrl: entry.referenceUrl,
      basis: entry.basis,
      sideEffects: entry.sideEffects,
      sideEffectsStatus: entry.sideEffectsStatus,
      note: entry.note,
    });
  }

  const plan = planManualReplace(
    await deps.store.current(),
    rows.map((row): ManualPlanNext => ({ ...row, parameter: row.parameter })),
  );
  const fingerprint = fingerprintOf(rows);
  const pending = rows.filter(
    (row) => row.sideEffectsStatus === "PENDING",
  ).length;
  const shopText = rows.filter((row) => row.basis === "SHOP_TEXT").length;
  out.stdout(
    `Sorok: ${rows.length} érvényes; ${problems.length} elutasított; hozzáadott ${plan.add}, módosított ${plan.update}, törölt ${plan.remove}, változatlan ${plan.unchanged}.\n` +
      `PENDING (a vevő felé nem megy): ${pending}; SHOP_TEXT alap (csak a teszten megy ki): ${shopText}.\n`,
  );
  for (const problem of [...problems].sort((a, b) => a.row - b.row))
    out.stdout(
      `  ELUTASÍTVA: ${problem.row}. sor (${problem.sku ?? "sku nélkül"}): ${problem.reason}\n`,
    );
  for (const warning of warnings) out.stdout(`  FIGYELEM: ${warning}\n`);
  out.stdout(`LENYOMAT: ${fingerprint}\n`);

  if (problems.length > 0) {
    out.stderr("Van elutasított sor: az írás nem indul.\n");
    return 1;
  }
  if (!options.apply) {
    out.stdout(
      'Próba: semmi nem íródott. Az íráshoz: --apply --approved-by "<név és forrás>" --fingerprint <a fenti lenyomat>.\n',
    );
    return 0;
  }
  if (!options.approvedBy || options.approvedBy.trim() === "") {
    out.stderr("Az --apply-hoz --approved-by kell (ki hagyta jóvá, és hol).\n");
    return 2;
  }
  if (options.fingerprint !== fingerprint) {
    out.stderr(
      "A --fingerprint hiányzik vagy nem egyezik a mostani fájllal és katalógussal: az írás nem indul.\n",
    );
    return 1;
  }
  const done = await deps.store.replace(
    rows,
    options.approvedBy.trim(),
    deps.now(),
  );
  out.stdout(
    `Kész: ${done.stored} sor tárolva, ${done.removed} törölve (egy tranzakcióban).\n`,
  );
  return 0;
}
