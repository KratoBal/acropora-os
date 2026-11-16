import type {
  MedusaPriceRow,
  MedusaVariantPriceLookupResult,
  MedusaVariantPriceRow,
} from "./medusa-admin.client.js";
import { MEDUSA_CURRENCY_CODE } from "./medusa-pricing.policy.js";

/**
 * A KETTOS FORINT AR KIZAROLAG OLVASO MERESE (task t-20261116-ket-forint-ar, acrobot 53839).
 *
 * Az `ambiguous-price` megallas azt jelenti, hogy egy Medusa valtozaton KET (vagy tobb) forint ar sor all, es a vetites nem tudja, melyik a
 * miene (a rossz valasztas a masikat torolne: a Medusa ar-frissitese teljes csere). A flotta a store API-bol ezt nem latja (az csak a
 * feloldott `calculated_price`-t adja), az ar-sorok az admin vegponton vannak. Ez a modul AZ ADATBOL SZAMOL, es SEMMIT nem ir:
 * minden valtozatra megmondja a forint sorok osszeget, hogy egyszeruek-e (nincs arlista, szabaly, mennyisegi hatar), az OS arat, es hogy
 * a kesobbi (KULON lepesben, ember altal jovahagyott) adatjavitas MIT tenne -- de a javaslat itt csak ADAT, nem vegrehajtas.
 *
 * A javaslat szabalya (acrobot 53839 elfogadta a murena-javaslatot):
 *   (i)   minden sor egyszeru ES az osszegek egyenlok -> a regebbi azonositoju marad, a tobbi torlendo;
 *   (ii)  az osszegek elternek -> az marad, amelyik az OS arral egyezik (tobb egyezo kozul a regebbi), a tobbi torlendo;
 *   (iii) egyik sem egyezik az OS arral, vagy bármelyik sor nem egyszeru, vagy a sor alakja ismeretlen -> NEM nyulunk hozza.
 * "Regebbi": az ar-azonosito ULID-ja idorendben rendezett, tehat a szoveges sorrend szerinti kisebb.
 */

export type PriceRowKind = "plain" | "non-plain" | "unknown";

/**
 * A SOR FAJTAJA. `unknown`, ha a valasz egyik jelet sem hozta (`price_list_id`, `rules_count`, `min_quantity`, `max_quantity` mind
 * `undefined`): a hianyzo jel NEM egyenlo azzal, hogy nincs arlista -- ugyanaz a szabaly, mint a `priceConflictShape`-ben. Az
 * `unknown` sort nem tekintjuk egyszerunek.
 */
export function priceRowKind(row: MedusaPriceRow): PriceRowKind {
  if (
    row.price_list_id === undefined &&
    row.rules_count === undefined &&
    row.min_quantity === undefined &&
    row.max_quantity === undefined
  )
    return "unknown";
  const nonPlain =
    Boolean(row.price_list_id) ||
    (row.rules_count ?? 0) > 0 ||
    (row.min_quantity !== undefined && row.min_quantity !== null) ||
    (row.max_quantity !== undefined && row.max_quantity !== null);
  return nonPlain ? "non-plain" : "plain";
}

export type PriceAuditVerdict =
  /** nincs forint ar sor */
  | "none"
  /** egy forint ar sor: nincs mit javitani */
  | "single"
  | "duplicates-equal"
  | "duplicates-pick-os"
  | "duplicates-no-os-match"
  | "non-plain-row"
  | "unknown-row-shape";

export interface PriceAuditRow {
  id: string;
  amount: number;
  kind: PriceRowKind;
  /** az OS arral egyezik-e (`null`, ha az OS ar nem ismert) */
  matchesOs: boolean | null;
}

export interface PriceAuditResult {
  /** a forint sorok (a nem forint sorok csak a szamukban latszanak) */
  hufRows: PriceAuditRow[];
  foreignRows: number;
  osAmount: number | null;
  verdict: PriceAuditVerdict;
  /** a javaslat: melyik sor marad / torlendo. Csak ADAT; ez a modul semmit nem torol. */
  keepId: string | null;
  deleteIds: string[];
}

const older = (a: string, b: string) => (a <= b ? a : b);

export function auditVariantPrices(input: {
  rows: readonly MedusaPriceRow[];
  osAmount: number | null;
}): PriceAuditResult {
  const huf = input.rows.filter(
    (row) => row.currency_code.toLowerCase() === MEDUSA_CURRENCY_CODE,
  );
  const result = (
    verdict: PriceAuditVerdict,
    keepId: string | null = null,
    deleteIds: string[] = [],
  ): PriceAuditResult => ({
    hufRows: huf.map((row) => ({
      id: row.id,
      amount: row.amount,
      kind: priceRowKind(row),
      matchesOs: input.osAmount === null ? null : row.amount === input.osAmount,
    })),
    foreignRows: input.rows.length - huf.length,
    osAmount: input.osAmount,
    verdict,
    keepId,
    deleteIds,
  });

  if (huf.length === 0) return result("none");
  if (huf.length === 1) return result("single");

  const kinds = huf.map(priceRowKind);
  if (kinds.includes("unknown")) return result("unknown-row-shape");
  if (kinds.includes("non-plain")) return result("non-plain-row");

  const ids = huf.map((row) => row.id);
  if (huf.every((row) => row.amount === huf[0]!.amount)) {
    const keep = ids.reduce(older);
    return result(
      "duplicates-equal",
      keep,
      ids.filter((id) => id !== keep),
    );
  }

  const matching =
    input.osAmount === null
      ? []
      : huf.filter((row) => row.amount === input.osAmount);
  if (matching.length === 0) return result("duplicates-no-os-match");
  const keep = matching.map((row) => row.id).reduce(older);
  return result(
    "duplicates-pick-os",
    keep,
    ids.filter((id) => id !== keep),
  );
}

/** Egy sor a jelentesben, EMBERNEK es a kesobbi javitas listajanak. Azonositok es osszegek, titok nincs benne. */
export function formatAuditLine(
  osProductId: string,
  variantId: string,
  sku: string,
  result: PriceAuditResult,
): string {
  const rows = result.hufRows
    .map((row) => `${row.id}:${row.amount}:${row.kind}`)
    .join(",");
  return (
    `${osProductId} ${variantId} sku=${sku} huf=${result.hufRows.length}` +
    `${result.foreignRows ? ` foreign=${result.foreignRows}` : ""} rows=[${rows}]` +
    ` os=${result.osAmount ?? "-"} verdict=${result.verdict}` +
    ` keep=${result.keepId ?? "-"} delete=${result.deleteIds.join(",") || "-"}`
  );
}

/** A CSAK OLVASO ELERES: pontosan egy metodus (az admin `listVariantPrices`), irni nem tud. */
export interface PriceAuditReader {
  listVariantPrices(
    medusaProductId: string,
  ): Promise<MedusaVariantPriceLookupResult>;
}

export interface PriceAuditTarget {
  osProductId: string;
  sku: string;
  /** az az osszeg, amit a vetites kuldene (`decidePricingProjection`), vagy `null`, ha az OS ar nem kuldheto */
  osAmount: number | null;
}

export interface PriceAuditDeps {
  /** az OS oldali celok egy termekre (valtozatonkent egy) es az elakadasok emberi mondatai */
  resolve(osProductId: string): Promise<{
    targets: PriceAuditTarget[];
    errors: string[];
  }>;
  /** a termek Medusa azonositoja a kotesbol, vagy `null` */
  findMedusaProductId(osProductId: string): Promise<string | null>;
  reader: PriceAuditReader;
  /** a Medusa valtozat a cikkszam szerint (a vetites `matchVariant`-ja) */
  matchVariant(
    rows: MedusaVariantPriceRow[],
    sku: string,
  ): { variant: MedusaVariantPriceRow } | { error: string };
}

export interface PriceAuditSummary {
  variants: number;
  byVerdict: Record<string, number>;
  /** a termekek, amelyeknel a vizsgalat nem fejezodott be (nincs kotes, elakadas, olvasasi hiba, csonkolt lista) */
  unreadable: number;
}

/**
 * A TERMEKENKENTI KOR. A hiba egy termeket nem allit meg a tobbitol, es SEMMI nem csendben esik ki: az `unreadable` szamlalo es a
 * `# ` kezdetu sorok mondjak meg, mi nem volt olvashato. Alapbol csak a javitando (nem `single`/`none`) valtozatok sora jelenik meg
 * (`all`: mind), az osszesites mindig kiiródik.
 */
export async function auditProducts(
  osProductIds: readonly string[],
  deps: PriceAuditDeps,
  out: { stdout(value: string): void; stderr(value: string): void },
  options: { all?: boolean } = {},
): Promise<PriceAuditSummary> {
  const summary: PriceAuditSummary = {
    variants: 0,
    byVerdict: {},
    unreadable: 0,
  };
  for (const osProductId of osProductIds) {
    const { targets, errors } = await deps.resolve(osProductId);
    for (const error of errors) {
      summary.unreadable += 1;
      out.stdout(`# ${osProductId}: ${error}\n`);
    }
    if (!targets.length) continue;
    const medusaProductId = await deps.findMedusaProductId(osProductId);
    if (!medusaProductId) {
      summary.unreadable += 1;
      out.stdout(`# ${osProductId}: nincs Medusa-leképezés\n`);
      continue;
    }
    let found: MedusaVariantPriceLookupResult;
    try {
      found = await deps.reader.listVariantPrices(medusaProductId);
    } catch (error) {
      summary.unreadable += 1;
      out.stdout(
        `# ${osProductId}: az ár-sorok olvasása elhasalt (${error instanceof Error ? error.name : "UNKNOWN"})\n`,
      );
      continue;
    }
    if (found.truncated) {
      summary.unreadable += 1;
      out.stdout(
        `# ${osProductId}: a változat-lista csonkolt, nem döntünk rajta\n`,
      );
      continue;
    }
    for (const target of targets) {
      const matched = deps.matchVariant(found.rows, target.sku);
      if ("error" in matched) {
        summary.unreadable += 1;
        out.stdout(`# ${osProductId} sku=${target.sku}: ${matched.error}\n`);
        continue;
      }
      const prices = matched.variant.prices;
      if (!prices) {
        summary.unreadable += 1;
        out.stdout(
          `# ${osProductId} sku=${target.sku}: a válasz nem hozta az árakat\n`,
        );
        continue;
      }
      const result = auditVariantPrices({
        rows: prices,
        osAmount: target.osAmount,
      });
      summary.variants += 1;
      summary.byVerdict[result.verdict] =
        (summary.byVerdict[result.verdict] ?? 0) + 1;
      if (
        options.all ||
        (result.verdict !== "single" && result.verdict !== "none")
      )
        out.stdout(
          `${formatAuditLine(osProductId, matched.variant.id, target.sku, result)}\n`,
        );
    }
  }
  out.stdout(
    `# összesítés: ${summary.variants} változat, olvashatatlan ${summary.unreadable}, ` +
      `${
        Object.entries(summary.byVerdict)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ") || "-"
      }\n`,
  );
  return summary;
}

/**
 * A PARANCS ARGUMENTUMAI. Az olvaso mod NEM fogadja el az `--forget-link`-et (az a kotes sorat torolne) es a `sku:` alakot (a
 * kotes termek-azonositobol keresheto: egy cikkszam tobb termeket is erinthet); a `--all` minden valtozat sorat kiirja. A tobbi
 * (`<termekazonosito>...` vagy `--limit N [--from <azonosito>]`) a vetites kotegelt valasztojanak megy tovabb.
 */
export function parseAuditArguments(
  args: readonly string[],
):
  | { kind: "ok"; all: boolean; batchArgs: string[] }
  | { kind: "error"; message: string } {
  if (args.includes("--forget-link"))
    return {
      kind: "error",
      message:
        "az ár-vizsgálat csak olvas: a --forget-link a leképezés sorát törölné, ez a parancs ezt nem fogadja el.",
    };
  const sku = args.find((arg) => arg.startsWith("sku:"));
  if (sku)
    return {
      kind: "error",
      message: `a ${sku} alak itt nem támogatott: termékazonosítót adj meg (a leképezés abból keresendő).`,
    };
  return {
    kind: "ok",
    all: args.includes("--all"),
    batchArgs: args.filter((arg) => arg !== "--all"),
  };
}
