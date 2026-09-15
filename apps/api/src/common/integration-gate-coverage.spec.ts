import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * Minden adatbázisos integrációs spec kérdezze meg a kaput.
 *
 * A szabály eddig is létezett és dokumentálva volt, csak nem mindenhol futott
 * le: 2026-09-04-én tizenhárom spec fájlból három hívta a kaput, tíz nem, és a
 * tíz között volt kilenc szűrés nélküli `deleteMany()`. Egy kapu, amit egy fájl
 * nem hív meg, nem hibázik: csendben nem véd.
 *
 * AZ ELŐZŐ BEKEZDÉS SZÁMAI TÖRTÉNETIEK, ÉS 2026-09-15 ÓTA ÁLL MELLETTÜK A
 * DÁTUM. Enélkül jelen időben olvasódtak, és pontosan ez történt: aznap egy
 * független mérés is kilenc szűretlen hívást talált - egy MÁSIK kilencet, három
 * fájlban, harminc spec között. A két szám véletlenül egyezett, és aki a
 * kommentből veszi át, ma is kilencet mondana. A valódi akkori szám tíz volt: a
 * tizedik `deleteMany({})` alakban állt, üres objektummal, és a keresési minta
 * nem látta. A számot a minta döntötte el, nem a világ.
 *
 * Ezért kap az alábbi harmadik állítás SAJÁT keresést, és ezért nem áll benne
 * darabszám: amit számolni kell, azt a futás számolja.
 *
 * Ez a teszt ezért nem a kapu LOGIKÁJÁT méri (arra saját tesztje van), hanem a
 * LEFEDETTSÉGÉT. Egy tizennegyedik spec fájl, ami holnap születik és
 * kimarad belőle, ugyanaz a hiba lenne, csak kisebb számokkal.
 *
 * A lista nem kézzel karbantartott: a lemezen lévő fájlokat sorolja fel, tehát
 * egy új fájl attól kerül bele, hogy létezik.
 */

async function integrationSpecs(): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of glob("src/**/*.integration.spec.ts"))
    found.push(entry);
  return found.sort();
}

describe("integrációs kapu lefedettsége", () => {
  it("minden integrációs spec meghívja a kaput", async () => {
    const specs = await integrationSpecs();

    // Nulla találat itt zöld lenne, és pontosan azt állítaná, hogy minden
    // rendben - miközben azt jelentené, hogy a keresés romlott el.
    assert.ok(
      specs.length >= 10,
      `Csak ${specs.length} integrációs spec fájlt találtam. Ez a keresés hibája, nem a lefedettségé.`,
    );

    // A HÍVÁST keressük, nem a nevet: egy fájl, ami csak kommentben említi a
    // kaput, ugyanúgy védtelen, közben viszont bekötöttnek látszana.
    const missing = specs.filter(
      (file) =>
        !/integrationDatabaseGate\s*\(/.test(readFileSync(file, "utf8")),
    );

    assert.deepEqual(
      missing,
      [],
      "Ezek az integrációs specek nem kérdezik meg a kaput, tehát bármelyik " +
        "adatbázisra ráfutnak, amire a DATABASE_URL éppen mutat: " +
        missing.join(", "),
    );
  });

  /**
   * A hívás önmagában kevés: a kapu `refuse` ága csak akkor véd, ha valaki el is
   * dobja. Egy spec, ami lekéri a kaput és aztán figyelmen kívül hagyja a
   * válaszát, ugyanúgy ír, mint amelyik meg sem kérdezte - és közben úgy néz ki,
   * mintha be lenne kötve.
   */
  it("minden integrációs spec el is dobja a kapu elutasítását", async () => {
    const specs = await integrationSpecs();

    const ignoring = specs.filter((file) => {
      const source = readFileSync(file, "utf8");
      return !/gate\.mode === "refuse"/.test(source);
    });

    assert.deepEqual(
      ignoring,
      [],
      "Ezek a specek lekérik a kaput, de nem dobják el az elutasítást: " +
        ignoring.join(", "),
    );
  });

  /**
   * EGY INTEGRÁCIÓS SPEC NE ÜRÍTSEN TÁBLÁT.
   *
   * A HARMADIK HIBAFAJTA, ÉS EGYIK MEGLÉVŐ ŐRZŐNK SEM LÁTJA. A CI kapuja
   * (`scripts/tap-stream-gate.mjs`) azt fogja meg, ha egy takarítás DOB; a
   * specek végén álló leftover-állítás azt, ha csendben NEM CSINÁL SEMMIT. Ez
   * a harmadik kérdés: nem vitt-e el valaki TÖBBET a sajátjánál.
   *
   * MÉRVE 2026-09-15 (verify job 104337824776, két pontos sor-pillanatkép az
   * integrációs futás körül): a `Category` tábla ÖT sorral kevesebb lett, mint
   * amennyivel indult - a seedelt referencia-sorok. Az ok tíz szűretlen hívás
   * négy specben, hat táblát ürítve.
   *
   * AMI NEM KOCKÁZAT, és mondjuk is ki: az `integrationDatabaseGate` miatt ez
   * csak `_test` vagy `_ci` végű adatbázison tud lefutni. Éles adat nem forgott
   * kockán. A kár határon belül volt: egyik suite a másik adatát vitte el - és
   * mivel a futtató `--test-concurrency=1`, a sorrendet pedig a `find` adja, egy
   * suite, ami ma a törlés előtt fut, holnap utána futhat.
   *
   * MINDKÉT ALAK TILOS, ÉS EZ NEM SZŐRSZÁLHASOGATÁS: a `deleteMany()` és a
   * `deleteMany({})` ugyanazt teszi, de az első mintára keresve a második
   * láthatatlan. Pontosan így maradt ki egy negyedik fájl az első seprésemből.
   *
   * HA EGY SPEC JOGOSAN ÜRÍT SAJÁT TÁBLÁT, ez az állítás pirosra vált - és az a
   * helyes irány. A kivétel akkor kerülhet be, ha INDOKOLVA van: melyik tábla,
   * és miért az övé az egész. Egy indoklás nélkül felvett kivételről két hónap
   * múlva senki nem tudja, döntés volt-e vagy kényelem.
   */
  it("egyetlen integrációs spec sem ürít táblát szűrés nélkül", async () => {
    const specs = await integrationSpecs();
    assert.ok(
      specs.length >= 10,
      `Csak ${specs.length} integrációs spec fájlt találtam. Ez a keresés hibája.`,
    );

    /**
     * HÁROM ALAK, NEM KETTŐ, és a harmadik ma még nem fordul elő - épp ezért
     * kell. A `deleteMany()`, a `deleteMany({})` és a `deleteMany({ where: {} })`
     * ugyanazt teszi: üres feltétel, teljes tábla. Az első kettőt egy mai mérés
     * hozta elő; a harmadikra acrobot kérdezett rá, és a mintám vak volt rá. Egy
     * őrző, ami csak a MA előforduló alakokat ismeri, a holnap írt sort engedi át.
     *
     * A KOMMENTEKET KI KELL HAGYNI, és ez sem elméleti: a javított specek
     * LEÍRJÁK a tiltott alakot, mert enélkül a következő olvasó nem tudja, mit
     * ne csináljon. Egy őrző, ami a saját dokumentációjától pirosodik, arra
     * tanít, hogy ne írjunk magyarázatot - és az drágább, mint amit véd.
     */
    const uresFeltetel =
      /prisma\.(\w+)\.deleteMany\(\s*(?:\{\s*(?:where\s*:\s*\{\s*\}\s*,?\s*)?\}\s*)?\)/;

    const unfiltered: string[] = [];
    for (const file of specs) {
      const source = readFileSync(file, "utf8");
      let blokkKommentben = false;
      for (const [index, raw] of source.split("\n").entries()) {
        const line = raw.trim();
        if (blokkKommentben) {
          if (line.includes("*/")) blokkKommentben = false;
          continue;
        }
        if (line.startsWith("/*")) {
          if (!line.includes("*/")) blokkKommentben = true;
          continue;
        }
        if (line.startsWith("//") || line.startsWith("*")) continue;

        const hit = uresFeltetel.exec(line);
        if (hit) unfiltered.push(`${file}:${index + 1} (${hit[1]})`);
      }
    }

    assert.deepEqual(
      unfiltered,
      [],
      "Ezek a hívások a TELJES táblát ürítik, nem csak a spec saját sorait. " +
        "Szűrj a fixtúra saját ismérvére (előtag, azonosító-lista, vagy a suite " +
        "indulási időbélyege), vagy - ha a törlés jogos - vedd fel ide " +
        "kivételként, INDOKLÁSSAL: " +
        unfiltered.join(", "),
    );
  });
});
