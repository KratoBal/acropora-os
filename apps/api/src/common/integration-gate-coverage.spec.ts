import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * Minden adatbázisos integrációs spec kérdezze meg a kaput.
 *
 * A szabály eddig is létezett és dokumentálva volt, csak nem mindenhol futott
 * le: tizenhárom spec fájlból három hívta a kaput, tíz nem, és a tíz között
 * volt kilenc szűrés nélküli `deleteMany()`. Egy kapu, amit egy fájl nem hív
 * meg, nem hibázik: csendben nem véd.
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
});
