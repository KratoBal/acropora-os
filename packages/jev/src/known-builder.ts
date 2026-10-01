/**
 * A KNOWN-ENTITY LISTA EPITESE A SAJAT ADATBAZISUNK SORAIBOL.
 *
 * A marveen `scripts/jev/build_known.py` atirata (acrobot listaja, az r11 meres
 * ezzel a listaval futott): ugyanazok a forras-mezok (a hivo olvassa oket, lasd
 * `KNOWN_SOURCE_FIELDS`), ugyanaz az alias-kepzes es ugyanaz a befogado szuro,
 * a vegen a flotta szintu `EXTRA` nevekkel. A tesztek a Python kimenetevel vetik
 * ossze (`redact-vectors/expected.json`, `knownBuilder`).
 *
 * A lista NEM kerul lemezre: a folyamat memoriajaban el (lasd `knownTable`).
 */
import { pyre } from "./pyre.js";
import {
  entityTokens,
  fold,
  OPENER_WORDS,
  PRESERVED_TERMS,
  pyStrip,
} from "./redact.js";
import { INLINE, KNOWN_EXTRA, OTHER } from "./redact-data.js";

export type KnownRow = readonly [kind: string, value: string];

/**
 * A build_known.py SQL-je, mezorol mezore: [fajta, tabla, mezo vagy mezo-kepzes].
 * A szemely neve ket sorrendben is (keresztnev-vezeteknev es forditva).
 */
export const KNOWN_SOURCE_FIELDS = [
  ["PERSON", "User", "firstName lastName"],
  ["PERSON", "User", "lastName firstName"],
  ["PERSON", "User", "displayName"],
  ["PERSON", "User", "nickname"],
  ["EMAIL", "User", "email"],
  ["ORG", "Customer", "displayName"],
  ["ORG", "Customer", "companyName"],
  ["EMAIL", "Customer", "email"],
  ["ADDRESS", "CustomerAddress", "name"],
  ["ADDRESS", "CustomerAddress", "line1"],
  ["ADDRESS", "CustomerAddress", "line2"],
  ["ORG", "Supplier", "name"],
  ["PERSON", "Supplier", "contactPersonName"],
  ["EMAIL", "Supplier", "email"],
  ["EMAIL", "Supplier", "contactPersonEmail"],
  ["PERSON", "Contract", "contactPersonName"],
  ["ORG", "Contract", "organizationalUnitName"],
  ["PERSON", "WorksheetVersionSignature", "signerName"],
] as const;

const FORM = pyre(OTHER.knownForm);
const PAREN = pyre(INLINE.aliasParen, { global: true });
const CAPS = pyre(INLINE.aliasCaps, { global: true });

/** A szervezet toredek-nevei: a jogi forma nelkul, a zarojeles roviditessel, a csupa nagybetus szavakkal. */
function aliases(
  [kind, value]: KnownRow,
  common: ReadonlySet<string>,
): KnownRow[] {
  if (kind !== "ORG" || !value) return [];
  const out: string[] = [];
  FORM.lastIndex = 0;
  const bare = pyStrip(value.replace(FORM, ""));
  if (bare && bare !== value) out.push(bare);
  for (const m of value.matchAll(PAREN)) out.push(m[1]!);
  for (const m of value.matchAll(CAPS)) {
    const f = fold(m[0]);
    if (!PRESERVED_TERMS.has(f) && !common.has(f)) out.push(m[0]);
  }
  return out.map((x) => ["ORG", x] as const);
}

function admit([kind, value]: KnownRow): boolean {
  const toks = entityTokens(value ?? "");
  if (toks.length === 0) return false;
  if (toks.length === 1) {
    const t = toks[0]!;
    if (
      kind === "PERSON" ||
      [...t].length < 5 ||
      PRESERVED_TERMS.has(t) ||
      OPENER_WORDS.has(t)
    )
      return false;
  }
  return !PRESERVED_TERMS.has(toks.join(" "));
}

/** A build_known.main adatbazis nelkul: a sorok, az aliasaik, a szuro, majd az EXTRA. */
export function knownEntries(
  rows: readonly KnownRow[],
  common: ReadonlySet<string>,
): KnownRow[] {
  const all = [...rows, ...rows.flatMap((r) => aliases(r, common))];
  return [...all.filter(admit), ...KNOWN_EXTRA];
}
