import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { assetStatusWhere } from "./asset-status-filter.js";

/** A sema: innen derul ki, hany allapot letezik egyaltalan. */
const SEMA = "../../packages/database/prisma/schema.prisma";

describe("az eszköz-lista állapot-szűrője", () => {
  it("az ALL nem szűr semmire", () => {
    assert.deepEqual(assetStatusWhere("ALL"), {});
  });

  it("egy konkrét állapotra pontosan arra szűr", () => {
    assert.deepEqual(assetStatusWhere("IN_REPAIR"), { status: "IN_REPAIR" });
  });

  /**
   * A BEEPITETT TAGADASKENT ALL, NEM FELSOROLASKENT -- es ez a fajla allitas,
   * ami a kesobbi olvasot vedi, nem a mai kodot.
   *
   * Ha a szuro a harom mai allapotot SOROLNA fel, egy kesobb felvett negyedik
   * CSENDBEN kimaradna a "Beepitett" listabol: a felulet mukodne, a szam
   * kisebb lenne a valosnal, es semmi nem szolna. A tagadas ezzel szemben
   * magatol befogadja az ujat.
   */
  it("a Beépített tagadás, nem felsorolás", () => {
    assert.deepEqual(assetStatusWhere("IN_PLACE"), {
      status: { not: "RETIRED" },
    });
  });

  /**
   * ES AZ ALLITAS MASIK FELE A SEMAN ALL. A fenti allitas akkor is zold marad,
   * ha valaki egy MASODIK "kivezetett-szeru" allapotot vesz fel (mondjuk
   * `SCRAPPED`) -- a szuro tovabbra is csak a `RETIRED` erteket zarna ki, es a
   * "Beepitett" listaban megjelenne egy eszkoz, ami mar nincs a helyen.
   *
   * Ezert ez az allitas azt rogziti, HANY allapot letezik. Ha valaki uj
   * allapotot vesz fel, ez pirosodik ki, es akkor el KELL donteni, hogy az uj
   * ertek beepitettnek szamit-e.
   *
   * === ES EZ MEG IS TORTENT, 2026-09-16 ===
   *
   * A `OUT_OF_SERVICE` helyere ket tartalek-allapot lepett (`WARM_STANDBY`,
   * `COLD_STANDBY`). Ez az allitas pirosra fordult, ahogy kellett, es a
   * dontest MEGHOZTUK, nem csak a listat irtuk at:
   *
   * MIND A KETTO BEEPITETTNEK SZAMIT. Egy tartalek eszkoz FIZIKAILAG OTT VAN
   * a helyszinen -- ez a kulonbseg a kivezetetthez kepest, ami mar nincs ott.
   * Balazs epp ezert kerte a ket allapotot: tartalek eszkozre is kell tudni
   * hibajegyet nyitni, es a hibajegy eszkoz-valasztoja ugyanezzel az
   * `IN_PLACE` szurovel dolgozik.
   *
   * A SZURO MAGA NEM VALTOZOTT, es ez a tagadas erdeme: `not: RETIRED`. Ha
   * felsorolas allna ott, MOST kellett volna ket erteket hozzaadni -- es ha
   * valaki elfelejti, a ket tartalek CSENDBEN kiesne a "Beepitett" listabol.
   */
  it("a séma állapotai: ha új jön, ezt a döntést újra kell hozni", () => {
    const sema = readFileSync(SEMA, "utf8");
    const blokk = /enum AssetStatus \{([^}]*)\}/.exec(sema);
    assert.ok(blokk, "nem találtam az AssetStatus enumot a sémában");
    assert.deepEqual(
      blokk[1]!
        .split("\n")
        .map((sor) => sor.trim())
        .filter(Boolean),
      ["ACTIVE", "WARM_STANDBY", "COLD_STANDBY", "IN_REPAIR", "RETIRED"],
      "új állapot került a sémába: döntsd el, beleszámít-e a Beépített szűrőbe",
    );
  });

  /**
   * AZ ISMERETLEN ERTEK NEM DOB. A DTO `@IsIn` ellenorzese mar elvagja, tehat
   * ide szabalyos uton nem jut el semmi -- de ez a fuggveny TISZTA, es a
   * viselkedese igy kiszamithato marad: a kapott erteket allapotkent kezeli,
   * es a lekerdezes ures listat ad, nem hibat.
   */
  it("ismeretlen értéket állapotként ad tovább", () => {
    assert.deepEqual(assetStatusWhere("VALAMI"), { status: "VALAMI" });
  });
});
