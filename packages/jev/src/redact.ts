/**
 * AZ R11 KITAKARO, TYPESCRIPTBEN.
 *
 * === A REFERENCIA A PYTHON ===
 *
 * A marveen `scripts/jev/redact.py` (r11) a referencia: azzal mertuk a DEV-et es a
 * HOLDOUT-ot (Balazs: PD-006 szukitese, 2026-10-01 04:38 UTC; a HOLDOUT kapuja
 * 0,9-en atment). Elesben az fusson, amit mertunk, ezert:
 *
 *   - minden minta es szolista a Pythonbol GENERALT (`redact-r11-data.ts`, a
 *     `scripts/redact-r11-export.py` irja ki), kezzel masolt minta nincs;
 *   - a mintakat a `pyre` forditja, mert a Python `\w`, `\d`, `\b`, `\s` es `$`
 *     mast jelent, mint a JS-e;
 *   - csak a PROGRAM-LOGIKA van kezzel atirva (ez a fajl), es a tesztek a Python
 *     kimenetevel vetik ossze (`redact-vectors/r11-expected.json`).
 *
 * BARMELYIK OLDAL VALTOZASA = AZ EXPORT ES A PARITAS-FUTAS UJRA (README, "Kitakaras").
 *
 * === AMI A PYTHONTOL ELTER, ES MIERT NEM SZAMIT ===
 *
 *   - Az eltolasok UTF-16 egysegben vannak, a Pythonban kodpontban. A kimenet
 *     ugyanabbol a stringbol, ugyanazokkal az eltolasokkal epul, tehat csak a
 *     rogzitett ablakok (30, 24 karakter) merete ter el, ha az ablakban BMP-n
 *     kivuli karakter (emoji) all.
 *   - A `known` tabla nem kulcsolt lenyomat (`hashed-v1`), hanem a normalizalt
 *     kulcs maga: a tabla a folyamat memoriajaban el, adatbazisbol epul, es
 *     lemezre nem kerul. A kereses ugyanaz az egyenloseg.
 */
import { pyre } from "./pyre.js";
import {
  ALWAYS_MASKED,
  AMBIGUOUS,
  COMMON_I,
  DOUBLED,
  GIVEN_NAMES,
  HOMOGLYPHS,
  INLINE,
  KEEPABLE,
  KNOWN_ALLOWABLE,
  LABELS,
  MERGE_RANK,
  NAME_CUES,
  NAME_KINDS_IN_COMPANY,
  OPENERS,
  OTHER,
  PATTERNS,
  PRESERVE,
  REDACTION_VERSION,
  SUFFIXES,
  SUFFIXES_F,
} from "./redact-r11-data.js";

export { REDACTION_VERSION };

export class RedactionError extends Error {}

export type Span = readonly [start: number, end: number, kind: string];

/** A known-entity tabla: normalizalt kulcs -> fajta, es a leghosszabb kulcs tokenszama. */
export interface KnownTable {
  readonly table: ReadonlyMap<string, string>;
  readonly maxTokens: number;
}

export interface RedactResult {
  readonly text: string;
  readonly version: string;
  readonly counts: Readonly<Record<string, number>>;
}

// ------------------------------------------------------------ Python helpers
const PY_SPACE_CLASS =
  "\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_SPACE_RUN = new RegExp(`[${PY_SPACE_CLASS}]+`, "gu");
const PY_SPACE_ONE = new RegExp(`^[${PY_SPACE_CLASS}]$`, "u");
const PY_STRIP = new RegExp(
  `^[${PY_SPACE_CLASS}]+|[${PY_SPACE_CLASS}]+$`,
  "gu",
);

/** Python `str.isspace()` egy karakterre. */
function isSpace(ch: string): boolean {
  return PY_SPACE_ONE.test(ch);
}

/** Python `str.split()`: szokozfutasokra, ures elemek nelkul. */
function pySplit(s: string): string[] {
  return s.split(PY_SPACE_RUN).filter((x) => x !== "");
}

/** Python `str.strip()`. */
export function pyStrip(s: string): string {
  return s.replace(PY_STRIP, "");
}

const LOWERCASE = /\p{Lowercase}/u;
/** Python `str.islower()` egy karakterre. */
function isLower(ch: string): boolean {
  return LOWERCASE.test(ch);
}

/** A kanonikus kombinalo osztaly 1-es jelei: ezeket a lenti proba nem latja. */
const CCC_ONE = new Set(
  [
    [0x334, 0x338],
    [0x1cd4, 0x1cd4],
    [0x1ce2, 0x1ce8],
    [0x20d2, 0x20d3],
    [0x20d8, 0x20da],
    [0x20e5, 0x20e6],
    [0x20ea, 0x20eb],
    [0x10a39, 0x10a39],
    [0x16af0, 0x16af4],
    [0x1bc9e, 0x1bc9e],
    [0x1d167, 0x1d169],
  ].flatMap(([a, b]) =>
    Array.from({ length: b! - a! + 1 }, (_, i) => String.fromCodePoint(a! + i)),
  ),
);
const MARK = /\p{M}/u;
const combiningCache = new Map<string, boolean>();
/**
 * Python `unicodedata.combining(c) != 0`. A JS-nek nincs ilyen API-ja: a nem
 * nulla osztalyu jel a kanonikus rendezesben atlep egy 1-es osztalyu jelen
 * (U+0334), a nulla osztalyu nem.
 */
function isCombining(ch: string): boolean {
  if (!MARK.test(ch)) return false;
  let r = combiningCache.get(ch);
  if (r === undefined) {
    r = CCC_ONE.has(ch) || (ch + "\u0334").normalize("NFD") !== ch + "\u0334";
    combiningCache.set(ch, r);
  }
  return r;
}

/** Python `str.casefold()`, a mi szovegeinkre: a teljes kisbetusites, plusz amiben elter. */
const CASEFOLD_EXTRA: Readonly<Record<string, string>> = {
  ß: "ss",
  ẞ: "ss",
  ς: "σ",
  ſ: "s",
  ϐ: "β",
  ϑ: "θ",
  ϕ: "φ",
  ϖ: "π",
  ϰ: "κ",
  ϱ: "ρ",
  ϵ: "ε",
  ẛ: "ṡ",
  ﬅ: "st",
  ﬆ: "st",
};
function casefold(s: string): string {
  let out = "";
  for (const ch of s) {
    const lower = ch.toLowerCase();
    out += CASEFOLD_EXTRA[ch] ?? CASEFOLD_EXTRA[lower] ?? lower;
  }
  return out;
}

/** casefold + ekezet le + homoglifak; csak egyeztetesre (Python `fold`). */
export function fold(s: string): string {
  let t = "";
  for (const ch of s.normalize("NFKC")) t += HOMOGLYPHS[ch] ?? ch;
  t = t.normalize("NFKD");
  let u = "";
  for (const ch of t) if (!isCombining(ch)) u += ch;
  return casefold(pyStrip(u.replace(PY_SPACE_RUN, " ")));
}

// ------------------------------------------------------------ data
const SET = (xs: readonly string[]) => new Set(xs);
const GIVEN = SET(GIVEN_NAMES);
const PRESERVED = SET(PRESERVE);
/** A megorzendo kifejezesek (normalizalva): a known-entity epito is ezt nezi. */
export const PRESERVED_TERMS: ReadonlySet<string> = PRESERVED;
const CUES = SET(NAME_CUES);
const LABEL = SET(LABELS);
const COMMON_I_SET = SET(COMMON_I);
const AMBIG = SET(AMBIGUOUS);
const OPENER = SET(OPENERS);
/** A mondatnyito szavak (normalizalva): a known-entity epito is ezt nezi. */
export const OPENER_WORDS: ReadonlySet<string> = OPENER;
const ALWAYS = SET(ALWAYS_MASKED);
const KEEPABLE_SET = SET(KEEPABLE);
const ALLOWABLE = SET(KNOWN_ALLOWABLE);
const IN_COMPANY = SET(NAME_KINDS_IN_COMPANY);
const RANK = new Map(MERGE_RANK.map((k, i) => [k, i]));
const rank = (k: string) => RANK.get(k) ?? 99;

const P = PATTERNS.map(([kind, src]) => ({
  kind,
  rx: pyre(src, { global: true }),
  hasV: src.includes("(?P<v>"),
}));
const RX = {
  singleCap: pyre(INLINE.singleCap, { global: true }),
  afterWord: pyre(INLINE.afterWord, { sticky: true }),
  identifier: pyre(INLINE.identifier, { global: true }),
  letters: pyre(INLINE.letters, { global: true }),
  social: pyre(INLINE.social),
  lowerName: pyre(INLINE.lowerName, { global: true }),
  nonSpace: pyre(INLINE.nonSpace, { global: true }),
  alnum: pyre(INLINE.alnum, { global: true }),
  halfPlaceholder: pyre(INLINE.halfPlaceholder),
  formInHit: pyre(OTHER.formInHit),
  formAfterHit: pyre(OTHER.formAfterHit, { sticky: true }),
  soleTrader: pyre(OTHER.soleTrader),
  companyFormEnd: pyre(OTHER.companyFormEnd),
  token: pyre(OTHER.token, { global: true }),
  council: pyre(OTHER.council, { global: true }),
};

function* finditer(rx: RegExp, text: string): Generator<RegExpExecArray> {
  rx.lastIndex = 0;
  for (const m of text.matchAll(rx)) yield m as RegExpExecArray;
}

function matchAt(
  rx: RegExp,
  text: string,
  pos: number,
): RegExpExecArray | null {
  rx.lastIndex = pos;
  return rx.exec(text);
}

const findall = (rx: RegExp, text: string) =>
  [...finditer(rx, text)].map((m) => m[0]);

// ------------------------------------------------------------ the redactor
export interface RedactorOptions {
  /** A koznapi szavak (`jev-common-words.txt`); ures halmaz = a Python, fajl nelkul. */
  readonly commonWords: ReadonlySet<string>;
  /** A known-entity tabla; `null` = nincs (az A reteg kimarad, a B fut). */
  readonly known: KnownTable | null;
  /**
   * A feladat sajat szavai, amik itt megorzott szonak szamitanak, mint a
   * Python `redact.preserving(terms)` blokkjaban (a level-besorolo "Invoice",
   * "Proforma" szavai). A mindig kitakart fajtakat (e-mail, telefon, IBAN,
   * adoszam) minta fogja, nem szo, tehat ez sosem fedi fel oket; az or nem olvassa.
   */
  readonly preserve?: Iterable<string>;
}

export class Redactor {
  private readonly common: ReadonlySet<string>;
  private readonly known: KnownTable | null;
  private readonly preserved: ReadonlySet<string>;
  private readonly preserveMulti: readonly RegExp[];

  constructor(options: RedactorOptions) {
    this.common = options.commonWords;
    this.known = options.known;
    const extra = [...(options.preserve ?? [])].map(fold);
    this.preserved = extra.length
      ? new Set([...PRESERVED, ...extra])
      : PRESERVED;
    this.preserveMulti = extra.length
      ? multiWordPatterns(this.preserved)
      : PRESERVE_MULTI;
  }

  /**
   * {text, version, counts}. Barmilyen belso hiba `RedactionError`: a hivo
   * ilyenkor eldobja a tetelt, es soha nem esik vissza a nyers szovegre.
   */
  redact(
    input: string,
    options: { keepKinds?: Iterable<string>; keepDates?: boolean } = {},
  ): RedactResult {
    if (typeof input !== "string")
      throw new RedactionError("input is not text");
    const keepKinds = new Set(options.keepKinds ?? []);
    for (const k of keepKinds)
      if (!KEEPABLE_SET.has(k))
        throw new RedactionError("keep_kinds outside the keepable set");
    try {
      const text = input.normalize("NFC");
      let spans = this.findSpans(text);
      const keep = preservedRanges(text, this.preserveMulti);
      if (keep.length)
        spans = spans.filter(
          (sp) =>
            !["PERSON", "PROPER", "ID"].includes(sp[2]) ||
            !keep.some(([s, e]) => sp[0] < e && s < sp[1]),
        );
      if (options.keepDates) spans = spans.filter((s) => s[2] !== "DATE");
      if (keepKinds.has("ORG")) {
        const companies = spans
          .filter(
            ([s, e, k]) =>
              k === "ORG" && RX.companyFormEnd.test(text.slice(s, e)),
          )
          .map(([s, e]) => [s, e] as const);
        spans = spans.filter(
          (sp) =>
            !(
              IN_COMPANY.has(sp[2]) &&
              companies.some(([cs, ce]) => cs <= sp[0] && sp[1] <= ce)
            ),
        );
      }
      if (keepKinds.size) spans = spans.filter((s) => !keepKinds.has(s[2]));
      const merged = merge(spans);
      const mapping = new Map<string, string>();
      const counts: Record<string, number> = {};
      const out: string[] = [];
      let pos = 0;
      for (const [s, e, kind] of merged) {
        out.push(text.slice(pos, s));
        if (kind === "URL_QUERY") {
          out.push("");
          counts[kind] = (counts[kind] ?? 0) + 1;
        } else {
          const f = fold(text.slice(s, e));
          const key = `${kind}\u0000${kind === "PERSON" || kind === "PROPER" ? stripSuffix(f) : f}`;
          if (!mapping.has(key)) {
            counts[kind] = (counts[kind] ?? 0) + 1;
            mapping.set(key, `<${kind}_${counts[kind]}>`);
          }
          out.push(mapping.get(key)!);
        }
        pos = e;
      }
      out.push(text.slice(pos));
      return { text: out.join(""), version: REDACTION_VERSION, counts };
    } catch (error) {
      if (error instanceof RedactionError) throw error;
      throw new RedactionError(
        `redaction failed: ${error instanceof Error ? error.constructor.name : "unknown"}`,
      );
    }
  }

  /**
   * Az utolso halo a hivas elott (ACD-011 4. pont). Problema-fajtak listaja; ures
   * = mehet. Lasd a Python `runtime_guard` leirasat.
   */
  runtimeGuard(
    redacted: { readonly text: unknown; readonly version: unknown },
    options: { allowKnownKinds?: Iterable<string> } = {},
  ): string[] {
    const allow = new Set(options.allowKnownKinds ?? []);
    for (const k of allow) if (!ALLOWABLE.has(k)) return ["allow_known_kinds"];
    if (redacted.version !== REDACTION_VERSION) return ["version"];
    const t = redacted.text;
    if (typeof t !== "string") return ["text"];
    const problems = new Set<string>();
    for (const { kind, rx } of P)
      if (ALWAYS.has(kind) || kind === "EMAIL" || kind === "PHONE") {
        rx.lastIndex = 0;
        if (rx.test(t)) problems.add(kind);
        rx.lastIndex = 0;
      }
    if (this.known) {
      const spans = knownSpans(t, this.known);
      const formed = (s: number, e: number) =>
        RX.formInHit.test(t.slice(s, e)) ||
        matchAt(RX.formAfterHit, t, e) !== null;
      for (const [s, e, kind] of spans) {
        // r12 (acrobot 25567): a bare ORG hit passes when it is the start of a
        // longer allowed ORG hit that reaches a legal form ("HANNA" inside
        // "HANNA Instruments Service Kft."); the longer hit is checked itself too
        const inside = spans.some(
          ([s2, e2, k2]) =>
            allow.has(k2) && s2 === s && e2 > e && formed(s2, e2),
        );
        const allowed =
          allow.has(kind) &&
          (formed(s, e) || inside) &&
          !RX.soleTrader.test(t.slice(s, e + 24));
        if (!allowed) {
          problems.add("KNOWN_ENTITY");
          break;
        }
      }
    }
    return [...problems].sort();
  }

  private isCommonMiss(w: string): boolean {
    return !this.common.has(w) && !this.common.has(stem(w));
  }

  private findSpans(text: string): Span[] {
    const spans: Span[] = [];
    const common = this.common.size > 0;
    if (this.known) spans.push(...knownSpans(text, this.known));
    for (const { kind, rx, hasV } of P) {
      for (const m of finditer(rx, text)) {
        let s: number;
        let e: number;
        if (hasV) {
          const v = m.indices?.groups?.v;
          if (!v) continue;
          [s, e] = v;
        } else {
          s = m.index;
          e = m.index + m[0].length;
        }
        if (e <= s) continue;
        if (kind === "DOMAIN") {
          const host = fold(text.slice(s, e));
          if (
            host.endsWith("acropora.hu") ||
            this.preserved.has(host.split(".")[0]!) ||
            [
              "github.com",
              "discord.com",
              "typesafe.ai",
              "api.typesafe.ai",
            ].includes(host)
          )
            continue;
          spans.push([s, e, "DOMAIN"]);
          continue;
        }
        if (kind === "CAPS") {
          const words = pySplit(text.slice(s, e)).map(fold);
          if (
            words.some(isName) ||
            (common &&
              words.some(
                (w) =>
                  this.isCommonMiss(w) &&
                  !this.preserved.has(w) &&
                  !LABEL.has(w),
              ))
          )
            spans.push([s, e, "PERSON"]);
          continue;
        }
        if (
          kind === "HANDLE" &&
          isPreserved(lstripAt(text.slice(s, e)).split("@")[0]!, this.preserved)
        )
          continue;
        if (kind === "PERSON") {
          const span = personSpan(text, s, e, this.preserved);
          if (span) spans.push([span[0], span[1], kind]);
          continue;
        }
        spans.push([s, e, kind]);
      }
    }
    // single capitalised words (the Python comment explains the rule)
    const properStems = new Set<string>();
    const initial: RegExpExecArray[] = [];
    for (const m of finditer(RX.singleCap, text)) {
      const w = m[0];
      if (isPreserved(w, this.preserved)) continue;
      const base = fold(w);
      if (![...w].some(isLower)) {
        if (cpLen(base) >= 3 && isName(base))
          spans.push([m.index, m.index + w.length, "PERSON"]);
        else if (
          cpLen(base) >= 6 &&
          common &&
          this.isCommonMiss(base) &&
          !LABEL.has(base)
        )
          spans.push([m.index, m.index + w.length, "PROPER"]);
        continue;
      }
      if (isName(base)) spans.push([m.index, m.index + w.length, "PERSON"]);
      else if (!sentenceInitial(text, m.index)) {
        if (!OPENER.has(base)) {
          spans.push([m.index, m.index + w.length, "PROPER"]);
          properStems.add(stem(base));
        }
      } else if (!OPENER.has(base)) initial.push(m);
    }
    const starts = new Set(
      spans
        .filter((sp) => sp[2] === "PERSON" || sp[2] === "PROPER")
        .map((sp) => sp[0]),
    );
    for (const m of initial) {
      const w = m[0];
      const base = fold(w);
      const end = m.index + w.length;
      const nxt = text.slice(end, end + 1);
      const after = matchAt(RX.afterWord, text, end);
      if (
        after &&
        isName(base) === false &&
        starts.has(after.indices![1]![0]) &&
        !isPreserved(w, this.preserved)
      ) {
        spans.push([m.index, end, "PROPER"]);
        continue;
      }
      if (
        common &&
        this.isCommonMiss(base) &&
        !LABEL.has(base) &&
        !COMMON_I_SET.has(base)
      ) {
        spans.push([m.index, end, "PROPER"]);
        continue;
      }
      if (
        ((nxt === "," || nxt === ":") && !LABEL.has(base)) ||
        properStems.has(stem(base)) ||
        (cpLen(base) >= 5 &&
          "iy".includes(lastCp(base)) &&
          !COMMON_I_SET.has(base))
      )
        spans.push([m.index, end, "PROPER"]);
    }
    // names inside identifiers: Kovacs_Peter_szamla.pdf, hegedus.bodnar
    for (const m of finditer(RX.identifier, text)) {
      const parts = [...finditer(RX.letters, m[0])];
      if (
        parts.some((p) => isName(fold(p[0]))) ||
        (m[0].includes(".") &&
          RX.social.test(text.slice(Math.max(0, m.index - 30), m.index)))
      )
        for (const p of parts)
          if (
            !isPreserved(p[0], this.preserved) &&
            ![
              "pdf",
              "jpg",
              "png",
              "docx",
              "xlsx",
              "txt",
              "com",
              "hu",
              "www",
            ].includes(fold(p[0]))
          )
            spans.push([
              m.index + p.index,
              m.index + p.index + p[0].length,
              "PERSON",
            ]);
    }
    // lowercase names from the list (chat style), except everyday words
    for (const m of finditer(RX.lowerName, text)) {
      const base = fold(m[0]);
      if (OPENER.has(base)) continue;
      const end = m.index + m[0].length;
      if (AMBIG.has(base) || AMBIG.has(stem(base))) {
        const before = findall(
          RX.letters,
          text.slice(Math.max(0, m.index - 30), m.index),
        );
        const nb = [
          ...findall(RX.letters, text.slice(end, end + 30)).slice(0, 1),
          ...before.slice(-1),
        ];
        const prev = before.slice(-1);
        if (
          nb.some((x) => isName(fold(x)) && !AMBIG.has(fold(x))) ||
          prev.some((x) => CUES.has(fold(x)))
        )
          spans.push([m.index, end, "PERSON"]);
        continue;
      }
      if (isName(base)) spans.push([m.index, end, "PERSON"]);
    }
    return spans;
  }
}

// ------------------------------------------------------------ module functions
const cpLen = (s: string) => [...s].length;
const lastCp = (s: string) => {
  const cps = [...s];
  return cps[cps.length - 1] ?? "";
};
const lstripAt = (s: string) => s.replace(/^@+/, "");

function isName(base: string): boolean {
  if (GIVEN.has(base) || GIVEN.has(stripSuffix(base))) return true;
  for (const b of [base, stem(base)])
    for (const dim of ["ka", "ke", "ika", "ike", "cska", "cske"])
      if (b.endsWith(dim)) {
        const root = b.slice(0, b.length - dim.length);
        if (GIVEN.has(root) || GIVEN.has(root + "i")) return true;
      }
  return false;
}

const FOLDED_SUFFIXES = SUFFIXES.map((s) => fold(s));

export function stem(base: string): string {
  for (const f of FOLDED_SUFFIXES)
    if (base.endsWith(f) && cpLen(base) - cpLen(f) >= 3)
      return base.slice(0, base.length - f.length);
  return base;
}

export function stripSuffix(w: string, depth = 0): string {
  const n = cpLen(w);
  if (n >= 6 && (w.endsWith("al") || w.endsWith("el"))) {
    const st = w.slice(0, -2);
    for (const [dbl, one] of DOUBLED)
      if (st.endsWith(dbl)) {
        const cand = st.slice(0, st.length - dbl.length) + one;
        if (GIVEN.has(cand)) return cand;
      }
    const cps = [...st];
    if (
      cps[cps.length - 1] === cps[cps.length - 2] &&
      GIVEN.has(cps.slice(0, -1).join(""))
    )
      return cps.slice(0, -1).join("");
  }
  if (depth === 0)
    for (const fam of [
      "ekhez",
      "ekhoz",
      "ektol",
      "ekkel",
      "ekkal",
      "eknel",
      "eknek",
      "ekre",
      "ekrol",
      "ekbol",
      "ekben",
      "ekig",
      "eket",
      "eke",
      "ek",
    ])
      if (w.endsWith(fam) && n - fam.length >= 3) {
        const cand = w.slice(0, w.length - fam.length);
        if (GIVEN.has(cand)) return cand;
      }
  for (const s of FOLDED_SUFFIXES)
    if (w.endsWith(s) && n - cpLen(s) >= 3) {
      const cand = w.slice(0, w.length - s.length);
      if (GIVEN.has(cand)) return cand;
      if (GIVEN.has(cand + "a")) return cand + "a";
      if (GIVEN.has(cand + "e")) return cand + "e";
    }
  return w;
}

function isPreserved(
  spanText: string,
  preserved: ReadonlySet<string>,
): boolean {
  const f = fold(spanText);
  if (preserved.has(f)) return true;
  const words = pySplit(f);
  return words.length > 0 && words.every((w) => preserved.has(w));
}

function sentenceInitial(text: string, start: number): boolean {
  let j = start - 1;
  while (j >= 0 && " \t\"'„(“".includes(text[j]!)) j--;
  return j < 0 || ".!?:\n•-*>".includes(text[j]!);
}

const HON = new Set([
  "dr",
  "Dr",
  "ifj",
  "id",
  "özv",
  "prof",
  "Prof",
  "Mr",
  "Mrs",
  "Ms",
]);

function personSpan(
  text: string,
  s: number,
  e: number,
  preserved: ReadonlySet<string>,
): readonly [number, number] | null {
  const frag = text.slice(s, e);
  const first = [...frag][0] ?? "";
  if (
    (first !== "" && isLower(first)) ||
    HON.has((pySplit(frag)[0] ?? "").replace(/\.+$/, ""))
  )
    return [s, e];
  const words = [...finditer(RX.nonSpace, frag)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    w: m[0],
  }));
  while (words.length && OPENER.has(fold(words[0]!.w))) words.shift();
  while (words.length && isPreserved(words[0]!.w, preserved)) words.shift();
  while (words.length && isPreserved(words[words.length - 1]!.w, preserved))
    words.pop();
  if (words.length <= 1) return null;
  return [s + words[0]!.start, s + words[words.length - 1]!.end];
}

/** A folded szoveg, es minden folded UTF-16 egysegrol az eredeti karakter [kezdet, veg]-e. */
function foldedIndex(text: string): {
  folded: string;
  from: number[];
  to: number[];
} {
  let folded = "";
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = isSpace(ch) ? " " : fold(ch);
    for (let k = 0; k < f.length; k++) {
      from.push(i);
      to.push(i + ch.length);
    }
    folded += f;
    i += ch.length;
  }
  return { folded, from, to };
}

const escapeRx = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
const multiWordPatterns = (terms: Iterable<string>): RegExp[] =>
  [...terms]
    .filter((t) => t.includes(" "))
    .map(
      (t) =>
        new RegExp(`(?<![\\p{L}\\p{N}])${escapeRx(t)}(?![\\p{L}\\p{N}])`, "gu"),
    );
const PRESERVE_MULTI = multiWordPatterns(PRESERVE);

function preservedRanges(
  text: string,
  multi: readonly RegExp[],
): (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [
    ...finditer(RX.council, text),
  ].map((m) => [m.index, m.index + m[0].length] as const);
  if (multi.length === 0) return out;
  const { folded, from, to } = foldedIndex(text);
  for (const rx of multi)
    for (const m of finditer(rx, folded))
      out.push([from[m.index]!, to[m.index + m[0].length - 1]!]);
  return out;
}

function merge(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort(
    (a, b) =>
      a[0] - b[0] || b[1] - b[0] - (a[1] - a[0]) || rank(a[2]) - rank(b[2]),
  );
  const out: Span[] = [];
  for (const [s, e, k] of sorted) {
    const last = out[out.length - 1];
    if (last && s < last[1]) {
      if (e > last[1])
        out[out.length - 1] = [
          last[0],
          e,
          rank(last[2]) <= rank(k) ? last[2] : k,
        ];
      continue;
    }
    out.push([s, e, k]);
  }
  return out;
}

// ------------------------------------------------------------ known entities
export function entityTokens(value: string): string[] {
  return findall(RX.token, value.normalize("NFC")).map(fold);
}

const knownKey = (tokens: readonly string[]) => tokens.join(" ");

/**
 * A tabla a (fajta, ertek) sorokbol, ugyanazzal a normalizalassal, mint a Python
 * `write_known_file`: a fajta nagybetus, a leghosszabb kulcs legfeljebb 6 token.
 * Ket azonos kulcsnal a kesobbi fajta nyer (a Python dict-je is igy).
 */
export function knownTable(
  entries: Iterable<readonly [string, string]>,
): KnownTable {
  const table = new Map<string, string>();
  let maxLen = 1;
  for (const [kind, value] of entries) {
    const toks = entityTokens(value);
    if (toks.length === 0) continue;
    table.set(knownKey(toks), kind.toUpperCase());
    maxLen = Math.max(maxLen, toks.length);
  }
  return { table, maxTokens: Math.min(maxLen, 6) };
}

export function knownSpans(text: string, known: KnownTable): Span[] {
  const toks: [number, number, string][] = [...finditer(RX.token, text)].map(
    (m) => [m.index, m.index + m[0].length, fold(m[0])],
  );
  for (const m of finditer(RX.alnum, text)) {
    const end = m.index + m[0].length;
    if (text.slice(Math.max(0, m.index - 1), end + 1).includes("."))
      toks.push([m.index, end, fold(m[0])]);
  }
  toks.sort(
    (a, b) =>
      a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0),
  );
  const out: Span[] = [];
  for (let i = 0; i < toks.length; i++)
    for (let n = 1; n <= known.maxTokens; n++) {
      if (i + n > toks.length) break;
      const words = toks.slice(i, i + n).map((t) => t[2]);
      const last = words[words.length - 1]!;
      const variants = [last];
      for (const suf of SUFFIXES_F)
        if (last.endsWith(suf) && cpLen(last) - cpLen(suf) >= 2)
          variants.push(last.slice(0, last.length - suf.length));
      const lc = [...last];
      if (
        lc.length >= 6 &&
        ["al", "el"].includes(lc.slice(-2).join("")) &&
        lc[lc.length - 3] === lc[lc.length - 4]
      )
        variants.push(lc.slice(0, -3).join(""));
      for (const v of new Set(variants)) {
        const kind = known.table.get(knownKey([...words.slice(0, -1), v]));
        if (kind) {
          out.push([toks[i]![0], toks[i + n - 1]![1], kind]);
          break;
        }
      }
    }
  return out;
}

/** A Python `re.sub(r"<[A-Z_]*\d*$", "", cut)`: soha ne menjen ki fel helyorzo. */
export function dropHalfPlaceholder(cut: string): string {
  const m = RX.halfPlaceholder.exec(cut);
  return m ? cut.slice(0, m.index) + cut.slice(m.index + m[0].length) : cut;
}
