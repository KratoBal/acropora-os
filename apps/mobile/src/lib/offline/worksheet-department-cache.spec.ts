import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * AZ SQLITE RÉTEG NEM UNIT-TESZTELHETŐ: az `expo-sqlite` natív runtime-ot
 * igényel. Amit MEG LEHET mérni, az a FORRÁSA -- és épp az a néhány
 * tulajdonság, amin a helyszíni felvitel áll.
 */

const GYOKER = join(__dirname, "..", "..", "..", "src", "lib");

function olvas(ut: string): string {
  const teljes = join(GYOKER, ut);
  try {
    return readFileSync(teljes, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${teljes}. Ez a KERESES hibaja, nem a lefedettsege -- a lenti allitasok addig semmit nem mondanak.`,
    );
  }
}

const cache = olvas("offline/worksheet-department-cache.ts");
const forget = olvas("offline/forget-offline-data.ts");
const provider = olvas("auth/AuthProvider.tsx");
const database = olvas("offline/database.ts");

describe("a helyszín-másolat szerkezete", () => {
  it("a források betöltődtek", () => {
    // ISMERT POZITIV KONTROLL: ures fajlok mellett minden lenti allitas
    // teljesulne.
    assert.equal(cache.length > 1500, true);
    assert.equal(forget.length > 300, true);
    assert.match(cache, /cached_worksheet_departments/);
  });

  it("a frissítés TÖRLI a partner régi sorait", () => {
    /*
      A lista a partnerre nezve TELJES. Ha csak beszurnank, egy idokozben
      TOROLT helyszin ottmaradna a masolatban, a szerelo azt valasztana, es a
      lap kuldese a szerveren bukna el -- a pincebol nezve
      megmagyarazhatatlanul.

      MI PIROSIT: a DELETE elhagyasa, vagy egy ON CONFLICT alaku beszuras.
    */
    assert.match(
      cache,
      /DELETE FROM cached_worksheet_departments WHERE customer_id = \?/,
    );
    assert.match(cache, /INSERT INTO cached_worksheet_departments/);
  });

  it("az olvasás PARTNER szerint szűr", () => {
    // Szures nelkul egy masik partner helyszinei is feljonnenek, es a lap az o
    // alegysegevel indulna el.
    assert.match(
      cache,
      /SELECT payload_json, synced_at FROM cached_worksheet_departments\s*\n?\s*WHERE customer_id = \?/,
    );
  });

  it("a tábla és az indexe létezik a sémában", () => {
    assert.match(
      database,
      /CREATE TABLE IF NOT EXISTS cached_worksheet_departments/,
    );
    assert.match(
      database,
      /CREATE INDEX IF NOT EXISTS cached_worksheet_departments_customer/,
    );
  });
});

describe("kijelentkezéskor a másolat MEGY", () => {
  it("a takarítás MINDKÉT másolatot elviszi", () => {
    /*
      Partner-helyszinek nevei es kodjai ulnek benne, es a telefon a kovetkezo
      kollegahoz is kerulhet.

      MI PIROSIT: ha az uj masolat kimarad a takaritasbol -- az a fajta nema
      hiba, amirol senki nem tud, mert a kijelentkezes tovabbra is lefut.
    */
    assert.match(forget, /forgetOfflineAssets\(\)/);
    assert.match(forget, /forgetWorksheetDepartments\(\)/);
  });

  /**
   * ES A FENTI KETTO KEVESEBB, MINT AMIT A SAJAT KOMMENTJE IGER.
   *
   * "MI PIROSIT: ha az uj masolat kimarad a takaritasbol" -- csakhogy a fenti
   * allitas KET nevet rogzit, a takaritas viszont OTOT hiv. Merve 2026-09-16:
   * a `forgetCachedWorksheets` es a `forgetAssetFormCache` mar ma sem allt
   * benne, es a hibajegy-masolat lett volna a harmadik, amit nem fog meg.
   *
   * EZ AZ ALLITAS EZERT A FORRASBOL DOLGOZIK, nem kezzel tartott listabol: az
   * `offline` mappa MINDEN `forget*` fuggvenye bekerul. Egy negyedik masolat,
   * amit valaki fel ev mulva ir, MAGATOL bekerul a mercebe -- egy kezzel
   * tartott lista pont akkor maradna el, amikor a legjobban kellene.
   */
  it("MINDEN mentett másolat takarítója le van hívva", () => {
    // UGYANAZ A GYOKER, AMIT A FAJL TOBBI ALLITASA HASZNAL: az `olvas` a
    // forrasfat olvassa, nem a leforditott kimenetet -- a kimenetben a
    // kommentek es a fuggvenynevek is masok lehetnek.
    const mappa = join(GYOKER, "offline");
    const takaritok = readdirSync(mappa)
      .filter((nev) => nev.endsWith(".ts") && !nev.includes(".spec."))
      .filter((nev) => nev !== "forget-offline-data.ts")
      .flatMap((nev) =>
        [
          ...olvas(join("offline", nev)).matchAll(
            /^export (?:async )?function (forget\w+)/gm,
          ),
        ].map((talalat) => talalat[1]!),
      );

    // A KONTROLL A KIOLVASASRA: ha a minta elromlik, ures listan menne vegig,
    // es az allitas ZOLDEN mondana, hogy minden takaritó le van hivva.
    assert.ok(
      takaritok.length >= 4,
      `gyanúsan kevés takarítót találtam: ${takaritok.join(", ")}`,
    );

    const hianyzo = takaritok.filter((nev) => !forget.includes(`${nev}()`));
    assert.deepEqual(
      hianyzo,
      [],
      `ezek a másolatok a készüléken maradnának kijelentkezés után: ${hianyzo.join(", ")}`,
    );
  });

  it("a SORT nem törli, és ez kimondva áll", () => {
    /*
      A `sync_queue` nem masolat, hanem a felvitel EGYETLEN letezo peldanya. Egy
      kijelentkezes, ami torli, a szerelo rogziteset semmisitene meg.
    */
    // A KERESES A MUVELETRE MEGY, NEM A NEVRE: a modul KOMMENTJE emliti a
    // `sync_queue` tablat (epp azert, hogy a kovetkezo olvaso ne vegye fel
    // ide), tehat egy puszta nev-keresés a sajat indoklasunkon bukna el.
    assert.doesNotMatch(forget, /DELETE FROM sync_queue/);
    assert.doesNotMatch(forget, /forgetQueue|clearQueue|removeQueueRow/);
    assert.match(forget, /A SOR/);
  });

  it("a kijelentkezés ezt a takarítást KAPJA MEG", () => {
    /*
      A SZAKADAS ELLEN: egy takarito fuggveny, amit senki nem hiv, ugyanugy nez
      ki a kodban, mint egy mukodo -- csak a masolat marad a keszuleken.
    */
    assert.match(provider, /from "@\/lib\/offline\/forget-offline-data"/);
    assert.match(provider, /forgetOfflineData,/);
  });
});
