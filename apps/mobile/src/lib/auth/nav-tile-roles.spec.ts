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
 *
 * ===================================================================
 * AMI 2026-09-02-ÁN VÁLTOZOTT, ÉS AMI NEM
 * ===================================================================
 *
 * A csempe láthatósága a SZERVER által kiadott menüből jön (`tileVisible`), és a
 * telefonon MÁR NINCS szerepkör-lista: a `NAV_TILE_ROLES` felsorolás a 4. lépéssel
 * (2026-09-02) eltűnt innen. A döntés teljes egészében a közös forrásba került,
 * ahol a szerep-listás ág kötelező `retiredBy` mezőt visel: ott áll leírva, mi
 * szünteti meg.
 *
 * EZ A FÁJL MÉGSEM VÁLT FÖLÖSLEGESSÉ, és pontosan egy okból: az `enabled` jelzőt
 * CSAK ITT lehet látni. A szerver nem tudja, hogy a csempe megnyit-e valamit --
 * az a telefon tulajdonsága. Az alábbi állítás tehát az egyetlen hely, ahol a
 * `retiredBy` feltételének a BEKÖVETKEZÉSE észrevehető.
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
    // A MINTA TORDELES-TURO. A prettier a hosszu sort tobbe tori, es egy
    // egysoros minta ettol elveszti a talalatot -- a kimenete pedig ugyanaz
    // lenne, mint egy VALODI elteresé: "nem talaltam". Merve 2026-09-02: a
    // formazas utan elbukott, holott a kod helyes volt.
    assert.match(tile, /available=\{\s*tileVisible\("NAV"\)\s*\}/);
  });

  it("a csempe addig áll szerepkör-listán, amíg nem nyit meg semmit", () => {
    const tile = navTileBlock(homeScreen());

    assert.match(
      tile,
      /enabled=\{false\}/,
      "A NAV csempe már megnyit valamit, tehát a szerep-listás ág indoka " +
        "elévült. A döntés a KÖZÖS FORRÁSBAN lakik " +
        "(`packages/types/src/navigation.ts`, a `nav-integration-mobile` tétel " +
        "`retiredBy` mezője): a láthatóság mostantól a hívásához tartozó " +
        "jogosultságból jöjjön, és ezzel a szerep-listás ág kiesik. Az itteni " +
        "`NAV_TILE_ROLES` visszaesés is vele megy.",
    );
  });
});

function homeScreen(): string {
  return readFileSync(HOME_SCREEN, "utf8");
}
