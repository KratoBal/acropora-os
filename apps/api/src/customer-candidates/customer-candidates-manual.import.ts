import { createHash } from "node:crypto";

import {
  ManualListError,
  parseManualEntries,
  planManualReplace,
  type ManualPlan,
  type ManualPlanCurrent,
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
  /** An empty file replaces the whole list with nothing: it needs this switch. */
  allowEmpty: boolean;
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
  let allowEmpty = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--apply") apply = true;
    else if (arg === "--approved-by") approvedBy = argv[++index] ?? null;
    else if (arg === "--fingerprint") fingerprint = argv[++index] ?? null;
    else if (arg === "--allow-empty") allowEmpty = true;
    else if (arg.startsWith("--"))
      return { error: `Ismeretlen kapcsoló: ${arg}` };
    else if (file === null) file = arg;
    else return { error: "Egy fájl adható meg." };
  }
  if (file === null) return { error: "Hiányzik a fájl (egy JSON tömb)." };
  return { file, apply, approvedBy, fingerprint, allowEmpty };
}

const byMove = (
  a: { productId: string; parameter: string; direction: string },
  b: { productId: string; parameter: string; direction: string },
) =>
  `${a.productId}|${a.parameter}|${a.direction}`.localeCompare(
    `${b.productId}|${b.parameter}|${b.direction}`,
  );
const contentOf = (row: ManualPlanCurrent) => [
  row.productId,
  row.sku,
  row.parameter,
  row.direction,
  row.referenceUrl,
  row.basis,
  row.sideEffects,
  row.sideEffectsStatus,
  row.note,
];

/**
 * THE FINGERPRINT COVERS WHAT WOULD BE STORED AND WHAT IS STORED NOW (barracuda, OS #2420): the file with its SKU resolution, AND the table's
 * current rows. If someone else imports between the dry run and the --apply, the rows this --apply would remove are not the ones the dry run
 * showed, and the fingerprint no longer matches.
 */
const fingerprintOf = (
  rows: readonly ManualRowToStore[],
  current: readonly ManualPlanCurrent[],
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        next: [...rows].sort(byMove).map(contentOf),
        current: [...current].sort(byMove).map(contentOf),
      }),
    )
    .digest("hex");

/** What the file means against the catalogue and the table, without writing anything: the same for the command and the admin endpoint. */
export interface ManualListAnalysis {
  rows: ManualRowToStore[];
  problems: RejectedRow[];
  warnings: string[];
  plan: ManualPlan;
  pending: number;
  shopText: number;
  fingerprint: string;
}

/** Throws `ManualListError` when the file is not a list at all; a bad row is a problem of the list, not a throw. */
export async function analyzeManualList(
  raw: unknown,
  store: ManualListStore,
): Promise<ManualListAnalysis> {
  const parsed = parseManualEntries(raw);
  const resolved = await store.resolve([
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
  const current = await store.current();
  const plan = planManualReplace(
    current,
    rows.map((row): ManualPlanNext => ({ ...row, parameter: row.parameter })),
  );
  return {
    rows,
    problems,
    warnings,
    plan,
    pending: rows.filter((row) => row.sideEffectsStatus === "PENDING").length,
    shopText: rows.filter((row) => row.basis === "SHOP_TEXT").length,
    fingerprint: fingerprintOf(rows, current),
  };
}

export type ApplyRefusal =
  | "REJECTED_ROWS"
  | "APPROVER_MISSING"
  | "EMPTY_NEEDS_ALLOW_EMPTY"
  | "FINGERPRINT_MISMATCH";

export interface ApplyInput {
  approvedBy: string | null;
  fingerprint: string | null;
  allowEmpty: boolean;
  /** Who applies it, for the audit row: the admin's user id, or null for the command. */
  auditUserId: string | null;
  source: "cli" | "http";
}

/**
 * THE CHECKS BEFORE A WRITE, in one place for both ways in: no rejected row, a named approver, an empty file only with the switch, and the
 * fingerprint the dry run showed. Only then the whole list replaces the table in one transaction, with an audit row in the same one.
 */
export async function applyManualList(
  analysis: ManualListAnalysis,
  input: ApplyInput,
  store: ManualListStore,
  now: Date,
): Promise<
  | { ok: true; stored: number; removed: number }
  | { ok: false; refusal: ApplyRefusal }
> {
  if (analysis.problems.length > 0)
    return { ok: false, refusal: "REJECTED_ROWS" };
  const approvedBy = input.approvedBy?.trim() ?? "";
  if (approvedBy === "") return { ok: false, refusal: "APPROVER_MISSING" };
  if (analysis.rows.length === 0 && !input.allowEmpty)
    return { ok: false, refusal: "EMPTY_NEEDS_ALLOW_EMPTY" };
  if (input.fingerprint !== analysis.fingerprint)
    return { ok: false, refusal: "FINGERPRINT_MISMATCH" };
  const done = await store.replace(analysis.rows, approvedBy, now, {
    userId: input.auditUserId,
    metadata: {
      source: input.source,
      approvedBy,
      fingerprint: analysis.fingerprint,
      plan: analysis.plan,
      rows: analysis.rows.length,
      pending: analysis.pending,
      shopText: analysis.shopText,
      allowEmpty: input.allowEmpty,
    },
  });
  return { ok: true, ...done };
}

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
  let analysis: ManualListAnalysis;
  try {
    analysis = await analyzeManualList(raw, deps.store);
  } catch (error) {
    if (error instanceof ManualListError) {
      out.stderr(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
  const { problems, plan, warnings } = analysis;
  out.stdout(
    `Sorok: ${analysis.rows.length} érvényes; ${problems.length} elutasított; hozzáadott ${plan.add}, módosított ${plan.update}, törölt ${plan.remove}, változatlan ${plan.unchanged}.\n` +
      `PENDING (a vevő felé nem megy): ${analysis.pending}; SHOP_TEXT alap (csak a teszten megy ki): ${analysis.shopText}.\n`,
  );
  for (const problem of [...problems].sort((a, b) => a.row - b.row))
    out.stdout(
      `  ELUTASÍTVA: ${problem.row}. sor (${problem.sku ?? "sku nélkül"}): ${problem.reason}\n`,
    );
  for (const warning of warnings) out.stdout(`  FIGYELEM: ${warning}\n`);
  out.stdout(`LENYOMAT: ${analysis.fingerprint}\n`);

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
  const result = await applyManualList(
    analysis,
    {
      approvedBy: options.approvedBy,
      fingerprint: options.fingerprint,
      allowEmpty: options.allowEmpty,
      auditUserId: null,
      source: "cli",
    },
    deps.store,
    deps.now(),
  );
  if (!result.ok) {
    if (result.refusal === "APPROVER_MISSING") {
      out.stderr(
        "Az --apply-hoz --approved-by kell (ki hagyta jóvá, és hol).\n",
      );
      return 2;
    }
    if (result.refusal === "EMPTY_NEEDS_ALLOW_EMPTY") {
      out.stderr(
        "A fájl üres: az --apply a TELJES listát törölné. Ha ez a szándék, add meg az --allow-empty kapcsolót is.\n",
      );
      return 2;
    }
    out.stderr(
      "A --fingerprint hiányzik vagy nem egyezik a mostani fájllal és katalógussal: az írás nem indul.\n",
    );
    return 1;
  }
  out.stdout(
    `Kész: ${result.stored} sor tárolva, ${result.removed} törölve (egy tranzakcióban).\n` +
      "A vevői jelöltek vetítése az óránkénti futással frissül (a végponton át az alkalmazás azonnal újraépíti).\n",
  );
  return 0;
}
