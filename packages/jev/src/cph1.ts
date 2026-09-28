/**
 * cph1 -- CANONICAL PROJECTION HASH v1.
 *
 * Szerzodes: KratoBal/acropora-os #1199, ACD-001 Q-001 (P-002) es az ACD-002
 * negy pontositasa. Balazs PD-002 ACCEPT-je, 2026-09-28 10:17 UTC.
 *
 *   domain vetulet  ->  cph1 normalizalas  ->  JCS (RFC 8785)  ->  UTF-8  ->  SHA-256
 *
 * A NORMALIZALAS ES A JCS KET KULON LEPES (ACD-002, 1. pont). A normalizalas az
 * Acropora sajat szabalya; a JCS csak a mar normalizalt, szukitett erteket
 * irja ki. Ezert a JCS itt nem teljes RFC 8785 megvalositas: szam csak biztos
 * egesz lehet, tehat az RFC 8785 lebegopontos kiirasi szabalya (ami a JS es a
 * Python kozott a legtobb elterest okozna) nem is fordulhat elo.
 *
 * AZ EGYETLEN, AMI MINDEZT BETARTATJA, A KOZOS VEKTORFAJL: `cph1-vectors.json`
 * a csomag gyokereben. Egy masik nyelvu megvalositas akkor helyes, ha a fajl
 * minden esetere ugyanazt adja.
 */
import { createHash } from "node:crypto";

/** Egy halmaz-szemantikaju tomb: hash elott dedupe + rendezes (ACD-002, 3. pont). */
export class Cph1Set {
  constructor(readonly items: readonly unknown[]) {}
}

/** Egy tort, penz vagy mertek: stringkent megy, kanonikus decimalis alakban. */
export class Cph1Decimal {
  constructor(readonly value: string) {}
}

export class Cph1Error extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "Cph1Error";
  }
}

/**
 * KULCS: CSAK [a-z0-9_]. Nem izles: a JCS a kulcsokat UTF-16 kodegyseg szerint
 * rendezi, a Python kodpont szerint, es a ketto csak nem-ASCII kulcsnal ter el.
 * A szukebb halmaz ezt kizarja, es a kis-nagybetu keveredesen sem kell
 * gondolkodni.
 */
const KULCS = /^[a-z0-9_]+$/;

/** ±(2^53 − 1): a JS biztos egesz tartomanya (ACD-002, 2. pont). */
const LEGNAGYOBB = Number.MAX_SAFE_INTEGER;

/**
 * A LEVAGANDO WHITESPACE HALMAZA, KIMONDVA. A JS `trim()` es a Python
 * `strip()` NEM ugyanazt a halmazt vagja (pl. az U+FEFF-et a JS vagja, a
 * Python nem). Ez az ECMAScript WhiteSpace + LineTerminator halmaza; egy masik
 * nyelvu megvalositasnak ezt kell vagnia, nem a sajat alapertelmezeset.
 */
const WS =
  "\\u0009\\u000A\\u000B\\u000C\\u000D\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF";
const ELEJE_VEGE = new RegExp(`^[${WS}]+|[${WS}]+$`, "g");

function szoveg(s: string): string {
  return s.normalize("NFC").replace(/\r\n?/g, "\n").replace(ELEJE_VEGE, "");
}

/**
 * KANONIKUS DECIMALIS: nincs exponens, nincs `+`, nincs felesleges vezeto vagy
 * zaro nulla, `-0` -> `0`. Csak tizedesponttal irt, exponens nelkuli bemenetet
 * fogad el: a vetito a `Decimal.toFixed()` kimenetet adja at, tehat az
 * exponens-feloldas nem a hash dolga.
 */
export function canonicalDecimal(input: string): string {
  const s = input.trim();
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m)
    throw new Cph1Error(
      "CPH1_BAD_DECIMAL",
      `Nem kanonizálható decimális érték: ${JSON.stringify(input)}`,
    );
  const egesz = (m[2] as string).replace(/^0+(?=\d)/, "");
  const tort = (m[3] ?? "").replace(/0+$/, "");
  const abszolut = tort ? `${egesz}.${tort}` : egesz;
  if (/^0(\.0*)?$/.test(abszolut)) return "0";
  return m[1] === "-" ? `-${abszolut}` : abszolut;
}

/**
 * A NORMALIZALT ERTEK: csak JSON-bol kifejezheto, szukitett tipusok. A
 * `undefined` erteku kulcs KIMARAD (a hiany mas, mint a `null`).
 */
export type Cph1Value =
  | null
  | boolean
  | number
  | string
  | readonly Cph1Value[]
  | { readonly [key: string]: Cph1Value };

export function normalizeCph1(value: unknown, path = "$"): Cph1Value {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return szoveg(value);
  if (typeof value === "number") {
    if (!Number.isInteger(value))
      throw new Cph1Error(
        "CPH1_FLOAT",
        `${path}: tört szám JSON-számként tilos, decimális stringként kell átadni.`,
      );
    if (Math.abs(value) > LEGNAGYOBB)
      throw new Cph1Error(
        "CPH1_UNSAFE_INTEGER",
        `${path}: az egész a ±(2^53 − 1) tartományon kívül esik.`,
      );
    return value === 0 ? 0 : value;
  }
  if (value instanceof Cph1Decimal) return canonicalDecimal(value.value);
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime()))
      throw new Cph1Error("CPH1_BAD_DATE", `${path}: érvénytelen időpont.`);
    return value.toISOString();
  }
  if (value instanceof Cph1Set) {
    const elemek = value.items.map((elem, i) =>
      normalizeCph1(elem, `${path}{${i}}`),
    );
    const kanonikus = new Map<string, Cph1Value>();
    for (const elem of elemek) kanonikus.set(jcs(elem), elem);
    return [...kanonikus.keys()]
      .sort(utf16)
      .map((kulcs) => kanonikus.get(kulcs) as Cph1Value);
  }
  if (Array.isArray(value))
    return value.map((elem, i) => normalizeCph1(elem, `${path}[${i}]`));
  if (typeof value === "object") {
    const ki: Record<string, Cph1Value> = {};
    for (const [kulcs, elem] of Object.entries(value as object)) {
      if (!KULCS.test(kulcs))
        throw new Cph1Error(
          "CPH1_BAD_KEY",
          `${path}: a kulcs csak [a-z0-9_] lehet: ${JSON.stringify(kulcs)}`,
        );
      if (elem === undefined) continue;
      ki[kulcs] = normalizeCph1(elem, `${path}.${kulcs}`);
    }
    return ki;
  }
  throw new Cph1Error(
    "CPH1_UNSUPPORTED",
    `${path}: nem támogatott érték (${typeof value}).`,
  );
}

/** UTF-16 kodegyseg szerinti osszehasonlitas -- ez a JCS rendezese. */
function utf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * JCS (RFC 8785) a mar normalizalt ertekre. A string kiirasa az ECMAScript
 * `JSON.stringify` szabalya, amit az RFC 8785 maga ir elo.
 */
export function jcs(value: Cph1Value): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  const obj = value as { readonly [key: string]: Cph1Value };
  return `{${Object.keys(obj)
    .sort(utf16)
    .map((k) => `${JSON.stringify(k)}:${jcs(obj[k] as Cph1Value)}`)
    .join(",")}}`;
}

/** A hash-elt objektum: a sema-azonosito a hash RESZE (P-002). */
export interface Cph1Projection {
  readonly schema: string;
  readonly data: unknown;
}

export function cph1Canonical(projection: Cph1Projection): string {
  return jcs(
    normalizeCph1({ schema: projection.schema, data: projection.data }),
  );
}

/** `cph1:sha256:<64 kisbetus hex>`. */
export function cph1(projection: Cph1Projection): string {
  const hex = createHash("sha256")
    .update(cph1Canonical(projection), "utf8")
    .digest("hex");
  return `cph1:sha256:${hex}`;
}
