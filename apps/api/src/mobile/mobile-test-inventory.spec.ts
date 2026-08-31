import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Minden MOBIL teszt le is fusson -- és ez az állítás azért áll az API
 * oldalán, nem a mobilban.
 *
 * MÉRVE 2026-08-27, és nem elméleti: amíg ez a spec a mobil forrásban élt, a
 * teszt-fordítás listáját le lehetett szűkíteni ÚGY, HOGY EZ A SPEC IS KIESETT
 * VELE -- és akkor nem pirosodott ki semmi. Kipróbáltam mind a két rontást (egy
 * szűkebb minta és egy visszaírt kézi lista), és MINDKETTŐ ZÖLD MARADT. Egy
 * őrző, ami abban a halmazban él, amit őriz, kizárható a halmazzal együtt.
 *
 * Ugyanaz a szerkezet, mint a `mobile-capability-mirror.spec.ts` esetében: az
 * a spec is azért ül itt, mert csak innen látszik mind a két oldal.
 *
 * ---
 *
 * Minden megírt teszt le is fusson.
 *
 * Ez az app nem a szokásos módon futtat: az Expo forráskódja nem fordul le
 * egyszerű `tsc`-vel (JSX, natív modulok), ezért a teszt-fordítás SAJÁT
 * `tsconfig.test.json` fájlon megy. Az a lista sokáig KÉZZEL karbantartott
 * volt, és egy új spec, amit valaki elfelejtett felvenni, nem hibázott: le sem
 * fordult, nem futott, a futtató pedig a maradék tesztek zöldjét jelentette.
 *
 * Pontosan ez történt: a mobil push-regisztráció hét tesztje egyetlen egyszer
 * sem futott le, és a "129 teszt zöld" sor ugyanúgy nézett ki, mint előtte.
 *
 * A LISTA 2026-08-27 ÓTA MINTA, nem felsorolás (`src/**\/*.spec.ts`). A kézi
 * karbantartás megszűnt, és vele az a mellékhatás is, ami egyetlen napon
 * KÉTSZER okozott ütközést két párhuzamos ág között: minden új teszt-terület
 * ugyanannak a fájlnak ugyanarra a részére adott egy sort.
 *
 * EZ A TESZT VISZONT MARAD, mert a kérdés nem szűnt meg, csak az alakja
 * változott: a minta is lehet SZŰKEBB, mint a valóság. Egy `src/lib/**` alakra
 * szűkítés holnap ugyanolyan némán ejtené ki a `src/config` specjeit, mint
 * amilyen némán a kézi lista felejtett.
 */

const TSCONFIG = "../mobile/tsconfig.test.json";
const MOBILE_SRC = "../mobile/src";

function specFiles(directory: string = MOBILE_SRC): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return specFiles(path);
    return path.endsWith(".spec.ts") ? [path] : [];
  });
}

/** A `include` minták, a fájl szövegéből. */
function includePatterns(): string[] {
  const raw = readFileSync(TSCONFIG, "utf8");
  const block = /"include"\s*:\s*\[([\s\S]*?)\]/.exec(raw);
  assert.ok(block, `Nem találtam az "include" listát a ${TSCONFIG} fájlban.`);
  return [...block![1]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

/** Egy `**`/`*` mintát reguláris kifejezéssé, a tsconfig szabályai szerint. */
function toRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, "(?:.*/)?");
  return new RegExp(`^${escaped}$`);
}

describe("teszt-leltár", () => {
  /**
   * A KONTROLL A KERESÉSRE. Ha a fájl szerkezete változik és a minta nem talál
   * bejegyzést, a többi állítás ÜRES halmazon menne végig, és zölden azt
   * mondaná, hogy minden rendben.
   */
  it("reads the include list it claims to read", () => {
    const patterns = includePatterns();

    assert.ok(
      patterns.length > 0,
      `Nem olvastam ki egyetlen mintát sem a ${TSCONFIG} fájlból. Ez a keresés hibája, nem a konfigurációé.`,
    );
    assert.ok(
      specFiles().length >= 20,
      "Nem találtam elég spec fájlt a forrásban: a bejárás romlott el, nem a projekt lett üres.",
    );
  });

  /**
   * A LÉNYEG, ÉS EZ FÜGGETLEN ATTÓL, HOGY LISTA VAGY MINTA ÁLL A FÁJLBAN: ami a
   * lemezen spec, azt a fordításnak látnia kell.
   */
  it("covers every spec file on disk", () => {
    const patterns = includePatterns().map(toRegExp);
    const missing = specFiles()
      .map((path) =>
        path.replaceAll("\\", "/").replace(`${MOBILE_SRC}/`, "src/"),
      )
      .filter((path) => !patterns.some((pattern) => pattern.test(path)));

    assert.deepEqual(
      missing,
      [],
      `Ezek a tesztek nem futnak, mert egyik ${TSCONFIG} minta sem fedi őket. Egy le nem futó teszt nem véd semmit, és a darabszámon nem látszik.`,
    );
  });

  /**
   * ÉS NE MENJÜNK VISSZA KÉZI LISTÁRA. Egy felsorolás megint elfelejthető, és a
   * felejtés némán történik -- ráadásul minden párhuzamos ág ugyanahhoz a
   * néhány sorhoz nyúlna, ami ütközést gyárt.
   */
  it("keeps the list a pattern, not a hand-written enumeration", () => {
    const listed = includePatterns().filter(
      (pattern) => !pattern.includes("*"),
    );

    assert.deepEqual(
      listed,
      [],
      "Kézzel felsorolt fájl került az include listába. Ami kimarad egy ilyen felsorolásból, az nem hibázik, hanem NEM FUT.",
    );
  });
});
