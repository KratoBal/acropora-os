import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A PDF BETŰKÉSZLETE, ÉS MIÉRT NEM A RENDSZERÉ.
 *
 * === MIÉRT NEM ELÉG A BEÉPÍTETT (base-14) BETŰ ===
 *
 * A PDF tizennégy beépített betűkészlete WinAnsi kódolással dolgozik, és az
 * **nem tartalmazza az `ő` és az `ű` betűt** -- se kicsit, se nagyot. A hiba
 * NÉMA: a generálás lefut, a kilépési kód nulla, a PDF érvényes.
 *
 * MÉRVE (2026-09-16, `pdfkit` 0.20.2 + `pdfjs-dist` 6.2.108 visszaolvasással),
 * és a romlás alakja a lényeg -- nem szemét és nem kihagyás:
 *
 *     a lapra írt  "ő Ő"  ->  visszaolvasva  "P"
 *     a lapra írt  "ű Ű"  ->  visszaolvasva  "p"
 *
 * (Az `Ő` az U+0150, a WinAnsi-ra szűkítés az alsó bájtot tartja meg: 0x50 =
 * `P`. Az `Ű` az U+0170 -> 0x70 = `p`.) A többi hét magyar ékezetes alak --
 * `á é í ó ú ö ü` és nagybetűs párjuk -- hibátlanul átmegy.
 *
 * EZÉRT VESZÉLYESEBB EZ, MINT EGY SZEMETES KARAKTER: a szemét gyanús, és aki
 * meglátja, szól. Egy `P` ELÜTÉSNEK látszik. A partnernek átadott munkalapon
 * a "tűzálló bevonat" nem hibaüzenetként jelenik meg, hanem elgépelt szóként,
 * és senki nem jelenti be.
 *
 * === MIÉRT A TELJES FÁJL, ÉS MIÉRT NEM ELŐRE SZŰKÍTETT ===
 *
 * A `pdfkit` beágyazáskor MAGÁTÓL szűkít: egy kilenc soros lapon a beágyazott
 * betűfolyam 7787 bájt, a teljes készlet egy százaléka. Az előszűkítés tehát a
 * KIMENETBŐL nem vesz el semmit, csak a repóból -- cserébe viszont minden
 * karakter, ami kimaradna a listából, ugyanazt a néma hibát adná, ami ellen ez
 * az egész csere történt. Mérve: egy beágyazott készletből hiányzó jel
 * `U+0000`-ként olvasható vissza, nulla kilépési kóddal.
 *
 * A licenc és a származás a betű mellett áll (`DejaVuSans.LICENSE.txt`), és a
 * licenc KÖVETELI, hogy együtt utazzanak: ne mozgasd őket külön.
 */

export const PDF_FONT_FILENAME = "DejaVuSans.ttf";

/** A csomag gyökeréhez képest -- lásd a keresés indoklását lentebb. */
const FONT_RELATIVE_PATH = join("assets", "fonts", PDF_FONT_FILENAME);

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * A BETŰ ÚTJA, FÖLFELÉ KERESVE -- NEM RÖGZÍTETT MÉLYSÉGGEL.
 *
 * A `tsconfig` `include` értéke `src/**\/*.ts`, tehát a fordító a `.ttf` fájlt
 * NEM másolja a `dist` mellé: a betűt a csomag gyökere alól kell elérni, nem a
 * fordított kód mellől. (Ugyanezt a csapdát a márka-törzs betöltője is leírja
 * a saját fejlécében, egy másik fájlra.)
 *
 * MIÉRT KERESÉS, ÉS MIÉRT NEM "három szinttel feljebb": a fordított könyvtár a
 * rendes futásnál `dist`, a teszteknél `test-dist`, a telepített képben pedig a
 * csomag gyökere maga a `/app` -- és ha valaki később egy szinttel mélyebbre
 * teszi ezt a modult, egy rögzített szám CSENDBEN rossz útra mutatna. A keresés
 * mindhárom helyen ugyanazt találja meg.
 *
 * ÉS HA NEM TALÁLJA, HANGOSAN ÁLL MEG, a végigpróbált utak felsorolásával. Ez
 * szándékos: a betű hiánya a telepített képben pontosan az a hiba, ami a
 * fejlesztői gépen sosem áll elő, tehát a hibaüzenetnek magának kell
 * megmondania, hol keresse a következő olvasó.
 */
export function resolvePdfFontPath(startDir: string = HERE): string {
  const tried: string[] = [];
  let dir = startDir;

  for (;;) {
    const candidate = join(dir, FONT_RELATIVE_PATH);
    tried.push(candidate);
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    `A PDF betűkészlete (${PDF_FONT_FILENAME}) nem található. ` +
      `A beépített betű NEM használható helyette: az "ő" és az "ű" némán ` +
      `elromlana rajta. Végigpróbált utak: ${tried.join(", ")}`,
  );
}
