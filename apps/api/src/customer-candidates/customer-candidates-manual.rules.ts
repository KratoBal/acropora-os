import { WATER_PARAMETER_CODES } from "@acropora/jev/product-enrichment";

/**
 * A VEVŐ FELÉ AJÁNLHATÓ TERMÉKEK KÉZI LISTÁJA: A FÁJL SZABÁLYAI (V3.4 S2c, kártya ce6c5cc9; Balázs 2026-11-11 11:44:46 UTC, (e): paraméterenként
 * 3-5 termék kézzel; acrobot 47162: a SHOP_TEXT alap a TESZT ReefClubra, kapcsoló mögött). A tiszta rész: egy JSON tömb sorai, soronként egy
 * termék EGY MOZGÁSRA, és mi fogad el belőle. Egy rossz sor NEM marad ki csendben: a lista végén a sor száma, a cikkszáma és az OKA áll, és
 * az `--apply` nem indul, amíg van elutasított sor (a hívó dönt, de a jelentés teljes).
 *
 * A MEZŐK: `sku` (a `ProductVariant.sku`, a parancs oldja fel termékre), `parameter` (KH, KALCIUM, MAGNEZIUM, NITRAT: a négy vevő felé
 * jóváhagyott), `direction` (EMEL | CSOKKENT), `referenceUrl` (https: a gyártói oldal vagy a termék bolti lapja), `basis` (MAKER | SHOP_TEXT),
 * `sideEffects` ("KOD:IRANY" a NEM jóváhagyott paraméterekre: foszfát, nitrit, szilikát ..., és a STRONCIUM, ami nem JEV-kód, ezért csak
 * mellékhatásként létezik), `sideEffectsStatus` (FILLED | PENDING), `note`. Ismeretlen mező elutasít (egy elgépelt kulcs ne tűnjön el).
 *
 * A FILLED sor üres `sideEffects`-szel azt jelenti: a leírás kifejezetten nem említ mellékhatást (nem hiányzó adat). A PENDING sor a táblában
 * van, de a vevő felé nem megy, amíg ki nem töltik.
 */
export const MANUAL_PARAMETERS = [
  "KH",
  "KALCIUM",
  "MAGNEZIUM",
  "NITRAT",
] as const;
export const MANUAL_DIRECTIONS = ["EMEL", "CSOKKENT"] as const;
export const MANUAL_BASES = ["MAKER", "SHOP_TEXT"] as const;
export const MANUAL_STATUSES = ["FILLED", "PENDING"] as const;

/** A mellékhatás kódjai: a JEV vízparaméter-kódjai, kivéve a vevő felé jóváhagyott négyet, plusz a STRONCIUM. */
export const SIDE_EFFECT_CODES: ReadonlySet<string> = new Set([
  ...WATER_PARAMETER_CODES.filter(
    (code) => !(MANUAL_PARAMETERS as readonly string[]).includes(code),
  ),
  "STRONCIUM",
]);

export interface ParsedManualEntry {
  sku: string;
  parameter: (typeof MANUAL_PARAMETERS)[number];
  direction: (typeof MANUAL_DIRECTIONS)[number];
  referenceUrl: string;
  basis: (typeof MANUAL_BASES)[number];
  /** "KOD:IRANY", a kódok szerint rendezve, egyszer. */
  sideEffects: string[];
  sideEffectsStatus: (typeof MANUAL_STATUSES)[number];
  note: string | null;
}

export interface RejectedRow {
  /** 1-től, a fájl sorrendjében. */
  row: number;
  sku: string | null;
  reason: string;
}

export interface ManualParseResult {
  entries: ParsedManualEntry[];
  rejected: RejectedRow[];
}

export class ManualListError extends Error {}

const KEYS = new Set([
  "sku",
  "parameter",
  "direction",
  "referenceUrl",
  "basis",
  "sideEffects",
  "sideEffectsStatus",
  "note",
]);
const HTTPS = /^https:\/\/[^\s]+$/;
const oneOf = <T extends string>(
  list: readonly T[],
  value: unknown,
): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

function parseRow(
  value: unknown,
):
  | { ok: true; entry: ParsedManualEntry }
  | { ok: false; sku: string | null; reason: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { ok: false, sku: null, reason: "a sor nem objektum" };
  const row = value as Record<string, unknown>;
  const sku = typeof row.sku === "string" ? row.sku.trim() : "";
  const skuForReport = sku === "" ? null : sku;
  const fail = (reason: string) => ({
    ok: false as const,
    sku: skuForReport,
    reason,
  });
  for (const key of Object.keys(row))
    if (!KEYS.has(key)) return fail(`ismeretlen mező: ${key}`);
  if (sku === "" || sku.length > 64) return fail("hiányzó vagy túl hosszú sku");
  if (!oneOf(MANUAL_PARAMETERS, row.parameter))
    return fail(`a parameter ${MANUAL_PARAMETERS.join(", ")} lehet`);
  if (!oneOf(MANUAL_DIRECTIONS, row.direction))
    return fail("a direction EMEL vagy CSOKKENT lehet");
  if (
    typeof row.referenceUrl !== "string" ||
    row.referenceUrl.length > 500 ||
    !HTTPS.test(row.referenceUrl)
  )
    return fail("a referenceUrl nem https cím");
  if (!oneOf(MANUAL_BASES, row.basis))
    return fail("a basis MAKER vagy SHOP_TEXT lehet");
  if (!oneOf(MANUAL_STATUSES, row.sideEffectsStatus))
    return fail("a sideEffectsStatus FILLED vagy PENDING lehet");
  if (!Array.isArray(row.sideEffects)) return fail("a sideEffects nem tömb");
  const seen = new Map<string, string>();
  for (const item of row.sideEffects) {
    if (typeof item !== "string") return fail("a sideEffects eleme nem szöveg");
    const [code, direction, ...rest] = item.split(":");
    if (!code || !direction || rest.length > 0)
      return fail(`a mellékhatás nem KOD:IRANY alakú: ${item}`);
    if (!SIDE_EFFECT_CODES.has(code))
      return fail(`ismeretlen mellékhatás-kód: ${code}`);
    if (!oneOf(MANUAL_DIRECTIONS, direction))
      return fail(`a mellékhatás iránya EMEL vagy CSOKKENT lehet: ${item}`);
    if (seen.has(code) && seen.get(code) !== direction)
      return fail(`ellentétes mellékhatás ugyanarra a kódra: ${code}`);
    seen.set(code, direction);
  }
  if (
    row.note !== undefined &&
    row.note !== null &&
    (typeof row.note !== "string" || row.note.length > 1000)
  )
    return fail("a note nem szöveg vagy túl hosszú");
  return {
    ok: true,
    entry: {
      sku,
      parameter: row.parameter,
      direction: row.direction,
      referenceUrl: row.referenceUrl,
      basis: row.basis,
      sideEffects: [...seen.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, direction]) => `${code}:${direction}`),
      sideEffectsStatus: row.sideEffectsStatus,
      note:
        typeof row.note === "string" && row.note.trim() !== ""
          ? row.note.trim()
          : null,
    },
  };
}

/** A teljes fájl: egy tömb, sorok. A nem tömb a fájl hibája (ManualListError), egy rossz sor a soré. */
export function parseManualEntries(raw: unknown): ManualParseResult {
  if (!Array.isArray(raw)) throw new ManualListError("A fájl nem JSON tömb.");
  const entries: ParsedManualEntry[] = [];
  const rejected: RejectedRow[] = [];
  const keys = new Set<string>();
  raw.forEach((value, index) => {
    const parsed = parseRow(value);
    if (!parsed.ok) {
      rejected.push({ row: index + 1, sku: parsed.sku, reason: parsed.reason });
      return;
    }
    const key = `${parsed.entry.sku}|${parsed.entry.parameter}|${parsed.entry.direction}`;
    if (keys.has(key)) {
      rejected.push({
        row: index + 1,
        sku: parsed.entry.sku,
        reason: "ugyanaz a termék ugyanarra a mozgásra kétszer áll a fájlban",
      });
      return;
    }
    keys.add(key);
    entries.push(parsed.entry);
  });
  return { entries, rejected };
}

export interface ManualPlanCurrent {
  productId: string;
  /** The SKU the row was imported under: a changed SKU on the same product is a change (the stored one is the trail back to the file). */
  sku: string;
  parameter: string;
  direction: string;
  referenceUrl: string;
  basis: string;
  sideEffects: readonly string[];
  sideEffectsStatus: string;
  note: string | null;
}
export interface ManualPlanNext extends Omit<ManualPlanCurrent, "parameter"> {
  parameter: string;
  sku: string;
}

export interface ManualPlan {
  add: number;
  update: number;
  remove: number;
  unchanged: number;
}

const keyOf = (row: {
  productId: string;
  parameter: string;
  direction: string;
}) => `${row.productId}|${row.parameter}|${row.direction}`;
export const sameManualContent = (a: ManualPlanCurrent, b: ManualPlanCurrent) =>
  a.sku === b.sku &&
  a.referenceUrl === b.referenceUrl &&
  a.basis === b.basis &&
  a.sideEffectsStatus === b.sideEffectsStatus &&
  a.note === b.note &&
  a.sideEffects.length === b.sideEffects.length &&
  a.sideEffects.every((item, index) => item === b.sideEffects[index]);

/**
 * A CSERE TERVE: a fájl a TELJES kézi lista (az `--apply` a táblát egy tranzakcióban a fájl tartalmára cseréli), tehát ami a fájlban nincs,
 * kikerül. A számok a próba kimenetén állnak, hogy az ember lássa, mennyi változik.
 */
export function planManualReplace(
  current: readonly ManualPlanCurrent[],
  next: readonly ManualPlanNext[],
): ManualPlan {
  const before = new Map(current.map((row) => [keyOf(row), row]));
  const after = new Set(next.map(keyOf));
  let add = 0;
  let update = 0;
  let unchanged = 0;
  for (const row of next) {
    const held = before.get(keyOf(row));
    if (!held) add += 1;
    else if (sameManualContent(held, row)) unchanged += 1;
    else update += 1;
  }
  const remove = [...before.keys()].filter((key) => !after.has(key)).length;
  return { add, update, remove, unchanged };
}

/**
 * The table changed between the dry run and the write: the rows read UNDER THE REPLACEMENT'S LOCK are not the ones the fingerprint
 * was made against. Nothing is written (murena's open point on #2428). Here, beside `ManualListError`, so the import stays free of
 * the database.
 */
export class ManualListChangedError extends Error {
  constructor() {
    super("the manual list changed since the dry run");
  }
}
