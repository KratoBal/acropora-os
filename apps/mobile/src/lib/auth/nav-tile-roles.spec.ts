import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A KÉZZEL ÍRT SZEREPKÖR-LISTA NE TUDJA TÚLÉLNI A CSEMPE MEGNYITÁSÁT.
 *
 * A kezdőképernyőn a NAV csempe láthatóságát egy felsorolás dönti el
 * (`NAV_TILE_ROLES`), nem egy jogosultság-kulcs. Ez ma HELYES, és pontosan egy
 * okból az: a NAV a szerveren nem egy jog, hanem három, művelet szerint (a
 * kapcsolat beállítása `settings.manage`, az adószám-lekérdezés
 * `customers.manage`, a bejövő számlák `purchasing.view`), tehát egyetlen
 * kliens-oldali kulcs nem tudná tükrözni.
 *
 * DE A LISTA CSAK ADDIG VÉDHETŐ, AMÍG A CSEMPE NEM NYIT MEG SEMMIT. Nincs
 * mögötte hívás, aminek a jogát tükrözhetné, tehát nincs mit elrontani. Amikor
 * valaki megépíti a képernyőt és bekapcsolja, ez az indok egy pillanat alatt
 * elévül -- és pont akkor nem nézne rá senki erre a listára.
 *
 * EZÉRT NEM A LISTA TARTALMÁT ŐRZI EZ A FÁJL. Egy ilyen rögzítés
 * változás-jelző teszt lenne: aki átírja a listát, átírja mellé a tesztet is,
 * és zöld marad. Amit ez a fájl kikényszerít, az a DÖNTÉS: a bekapcsolt csempe
 * láthatósága a hívásához tartozó kulcsból jöjjön.
 *
 * (Ez a megfogalmazás Acrobot döntése, 2026-08-27, egy korábbi, gyengébb alak
 * helyett, amit én javasoltam.)
 */

const HOME_SCREEN = "src/app/index.tsx";

/** A NAV `ModuleCard` blokkja, ahogy a képernyőn áll. */
function navTileBlock(source: string): string {
  const match = /<ModuleCard\s+code="NAV"([\s\S]*?)\/>/.exec(source);
  assert.ok(
    match,
    'Nem találtam a code="NAV" csempét a kezdőképernyőn. Ez a keresés hibája, ' +
      "nem a képernyőé -- egy nem talált csempéről ez a fájl semmit nem állít.",
  );
  return match![1]!;
}

describe("a NAV csempe láthatóságának forrása", () => {
  /**
   * A KONTROLL A KERESÉSRE. Enélkül a lenti állítás egy üres szövegen menne
   * végig, és zölden mondaná, hogy minden rendben.
   */
  it("megtalálja a csempét, amiről állít valamit", () => {
    const tile = navTileBlock(homeScreen());

    assert.match(tile, /title="NAV-szinkron"/);
    assert.match(tile, /available=\{NAV_TILE_ROLES\.includes\(user\.role\)\}/);
  });

  it("a csempe addig áll szerepkör-listán, amíg nem nyit meg semmit", () => {
    const tile = navTileBlock(homeScreen());

    assert.match(
      tile,
      /enabled=\{false\}/,
      "A NAV csempe már megnyit valamit, tehát a kézzel írt szerepkör-lista " +
        "indoka elévült: a láthatóság mostantól a hívásához tartozó " +
        "jogosultság-kulcsból jöjjön (a bejövő számlákhoz `purchasingView`), " +
        "ne a `NAV_TILE_ROLES` felsorolásból.",
    );
  });
});

function homeScreen(): string {
  return readFileSync(HOME_SCREEN, "utf8");
}
