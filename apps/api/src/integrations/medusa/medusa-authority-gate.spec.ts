import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  isKnownCatalogAuthority,
  KNOWN_CATALOG_AUTHORITIES,
} from "./medusa-publication.policy.js";

/**
 * A GAZDA-FELTETEL NEGY PONTON ALL, ES 2026-09-02 OTA UGYANAZT KELL MONDANIA.
 *
 * A harom vetito parancs (termek, keszlet, ar) es maga a publikacios szabaly.
 * Amig mind a negy KULON irta le a feltetelt, egy tulajdonosi dontes atvezetese
 * negy kulon alkalom volt arra, hogy egy kimaradjon -- es a kimaradas nem
 * egyforma: egy parancs-szuro hianya HANGOS (nem tortenik semmi), a szabalye
 * NEMA (minden atmegy, a futas sikert jelent, es a boltban semmi nem latszik).
 *
 * EZ A FAJL KETFELE ALLITAST TARTALMAZ, ES A KULONBSEG SZAMIT:
 *
 *   VISELKEDES  -- a kozos predikatum mit fogad el. Ezt futtatva merjuk.
 *   SZERKEZET   -- hogy mind a negy pont EZT hasznalja, es egyik sem tart
 *                  sajat osszehasonlitast. Ezt a FORRAS szovegen merjuk, mert
 *                  a termek-parancs a globalis prisma peldanyt hasznalja, tehat
 *                  egy unit tesztbol nem futtathato vegig.
 *
 * A szerkezeti allitas hatara: azt latja, MIT HIV a fajl, nem azt, hogy futas
 * kozben mi tortenik. Amit viszont megfog, az pontosan a kockazat: ha valaki
 * az egyik pontot atirja sajat feltetelre, a negy szint elvalik egymastol.
 */

const FORRAS = {
  /**
   * A TORZS 2026-09-04 ota a FUTTATOBAN all, nem a parancsban. A halo listaja
   * KEZZEL irt fajlnev, tehat a kiemeles utan a regi nevre mutatva NEM a
   * kodot merne, hanem egy belepesi pontot -- es az `ismert pozitiv kontroll`
   * (a `catalogAuthority` jelenlete) hangosan meg is mondta.
   */
  "termek-vetítés": "medusa-projection.runner.ts",
  "készlet-vetítés": "medusa-inventory.cli.ts",
  "ár-vetítés": "medusa-pricing.cli.ts",
  "publikációs szabály": "medusa-publication.policy.ts",
} as const;

/**
 * A FORRAST OLVASSUK, NEM A LEFORDITOTT ALAKOT, es a `..` lepesek szama nem
 * elgepeles: a teszt a `test-dist/integrations/medusa/` konyvtarbol fut, tehat
 * innen harom szint vissza a csomag gyokere.
 *
 * ES AZONNAL ELLENORIZZUK, HOGY TENYLEG OLVASTUNK: egy rossz utvonal ugyanazt
 * adna, mint egy hianyzo hivas -- nulla talalatot. Az elso valtozatom pontosan
 * ezen bukott el, es a hibauzenet ugy nezett ki, mintha a NEGY PONT ternenek el
 * egymastol, holott a fajlokat nem is olvastam.
 */
function forrasa(fajl: string): string {
  const szoveg = readFileSync(
    new URL(`../../../src/integrations/medusa/${fajl}`, import.meta.url),
    "utf8",
  );
  assert.ok(
    szoveg.includes("catalogAuthority"),
    `${fajl}: a forrast nem olvastam el (ismert pozitiv kontroll)`,
  );
  return szoveg;
}

describe("a gazda-kapu: mit fogad el", () => {
  it("a két ismert gazdát elfogadja", () => {
    assert.equal(isKnownCatalogAuthority("ACROPORA"), true);
    assert.equal(isKnownCatalogAuthority("UNAS"), true);
    assert.deepEqual([...KNOWN_CATALOG_AUTHORITIES], ["ACROPORA", "UNAS"]);
  });

  /**
   * A `null` NEM a regi szabaly maradeka. A sema ket erteket ismer; amirol nem
   * tudjuk, honnan jott, azt visszatartjuk. Kiengedni CSENDES tevedes (megjelenik
   * a boltban, senki nem keresi), visszatartani HANGOS.
   */
  it("az ismeretlen gazdát fail-closed kezeli", () => {
    assert.equal(isKnownCatalogAuthority(null), false);
    assert.equal(isKnownCatalogAuthority(""), false);
    assert.equal(isKnownCatalogAuthority("VALAMI_MAS"), false);
  });
});

describe("a gazda-kapu: mind a négy pont ugyanazt mondja", () => {
  /**
   * EZ AZ AZ ALLITAS, AMIT A HAROM KULON ALLITAS NEM AD KI. Mindegyik csak a
   * SAJAT pontjat nezi; ez azt nezi, hogy a negy EGYUTT mozog-e. Ha valaki
   * kesobb egy otodik vetitest ad hozza, ez a lista nem fedi le -- de akkor a
   * hianya itt latszik, egy helyen.
   */
  for (const [nev, fajl] of Object.entries(FORRAS)) {
    it(`${nev}: a közös feltételt hívja`, () => {
      assert.match(
        forrasa(fajl),
        /isKnownCatalogAuthority\(/,
        `${fajl} nem a közös gazda-feltételt használja`,
      );
    });

    it(`${nev}: nem tart saját gazda-összehasonlítást`, () => {
      const sajat = forrasa(fajl).match(
        /catalogAuthority\s*!==\s*"[A-Z]+"|catalogAuthority\s*===\s*"[A-Z]+"/g,
      );
      assert.equal(
        sajat,
        null,
        `${fajl} saját gazda-összehasonlítást tart: ${sajat?.join(", ")}`,
      );
    });
  }
});
