/**
 * A FORRÁS ÚGY, HOGY A KOMMENTEK ÉS A SZTRING-TARTALMAK KI VANNAK FEHÉRÍTVE, de
 * a hossz és minden pozíció VÁLTOZATLAN.
 *
 * MIÉRT LÉTEZIK, és miért mérésből: a forrás-olvasó őrzők nyers szövegben
 * keresnek, tehát egy dokumentációs komment, ami leírja a hívás alakját,
 * pontosan úgy néz ki nekik, mint egy hívás. Mérve 2026-08-28 a webes forráson:
 * a `lib/auth/production-auth.ts` NULLA valódi hívást tartalmaz, mégis
 * megbuktatta az útvonal-őrzőt, mert egy doc-komment leírja, hogy
 * `apiRequest()`.
 *
 * MIÉRT MASZK ÉS NEM TÖRLÉS: a keresés a maszkon fut, a KIOLVASÁS az EREDETIN,
 * ugyanazon a pozíción. Törléssel minden későbbi eltolás elcsúszna, és az a
 * hiba NÉMA lenne: rossz szelet, nem hibaüzenet.
 *
 * MIÉRT A SZTRINGEK IS: egy hibaüzenet, ami leírja a hívás alakját, ugyanolyan
 * hamis találat, mint a komment. A sztringeket viszont CSAK a kereséshez
 * fehérítjük ki -- az útvonal maga is sztring, és azt az eredetiből olvassuk.
 *
 * A TEMPLATE `${...}` KIFEJEZÉSE KÓD MARAD, nem maszkolódik: ott állhat valódi
 * hívás, és egy elrejtett hívás a NEM-NÉZÉS irányába tévedne, ami a csendes
 * irány.
 *
 * ---
 *
 * MIÉRT EBBEN A MAPPÁBAN, ÉS MIÉRT NEM EGY SPEC-BEN:
 *
 * Két őrző használja (`mobile-api-routes.spec.ts` és
 * `mobile-screen-routes.spec.ts`), és 2026-08-28-ig KÉT MÁSOLATBAN állt, mert
 * mindkettő külön körben született, és a másikat épp nyitott PR írta. A két
 * másolat EGY NAP ALATT el is kezdett szétválni: az egyikben ott maradt egy
 * `templates` tömb, amit senki nem olvasott. Ez a fájl az egyesítésük.
 *
 * Egy spec-ből importálni rosszabb lett volna: a másik spec futtatásakor az
 * első tesztjei is lefutnának, és a következő ember nem értené, miért fut
 * ugyanaz kétszer.
 *
 * A MAPPA a `tsconfig.build.json` kizárásában MINTAKÉNT szerepel
 * (`src/testing/**`), nem fájlonkénti listaként -- így minden későbbi
 * teszt-segéd magától kimarad a futtatható képből. A kizárás azonban NEM
 * TILTÁS, csak alapértelmezés: egy produkciós fájl importja behúzná ide a
 * segédet. Ezt a `common/testing-folder-imports.spec.ts` tartja.
 */
/**
 * AZ A `/`, AMI REGEX-LITERÁLT NYIT, és hol ér véget (a jelzőkkel együtt).
 *
 * MÉRVE 2026-10-01: a regex-literált ez a maszk nem ismerte, és egy benne álló
 * `"` sztring-kezdetnek számított. A `lib/api/missing-invoices.ts` egy
 * `/filename=...([^...]+).../` alakú literáltól a fájl végéig kifehéredett, az
 * útvonal-őr NULLA hívást olvasott ki belőle, és egy elrontott útra zöld maradt.
 * A három forrásfán 37 fájl esett ki így a szinkronból.
 *
 * A DÖNTÉS SZŰK SZÁNDÉKOSAN. Egy tévesen regexnek vett osztás a két perjel közti
 * KÓDOT fehérítené ki, benne egy valódi hívással, és az a csendes irány. Ezért
 * csak ott nyit regexet, ahol osztás nem állhat: a fájl elején, egy nyitó
 * írásjel vagy operátor (`( , = : [ ! & | ? ; {`), a nyíl (`=>`), vagy egy
 * kifejezést váró kulcsszó (`return`, `typeof`, ...) után. `)`, `]`, `}` és
 * azonosító után osztás; ettől a JSX `</` és `/>` alakja magától kiesik. A `>`
 * csak a nyíl részeként nyit (a JSX-szöveg `>/` alakja nem). Ami a sor végéig nem zárul,
 * az nem regex (a literál nem léphet át sort), és osztásként megy tovább.
 */
const REGEX_AFTER = new Set([
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  ";",
  "{",
]);
const REGEX_AFTER_WORDS = new Set([
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "delete",
  "void",
  "throw",
  "new",
  "yield",
  "await",
  "else",
  "do",
  "instanceof",
]);

function regexLiteralEnd(source: string, at: number): number | null {
  const next = source[at + 1];
  if (next === "/" || next === "*") return null;
  let before = at - 1;
  while (before >= 0 && /\s/.test(source[before]!)) before -= 1;
  if (before >= 0) {
    const previous = source[before]!;
    if (previous === ">") {
      if (source[before - 1] !== "=") return null;
    } else if (/[\w$]/.test(previous)) {
      let start = before;
      while (start >= 0 && /[\w$]/.test(source[start]!)) start -= 1;
      if (!REGEX_AFTER_WORDS.has(source.slice(start + 1, before + 1)))
        return null;
    } else if (!REGEX_AFTER.has(previous)) return null;
  }
  let index = at + 1;
  let inClass = false;
  while (index < source.length) {
    const char = source[index]!;
    if (char === "\n") return null;
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
    } else if (char === "[") inClass = true;
    else if (char === "/") {
      index += 1;
      while (index < source.length && /[a-z]/i.test(source[index]!)) index += 1;
      return index;
    }
    index += 1;
  }
  return null;
}

export function maskCommentsAndStrings(source: string): string {
  const out = source.split("");
  const blank = (index: number): void => {
    if (out[index] !== "\n") out[index] = " ";
  };
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") blank(index++);
      continue;
    }
    if (char === "/" && next === "*") {
      blank(index++);
      blank(index++);
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      )
        blank(index++);
      if (index < source.length) {
        blank(index++);
        blank(index++);
      }
      continue;
    }
    if (char === "/") {
      const end = regexLiteralEnd(source, index);
      if (end !== null) {
        // a perjeleket megtartjuk, a törzset és a jelzőket kifehérítjük
        for (let at = index + 1; at < end; at += 1) blank(at);
        index = end;
        continue;
      }
    }
    if (char === '"' || char === "'") {
      index += 1;
      while (index < source.length && source[index] !== char) {
        // Egy `"` vagy `'` sztring NEM LÉPHET ÁT SORVÉGET (csak `\` előtaggal).
        // Ha mégis odaér, az nem sztring volt (JSX-szöveg egy magyar „...")
        // idézőjellel), és a kár a sorvégen megáll, nem a fájl végén.
        if (source[index] === "\n") break;
        if (source[index] === "\\") blank(index++);
        if (index < source.length) blank(index++);
      }
      if (source[index] === char) index += 1;
      continue;
    }
    if (char === "`") {
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          blank(index++);
          if (index < source.length) blank(index++);
          continue;
        }
        if (source[index] === "`") {
          index += 1;
          break;
        }
        // A `${` KÓD, tehát nem fehérítjük ki: ott állhat valódi hivatkozás, és
        // elrejteni a NEM-NÉZÉS irányába tévedés lenne, ami a csendes irány.
        if (source[index] === "$" && source[index + 1] === "{") {
          index += 2;
          let depth = 1;
          while (index < source.length && depth > 0) {
            if (source[index] === "{") depth += 1;
            else if (source[index] === "}") depth -= 1;
            index += 1;
          }
          continue;
        }
        blank(index++);
      }
      continue;
    }
    index += 1;
  }
  return out.join("");
}
