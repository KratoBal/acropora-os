import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { egymasUtan, egyszeriMegnyitas } from "./egyszeri-megnyitas";

/**
 * A HELYI ADATBAZIS KOZOS MEGNYITASA (Balazs, 2026-09-30, Android).
 *
 * A letoltes "kesz"-t mondott, terero nelkul a lista pedig "nincs mentett
 * masolat" volt. A ket mechanizmus, ami ezt kiadja, lasd
 * `egyszeri-megnyitas.ts`: egy elhasalt megnyitast a modul OROKRE megjegyzett,
 * es a parhuzamos megnyitasok ugyanazt a lepest futtattak le ketszer.
 */

const kesleltet = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("az adatbázis egyszeri megnyitása", () => {
  /**
   * A PARHUZAMOS MEGNYITAS EGY MEGNYITAS. Kulonben ugyanazt a sorszamozott
   * lepest (`ALTER TABLE ... ADD COLUMN`) ket hivo futtatja ugyanazon a
   * kapcsolaton, es a masodik "duplicate column name" hibaval elhasal.
   *
   * MI PIROSIT: ha minden hivo sajat megnyitast indit.
   */
  it("a párhuzamos hívók EGY megnyitáson osztoznak", async () => {
    let nyitasok = 0;
    const megnyit = egyszeriMegnyitas(async () => {
      nyitasok += 1;
      await kesleltet();
      return { kapcsolat: nyitasok };
    });
    const [a, b, c] = await Promise.all([megnyit(), megnyit(), megnyit()]);
    assert.equal(nyitasok, 1);
    assert.equal(a, b);
    assert.equal(b, c);
  });

  /**
   * EZ A HIBA MAGJA. A regi alak (`opening ??= initializeOfflineDatabase()`) az
   * ELUTASITOTT igeretet is megtartotta: egy elhasalt megnyitas utan a modul az
   * app ujrainditasaig semmit nem irt es semmit nem olvasott, csendben.
   *
   * MI PIROSIT: ha a bukott megnyitas utan a kovetkezo hivas a REGI hibat kapja.
   */
  it("egy elhasalt megnyitás után a következő hívás ÚJRA próbál", async () => {
    let nyitasok = 0;
    const megnyit = egyszeriMegnyitas(async () => {
      nyitasok += 1;
      if (nyitasok === 1) throw new Error("duplicate column name: state");
      return "nyitva";
    });
    await assert.rejects(megnyit(), /duplicate column name/);
    assert.equal(await megnyit(), "nyitva");
    assert.equal(nyitasok, 2);
    // es a sikeres megnyitas utan mar nem nyit ujra
    assert.equal(await megnyit(), "nyitva");
    assert.equal(nyitasok, 2);
  });
});

describe("a tranzakciók sorrendje", () => {
  /**
   * A `withTransactionAsync` nem kizarolagos: egy kozben indulo masik `BEGIN`
   * hibat dob, es a hibaagon kiadott `ROLLBACK` a MASIK tranzakciot gorgeti
   * vissza.
   *
   * MI PIROSIT: ha a masodik feladat az elso vege elott elindul.
   */
  it("a második feladat megvárja az elsőt", async () => {
    const sorrend: string[] = [];
    const sorban = egymasUtan();
    await Promise.all([
      sorban(async () => {
        sorrend.push("elso-kezd");
        await kesleltet();
        await kesleltet();
        sorrend.push("elso-vege");
      }),
      sorban(async () => {
        sorrend.push("masodik-kezd");
        sorrend.push("masodik-vege");
      }),
    ]);
    assert.deepEqual(sorrend, [
      "elso-kezd",
      "elso-vege",
      "masodik-kezd",
      "masodik-vege",
    ]);
  });

  it("egy elhasalt feladat nem állítja meg a következőt, és a hibát a saját hívója kapja", async () => {
    const sorban = egymasUtan();
    const elso = sorban(async () => {
      throw new Error("elso bukott");
    });
    const masodik = sorban(async () => "masodik kesz");
    await assert.rejects(elso, /elso bukott/);
    assert.equal(await masodik, "masodik kesz");
  });
});

/**
 * A MODULOK TENYLEG A KOZOS UTON NYITNAK.
 *
 * A fenti allitasok a segedfuggvenyt merik; ez azt, hogy HASZNALJA-E valaki.
 * Egy modul, ami ujra sajat `initializeOfflineDatabase()` hivassal nyit, vagy
 * sajat `withTransactionAsync` hivast ad ki, visszahozza mind a ket hibat --
 * es a fenti tesztek zoldek maradnanak.
 *
 * A minta a HIVAS alakja (`nev(`), nem a puszta nev: a kommentekben a nev
 * szerepelhet.
 */
describe("az offline modulok a közös megnyitást használják", () => {
  const MAPPA = join(__dirname, "..", "..", "..", "src", "lib", "offline");
  const forrasok = readdirSync(MAPPA)
    .filter((nev) => nev.endsWith(".ts") && !nev.endsWith(".spec.ts"))
    .map((nev) => ({
      nev,
      kod: readFileSync(join(MAPPA, nev), "utf8"),
    }));

  it("a források betöltődtek", () => {
    // ISMERT POZITIV KONTROLL: egy ures mappa minden lenti allitast teljesitene.
    const nevek = forrasok.map((forras) => forras.nev);
    for (const vart of [
      "database.ts",
      "asset-cache.ts",
      "queue-store.ts",
      "service-job-cache.ts",
    ])
      assert.ok(nevek.includes(vart), `nem talalom: ${vart}`);
  });

  it("csak a database.ts hívja az initializeOfflineDatabase-t", () => {
    const hivok = forrasok
      .filter((forras) => forras.nev !== "database.ts")
      .filter((forras) => /\binitializeOfflineDatabase\(/.test(forras.kod))
      .map((forras) => forras.nev);
    assert.deepEqual(hivok, []);
  });

  it("csak a database.ts nyit tranzakciót, sorban", () => {
    const hivok = forrasok
      .filter((forras) => forras.nev !== "database.ts")
      .filter((forras) => /\.withTransactionAsync\(/.test(forras.kod))
      .map((forras) => forras.nev);
    assert.deepEqual(hivok, []);
  });
});
