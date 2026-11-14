/**
 * THE BODY OF THE BULK "PERMANENTLY DISCONTINUED" COMMAND (V4.2, card 9d0523fa; acrobot 2026-11-14).
 *
 * WHY: the replacements polip proposes are approved by a person and then have to go onto hundreds of products;
 * one by one on the product page is the wrong tool for that. The input is a TSV, one product per line:
 * the discontinued product's SKU, a tab, and the approved replacement's SKU (or nothing: no replacement, the
 * shop then sends the visitor to the category). A line starting with `#`, an empty line and one header line
 * (`sku` in the first cell) are skipped.
 *
 * A DRY RUN IS THE DEFAULT, AND IT REFUSES EXACTLY WHAT A WRITE WOULD: the dry run asks the repository's own
 * `check` (the same checks the write runs inside its transaction), plus the interplay INSIDE the file (a row
 * whose product is an earlier row's replacement, a replacement that an earlier row marks, a SKU twice), so
 * the dry-run output and the `--apply` output are the same lines. `--apply` writes through the same repository
 * `set` as the API: the same refusals, one Serializable transaction, one audit row and one event per product.
 *
 * THE ACTOR IS REQUIRED AND HAS NO DEFAULT (`--actor <user-id>`, acrobot): the person running it names whom the
 * audit trail attributes the writes to; a missing or unknown user stops everything before any row is read.
 *
 * ONE BAD ROW DOES NOT STOP THE REST (a refused or a failing product is a line with a reason code), but the
 * exit code is 1 if any row was refused or failed, so a scheduler or a person sees it. A row that already has
 * exactly this mark is `ALREADY` and writes nothing, so a rerun of the same file is quiet.
 *
 * THE BODY HAS NO IMPORT OF THE COMMAND FILE (an entry point and its body importing each other made a
 * command exit 13 with no output once: acrobot 2026-09-17). It takes its collaborators as arguments.
 * Only SKUs and codes are printed, never a name, an address or an error text.
 */

export interface BulkRow {
  line: number;
  sku: string;
  replacementSku: string | null;
}

export type BulkStatus =
  "WOULD_WRITE" | "WRITTEN" | "ALREADY" | "REFUSED" | "ERROR";

export interface BulkResult {
  line: number;
  sku: string;
  replacementSku: string | null;
  status: BulkStatus;
  reason: string | null;
}

export interface BulkDeps {
  actorExists(userId: string): Promise<boolean>;
  /** SKU to the products that carry it (one is the normal case; more is ambiguous, none is unknown). */
  resolveSkus(skus: readonly string[]): Promise<Map<string, string[]>>;
  /** The mark a product has now: `null` unmarked, else its replacement's product id (or `null`). */
  currentMark(
    productId: string,
  ): Promise<{ replacementProductId: string | null } | null>;
  /** The refusal code a write would give, or `null`. Writes nothing. */
  check(
    productId: string,
    replacementProductId: string | null,
  ): Promise<string | null>;
  /** The real write (the same path as the API). A refusal from it comes back as a thrown `{ refusal }`. */
  write(
    productId: string,
    replacementProductId: string | null,
    actorUserId: string,
  ): Promise<void>;
}

export interface BulkIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export const BULK_MAX_ROWS = 2000;

export const BULK_USAGE = `A veglegesen megszunt jelolo TOMEGES bevitele.

  node dist/products/product-discontinuation-bulk.cli.js --file <fajl.tsv> --actor <felhasznalo-azonosito> [--apply]

    --file    TSV: soronkent a megszunt termek SKU-ja, tab, a jovahagyott helyettesito SKU-ja
              (vagy ures: nincs helyettesito, a kirakat a kategoriara iranyit); #-os sor, ures sor es
              egy fejlecsor (az elso cella: sku) kimarad; legfeljebb ${BULK_MAX_ROWS} sor
    --actor   KOTELEZO: a felhasznalo azonositoja, akinek a nevehez a naplo az irast rendeli
    --apply   kell az irashoz; nelkule SZARAZFUTAS: kiirja, mit irna, es melyik sort utasitana vissza es miert
    --help    ez a szoveg

Soronkent egy sor a kimeneten: sor, SKU, helyettesito SKU, allapot, ok. Allapot: WOULD_WRITE (szarazfutas),
WRITTEN, ALREADY (mar pontosan ez a jeloles), REFUSED, ERROR. Kilepesi kodok: 0 minden sor rendben,
1 volt visszautasitott vagy hibas sor, 2 rossz argumentum, olvashatatlan fajl vagy ismeretlen felhasznalo.
`;

const HEADER_CELLS = new Set(["sku", "megszunt_sku", "discontinued_sku"]);

/** The rows of the file, and the lines that are not rows (reported, not guessed). */
export function parseBulkFile(text: string): {
  rows: BulkRow[];
  badLines: { line: number; reason: string }[];
} {
  const rows: BulkRow[] = [];
  const badLines: { line: number; reason: string }[] = [];
  let sawData = false;
  text.split("\n").forEach((raw, index) => {
    const line = index + 1;
    const content = raw.replace(/\r$/, "");
    if (content.trim() === "" || content.trimStart().startsWith("#")) return;
    const cells = content.split("\t").map((cell) => cell.trim());
    if (!sawData) {
      sawData = true;
      if (HEADER_CELLS.has((cells[0] ?? "").toLowerCase())) return;
    }
    if (cells.length > 2 || !cells[0]) {
      badLines.push({ line, reason: "BAD_ROW" });
      return;
    }
    rows.push({ line, sku: cells[0], replacementSku: cells[1] || null });
  });
  return { rows, badLines };
}

function parseArgs(
  argv: readonly string[],
): { file: string; actor: string; apply: boolean } | string {
  let file: string | null = null;
  let actor: string | null = null;
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--apply") apply = true;
    else if (arg === "--file" || arg === "--actor") {
      const value = argv[++i];
      if (!value || value.startsWith("--"))
        return `A ${arg} ertekeet kell adni.`;
      if (arg === "--file") file = value;
      else actor = value;
    } else return `ISMERETLEN ARGUMENTUM: ${arg}`;
  }
  if (!file) return "A --file kotelezo.";
  if (!actor)
    return "Az --actor kotelezo, alapertek nelkul: nevezd meg, ki nevebe ir a parancs.";
  return { file, actor, apply };
}

/** Same rule as the other commands: only an upper-case code is safe to print, anything else is generic. */
function codeOf(error: unknown): string {
  const refusal =
    typeof error === "object" && error !== null && "refusal" in error
      ? (error as { refusal: unknown }).refusal
      : null;
  if (typeof refusal === "string") return refusal;
  return error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
    ? error.message.slice(0, 120)
    : "WRITE_FAILED";
}

export async function runBulkDiscontinuation(
  argv: readonly string[],
  readFile: (path: string) => string,
  deps: BulkDeps,
  io: BulkIo,
): Promise<number> {
  const args = parseArgs(argv);
  if (typeof args === "string") {
    io.stderr(`${args}\n\n${BULK_USAGE}`);
    return 2;
  }
  let text: string;
  try {
    text = readFile(args.file);
  } catch {
    io.stderr("A fajl nem olvashato.\n");
    return 2;
  }
  if (!(await deps.actorExists(args.actor))) {
    io.stderr("ACTOR_NOT_FOUND: az --actor felhasznalo nem letezik.\n");
    return 2;
  }
  const { rows, badLines } = parseBulkFile(text);
  if (rows.length + badLines.length > BULK_MAX_ROWS) {
    io.stderr(`TOO_MANY_ROWS: legfeljebb ${BULK_MAX_ROWS} sor.\n`);
    return 2;
  }

  const results: BulkResult[] = badLines.map((bad) => ({
    line: bad.line,
    sku: "-",
    replacementSku: null,
    status: "REFUSED",
    reason: bad.reason,
  }));
  const bySku = await deps.resolveSkus([
    ...new Set(
      rows.flatMap((r) => [
        r.sku,
        ...(r.replacementSku ? [r.replacementSku] : []),
      ]),
    ),
  ]);
  const one = (sku: string): string | "UNKNOWN" | "AMBIGUOUS" => {
    const ids = bySku.get(sku) ?? [];
    return ids.length === 1
      ? ids[0]!
      : ids.length === 0
        ? "UNKNOWN"
        : "AMBIGUOUS";
  };

  const seenProducts = new Set<string>();
  // the rows of THIS file that went (or would go) through: product to replacement, for the interplay inside the file
  const accepted = new Map<string, string | null>();
  for (const row of rows) {
    const base = {
      line: row.line,
      sku: row.sku,
      replacementSku: row.replacementSku,
    };
    const refuse = (reason: string): void => {
      results.push({ ...base, status: "REFUSED", reason });
    };
    const productId = one(row.sku);
    if (productId === "UNKNOWN") {
      refuse("SKU_NOT_FOUND");
      continue;
    }
    if (productId === "AMBIGUOUS") {
      refuse("SKU_AMBIGUOUS");
      continue;
    }
    let replacementId: string | null = null;
    if (row.replacementSku) {
      const found = one(row.replacementSku);
      if (found === "UNKNOWN") {
        refuse("REPLACEMENT_SKU_NOT_FOUND");
        continue;
      }
      if (found === "AMBIGUOUS") {
        refuse("REPLACEMENT_SKU_AMBIGUOUS");
        continue;
      }
      replacementId = found;
    }
    if (seenProducts.has(productId)) {
      refuse("DUPLICATE_ROW");
      continue;
    }
    seenProducts.add(productId);
    if ([...accepted.values()].includes(productId)) {
      refuse("PRODUCT_IS_A_REPLACEMENT");
      continue;
    }
    if (replacementId !== null && accepted.has(replacementId)) {
      refuse("REPLACEMENT_ALSO_DISCONTINUED");
      continue;
    }

    const current = await deps.currentMark(productId);
    if (current && current.replacementProductId === replacementId) {
      accepted.set(productId, replacementId);
      results.push({ ...base, status: "ALREADY", reason: null });
      continue;
    }
    const refusal = await deps.check(productId, replacementId);
    if (refusal) {
      refuse(refusal);
      continue;
    }
    if (!args.apply) {
      accepted.set(productId, replacementId);
      results.push({ ...base, status: "WOULD_WRITE", reason: null });
      continue;
    }
    try {
      await deps.write(productId, replacementId, args.actor);
      accepted.set(productId, replacementId);
      results.push({ ...base, status: "WRITTEN", reason: null });
    } catch (error) {
      const code = codeOf(error);
      const refused =
        typeof error === "object" && error !== null && "refusal" in error;
      results.push({
        ...base,
        status: refused ? "REFUSED" : "ERROR",
        reason: code,
      });
    }
  }

  results.sort((a, b) => a.line - b.line);
  io.stdout(
    `MODE\t${args.apply ? "APPLY" : "DRY_RUN"}\tactor=${args.actor}\trows=${results.length}\n`,
  );
  for (const r of results)
    io.stdout(
      `${r.line}\t${r.sku}\t${r.replacementSku ?? "-"}\t${r.status}\t${r.reason ?? "-"}\n`,
    );
  const count = (status: BulkStatus) =>
    results.filter((r) => r.status === status).length;
  io.stdout(
    `SUMMARY\twritten=${count("WRITTEN")}\twould_write=${count("WOULD_WRITE")}\talready=${count("ALREADY")}\trefused=${count("REFUSED")}\terror=${count("ERROR")}\n`,
  );
  if (!args.apply)
    io.stdout("SZARAZFUTAS: semmi nem irodott. Iraskor: --apply\n");
  return count("REFUSED") + count("ERROR") === 0 ? 0 : 1;
}
