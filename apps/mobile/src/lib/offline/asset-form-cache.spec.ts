import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * AZ ESZKOZ-URLAP KET VALASZTOJANAK MASOLATA.
 *
 * Balazs 2026-09-03-an ELESBEN merte, hogy terero nelkul nem tud eszkozt
 * felvinni: a ROGZITES ment offline, de az URLAP ket listaja halozatrol jott.
 * Az SQLite reteg nem unit-tesztelheto (natív runtime kell hozza), tehat amit
 * merunk, az a FORRAS -- es epp az a nehany tulajdonsag, amin a felvitel all.
 */

const GYOKER = join(__dirname, "..", "..", "..", "src", "lib", "offline");

function olvas(nev: string): string {
  const ut = join(GYOKER, nev);
  try {
    return readFileSync(ut, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${ut}. Ez a KERESES hibaja, nem a lefedettsege.`,
    );
  }
}

const cache = olvas("asset-form-cache.ts");

/**
 * EGY FUGGVENY TORZSE, NEV SZERINT.
 *
 * A kovetkezo `export` -ig olvas: igy az allitas ahhoz a fuggvenyhez kotodik,
 * amelyikrol szol, es nem talal ra ugyanarra a szovegre egy masikban.
 */
function fuggvenyTorzs(forras: string, nev: string): string {
  const kezdet = forras.indexOf(`export async function ${nev}`);
  if (kezdet < 0) throw new Error(`Nincs ilyen fuggveny: ${nev}`);
  const kovetkezo = forras.indexOf("\nexport ", kezdet + 1);
  return forras.slice(kezdet, kovetkezo < 0 ? undefined : kovetkezo);
}
const forget = olvas("forget-offline-data.ts");
const database = olvas("database.ts");

describe("az űrlap-másolat szerkezete", () => {
  it("a forrás betöltődött", () => {
    // ISMERT POZITIV KONTROLL: egy ures fajl minden lenti allitast teljesitene.
    assert.equal(cache.length > 2000, true);
    assert.match(cache, /cached_asset_owners/);
  });

  it("MINDKÉT frissítés TÖRLI a régi sorokat", () => {
    /*
      A ket lista TELJES: a tulajdonos-lista egeszben, az alegysegek a
      partnerre nezve. Csak beszurassal egy idokozben megszunt partner vagy
      alegyseg ottmaradna a masolatban, a szerelo azt valasztana, es a felvitel
      a SZERVEREN bukna el -- a pincebol nezve megmagyarazhatatlanul.

      MI PIROSIT: barmelyik DELETE elhagyasa.
    */
    /*
      A KERESES A FUGGVENY TORZSERE MEGY, NEM A PUSZTA SZOVEGRE, ES NEM IS A
      FORMAZASRA. Ket dolgot mertem 2026-09-03-an:

      1. az elso valtozat csak a `DELETE FROM cached_asset_owners` szoveget
         kereste, es a rontas (a torles kivetele a frissitesbol) ZOLDEN atment,
         mert ugyanaz a szoveg ott all a KIJELENTKEZESI takaritasban is;
      2. a masodik valtozat a ket utasitas KOZTI SZOKOZOKRE volt kotve, es a
         formazo atrendezese pirosra vitte -- egy allitas, amit a prettier el
         tud tori, nem a viselkedesrol szol.

      Ezert a torzset vagjuk ki nev szerint, es a SORRENDET nezzuk benne.
    */
    for (const [nev, tabla] of [
      ["rememberAssetOwners", "cached_asset_owners"],
      ["rememberPartnerUnits", "cached_partner_units"],
    ] as const) {
      const torzs = fuggvenyTorzs(cache, nev);
      const torles = torzs.indexOf(`DELETE FROM ${tabla}`);
      const beszuras = torzs.indexOf(`INSERT INTO ${tabla}`);
      assert.notEqual(torles, -1, `${nev}: nincs torles`);
      assert.notEqual(beszuras, -1, `${nev}: nincs beszuras`);
      assert.equal(
        torles < beszuras,
        true,
        `${nev}: a torlesnek a beszuras ELOTT kell allnia`,
      );
    }
  });

  it("az alegységek PARTNER szerint szűrve jönnek vissza", () => {
    // Szures nelkul egy MASIK partner alegysegei is feljonnenek, es az eszkoz
    // az o helyszinevel indulna el.
    assert.match(
      cache,
      /FROM cached_partner_units\s*\n?\s*WHERE partner_id = \?/,
    );
  });

  it("egy SÉRÜLT sor nem viszi el a listát", () => {
    /*
      MI PIROSIT: ha a feldolgozas egyetlen `JSON.parse` hivason allna a teljes
      listara. Egy serult sor akkor az EGESZ valasztot uresre vinne -- es a
      szerelo azt latna, hogy nincs egyetlen partner sem.
    */
    assert.match(cache, /for \(const row of rows\)/);
    assert.match(cache, /catch \{/);
  });

  it("a két tábla és az index létezik a sémában", () => {
    assert.match(database, /CREATE TABLE IF NOT EXISTS cached_asset_owners/);
    assert.match(database, /CREATE TABLE IF NOT EXISTS cached_partner_units/);
    assert.match(
      database,
      /CREATE INDEX IF NOT EXISTS cached_partner_units_partner/,
    );
  });

  it("kijelentkezéskor EZ IS megy", () => {
    /*
      Partnerek nevei es kodjai ulnek benne, es a telefon a kovetkezo
      kollegahoz is kerulhet.

      MI PIROSIT: ha az uj masolat kimarad a takaritasbol -- nema hiba, mert a
      kijelentkezes tovabbra is lefut.
    */
    assert.match(forget, /forgetAssetFormCache\(\)/);
  });
});
