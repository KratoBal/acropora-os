import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A MOBIL VÁLASZ-TÍPUSAI EGYEZZENEK A KÖZÖS CSOMAG TÍPUSAIVAL.
 *
 * === A MÉRT HIBA, 2026-09-16 ===
 *
 * A hibajegy adatlapja a telefonon MEG SEM NYÍLT volna: a képernyő
 * `detail.worksheets`-et olvasott, a szerver válaszában viszont olyan kulcs
 * NINCS -- a munkalapok a `timeline` bejegyzésein át jönnek. `undefined.length`,
 * vagyis kivétel, nem hiányos lista.
 *
 * A két link-típus mezőnevei szintén eltértek: a munkalapé HÁROMBÓL HÁROM,
 * az eszközé egy (`name` a `assetName` helyett).
 *
 * === ÉS AMIÉRT A TYPECHECK ZÖLD VOLT ===
 *
 * Az Expo app nem húzhatja be a munkatér csomagjait, tehát a válasz típusait
 * MÁSOLJA. A másolat ÖNMAGÁVAL konzisztens: a fordító azt ellenőrzi, hogy a
 * képernyő a saját deklarációmat helyesen olvassa -- azt nem, hogy a
 * deklarációm igaz-e a szerverre. Ezt egy typecheck SZERKEZETILEG nem láthatja.
 *
 * A képességeknél már van ilyen összevetés (`mobile-capability-mirror.spec.ts`),
 * a VÁLASZ-MEZŐKRE nem volt. Ez a fájl az.
 *
 * === A HATÁRA, KIMONDVA ===
 *
 * A MEZŐNEVEKET veti össze, nem a típusokat: egy `string` kontra `number`
 * eltérés átcsúszik rajta. Ez PADLÓ, nem garancia -- de a mai három csúszásból
 * hármat megfogott volna, mert mind a három NÉV volt.
 */
const KOZOS = "../../packages/types/src/service-job-management.ts";
const MOBIL = "../mobile/src/lib/service-jobs/types.ts";

function forras(ut: string): string {
  const s = readFileSync(ut, "utf8");
  // POZITIV KONTROLL A BEOLVASASRA: rossz útvonalnál a lenti állítások két
  // ÜRES halmazt vetnének össze -- zölden.
  assert.ok(s.length > 1000, `${ut}: üres vagy gyanúsan rövid`);
  return s;
}

/** Egy `interface` mezőneveinek halmaza, ahogy a fájlban áll. */
function mezok(s: string, nev: string): Set<string> {
  const start = s.indexOf(`export interface ${nev} `);
  assert.notEqual(start, -1, `nem találtam: ${nev}`);
  const veg = s.indexOf("\n}", start);
  assert.notEqual(veg, -1, `nem találtam a végét: ${nev}`);
  const torzs = s.slice(start, veg);
  return new Set(
    [...torzs.matchAll(/^\s{2}([A-Za-z_][\w]*)\??\s*:/gm)].map((m) => m[1]!),
  );
}

describe("a mobil válasz-típusai a közös csomaghoz mérve", () => {
  it("POZITÍV KONTROLL: a kiolvasás nem üres halmazt ad", () => {
    const mezoink = mezok(forras(KOZOS), "ServiceJobWorksheetLink");
    assert.ok(
      mezoink.size >= 4,
      `gyanúsan kevés mezőt olvastam ki: ${[...mezoink].join(", ")}`,
    );
  });

  for (const nev of ["ServiceJobWorksheetLink", "ServiceJobAssetLink"]) {
    it(`a(z) ${nev} mezőnevei egyeznek`, () => {
      assert.deepEqual(
        [...mezok(forras(MOBIL), nev)].sort(),
        [...mezok(forras(KOZOS), nev)].sort(),
        `a mobil másolata eltér a szervertől: a képernyőn "undefined" jelenne meg, vagy a lap el sem indulna`,
      );
    });
  }

  /**
   * A CSATOLMÁNY-ÖSSZEFOGLALÓ IS RÉSZHALMAZ, ÉS 2026-09-17-IG SEHOL NEM VOLT MÉRVE.
   *
   * A telefon másolata SZŰKEBB (a szerver `type`, `sha256` és `caption` mezőt
   * is küld), tehát itt sem egyezést mérünk, hanem azt, hogy minden mezője
   * LÉTEZIK a közösben.
   *
   * MIÉRT KELL, HA A SZŰKÍTÉS SZÁNDÉKOS: mert a másik irány NEM szándékos. A
   * `caption` hónapokig hiányozhatott volna úgy, hogy a fordító zöld -- az
   * irodában írt felirat a telefonon egyszerűen nincs sehol. A hiány nem
   * hibázik; ez az állítás azt fogja meg, ha a telefon olyat OLVAS, amit a
   * szerver nem küld.
   */
  it("a mobil ServiceJobDocumentSummary minden mezője létezik a közösben", () => {
    const kozosMezok = mezok(forras(KOZOS), "ServiceJobDocumentSummary");
    const mobilMezok = mezok(forras(MOBIL), "ServiceJobDocumentSummary");
    // POZITIV KONTROLL: ket ures halmaz osszevetese zolden allna.
    assert.ok(
      mobilMezok.size >= 4 && kozosMezok.size >= 5,
      `gyanúsan kevés mező: mobil ${mobilMezok.size}, közös ${kozosMezok.size}`,
    );
    const idegen = [...mobilMezok].filter((mezo) => !kozosMezok.has(mezo));
    assert.deepEqual(
      idegen,
      [],
      `a telefon olyan csatolmány-mezőt olvas, ami a válaszban nincs: ${idegen.join(", ")}`,
    );
  });

  /**
   * A LEGSÚLYOSABB ESET: EGY MEZŐ, AMI A VÁLASZBAN NINCS.
   *
   * A mobil `ServiceJobDetail` SZŰKEBB, mint a közösé (csak azt sorolja, amit a
   * telefon használ), ezért itt nem az EGYEZÉST mérjük, hanem azt, hogy minden
   * mezője LÉTEZIK a közösben. A `worksheets` pontosan ezen bukott volna el.
   */
  it("a mobil ServiceJobDetail minden mezője létezik a közösben", () => {
    const kozos = forras(KOZOS);
    const kozosMezok = new Set([
      ...mezok(kozos, "ServiceJobDetail"),
      ...mezok(kozos, "ServiceJobListItem"),
    ]);
    const idegen = [...mezok(forras(MOBIL), "ServiceJobDetail")].filter(
      (mezo) => !kozosMezok.has(mezo),
    );
    assert.deepEqual(
      idegen,
      [],
      `a telefon olyan mezőt olvas, ami a válaszban nincs: ${idegen.join(", ")}`,
    );
  });
});
