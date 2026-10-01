/**
 * A PYTHON `re` MINTAK FORDITASA JS `RegExp`-RE, A KITAKARO (redact.ts) SZAMARA.
 *
 * A referencia a marveen `scripts/jev/redact.py` (r11), ami `re.UNICODE`-dal fordit.
 * A ket motor sok jelet MASKENT ert, es a kulonbseg nema: egy rossz forditas nem
 * dob, hanem egy ekezetes nevet atenged. Ezert a kitakaro mintai SZO SZERINT a
 * Python-alakban allnak, es ez a fuggveny forditja oket, egy helyen:
 *
 *   Python (UNICODE)        JS (u)
 *   \w                      [\p{L}\p{N}_]            (Python: isalnum() vagy "_")
 *   \d                      \p{Nd}                   (Python: isdecimal())
 *   \s, \S                  a Python isspace() halmaza; a JS \s mas (U+FEFF benne,
 *                           U+001C..U+001F es U+0085 nincs)
 *   \b                      ugyanez a \w-vel, korulnezessel (a JS \b ASCII)
 *   [^\W\d_]                [\p{L}\p{Nl}\p{No}]      (betu: \w, de nem szamjegy, nem "_")
 *   [^\W_]                  [\p{L}\p{N}]
 *   $                       a szoveg vege VAGY egy zaro "\n" elott (Python, MULTILINE nelkul)
 *   (?P<v>...)              (?<v>...)
 *   (?i) a minta elejen     az "i" jelzo
 *
 * Amit nem ismer, arra DOB (forditaskor, nem futaskor): egy csendben rosszul
 * forditott minta rosszabb a hianyzonal.
 */

/** A Python `str.isspace()` halmaza, karakterosztaly belsejebe. */
const PY_SPACE =
  "\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const WORD = "\\p{L}\\p{N}_";
const LETTER = "[\\p{L}\\p{Nl}\\p{No}]";
const BOUNDARY = `(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))`;
const NON_BOUNDARY = `(?:(?<=[${WORD}])(?=[${WORD}])|(?<![${WORD}])(?![${WORD}]))`;

/** Az ismert, tagadott-tagadas alaku osztalyok: ezeket a JS u-mod nem tudja kozvetlenul. */
const IDIOMS: readonly (readonly [string, string])[] = [
  ["[\\s\\S]", "[^]"],
  ["[^\\W\\d_A-ZÁÉÍÓÖŐÚÜŰ]", `(?:(?![A-ZÁÉÍÓÖŐÚÜŰ])${LETTER})`],
  ["[^\\W\\d_a-záéíóöőúüű]", `(?:(?![a-záéíóöőúüű])${LETTER})`],
  ["[^\\W\\d_]", LETTER],
  ["[^\\W_]", "[\\p{L}\\p{N}]"],
];

/** A JS u-modban kiszokteto jelek; minden mas nem-alfanumerikus jel a sajat maga. */
const SYNTAX = new Set("^$\\.*+?()[]{}|/-".split(""));

export interface PyreOptions {
  /** Global, a `finditer`-hez. */
  readonly global?: boolean;
  /** Sticky, a `match(text, pos)`-hoz. */
  readonly sticky?: boolean;
}

export function pyreSource(pattern: string): { source: string; flags: string } {
  let flags = "u";
  let p = pattern;
  if (p.startsWith("(?i)")) {
    flags += "i";
    p = p.slice(4);
  }
  if (p.includes("(?i)"))
    throw new Error(`pyre: inline (?i) not at the start: ${pattern}`);
  IDIOMS.forEach(([py], i) => {
    p = p.split(py).join(`\u0000${i}\u0000`);
  });
  let out = "";
  let inClass = false;
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === "\u0000") {
      const end = p.indexOf("\u0000", i + 1);
      const idiom = IDIOMS[Number(p.slice(i + 1, end))]!;
      if (inClass) throw new Error(`pyre: idiom inside a class: ${pattern}`);
      out += idiom[1];
      i = end;
      continue;
    }
    if (c === "\\") {
      const n = p[i + 1];
      if (n === undefined)
        throw new Error(`pyre: trailing backslash: ${pattern}`);
      i++;
      if (inClass) {
        if (n === "w") out += WORD;
        else if (n === "d") out += "\\p{Nd}";
        else if (n === "s") out += PY_SPACE;
        else if (n === "W" || n === "D" || n === "S" || n === "b" || n === "B")
          throw new Error(`pyre: \\${n} inside a class: ${pattern}`);
        else out += escapeOther(n, p, i, pattern);
      } else {
        if (n === "w") out += `[${WORD}]`;
        else if (n === "W") out += `[^${WORD}]`;
        else if (n === "d") out += "\\p{Nd}";
        else if (n === "D") out += "\\P{Nd}";
        else if (n === "s") out += `[${PY_SPACE}]`;
        else if (n === "S") out += `[^${PY_SPACE}]`;
        else if (n === "b") out += BOUNDARY;
        else if (n === "B") out += NON_BOUNDARY;
        else if (n === "A" || n === "Z" || n === "z" || n === "G")
          throw new Error(`pyre: \\${n} is not supported: ${pattern}`);
        else out += escapeOther(n, p, i, pattern);
      }
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      out += c;
      continue;
    }
    if (c === "[") {
      inClass = true;
      out += c;
      if (p[i + 1] === "^") {
        out += "^";
        i++;
      }
      if (p[i + 1] === "]")
        throw new Error(`pyre: "]" first in a class: ${pattern}`);
      continue;
    }
    if (c === "(" && p.startsWith("(?P<", i)) {
      out += "(?<";
      i += 3;
      continue;
    }
    if (c === "(" && p.startsWith("(?P=", i))
      throw new Error(`pyre: (?P=...) is not supported: ${pattern}`);
    if (c === "$") {
      out += "(?=\\n?$)";
      continue;
    }
    out += c;
  }
  if (inClass) throw new Error(`pyre: unclosed class: ${pattern}`);
  return { source: out, flags };
}

function escapeOther(n: string, p: string, i: number, pattern: string): string {
  if (/[0-9]/.test(n))
    throw new Error(`pyre: backreference or octal \\${n}: ${pattern}`);
  if (n === "u" || n === "x") {
    const len = n === "u" ? 4 : 2;
    const hex = p.slice(i + 1, i + 1 + len);
    if (!new RegExp(`^[0-9a-fA-F]{${len}}$`).test(hex))
      throw new Error(`pyre: bad \\${n}: ${pattern}`);
    return `\\${n}`;
  }
  if (/[a-zA-Z]/.test(n)) {
    if ("tnrfv".includes(n)) return `\\${n}`;
    throw new Error(`pyre: unknown escape \\${n}: ${pattern}`);
  }
  return SYNTAX.has(n) ? `\\${n}` : n;
}

export function pyre(pattern: string, options: PyreOptions = {}): RegExp {
  const { source, flags } = pyreSource(pattern);
  return new RegExp(
    source,
    flags + "d" + (options.global ? "g" : "") + (options.sticky ? "y" : ""),
  );
}
