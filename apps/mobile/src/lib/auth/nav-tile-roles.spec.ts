import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HOME_MODULES, launcherModules } from "../home/modules";
import { TILE_ENTRY, type TileCode } from "./tile-visibility";

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
 * `retiredBy` feltételének a BEKÖVETKEZÉSE észrevehető. *
 * ===================================================================
 * MOBILE HOME V1 (phase 1)
 * ===================================================================
 *
 * The `enabled` flag became `route` in `lib/home/modules.ts`: a module with no
 * screen has `route: null`, and it is no longer drawn at all (owner's answer
 * 4, 2026-10-02: "Olyan csempe ne legyen, ami sehova nem visz"). The decision
 * this file guards is unchanged; it is read from the table instead of from
 * the `<ModuleCard code="NAV" …/>` line that no longer exists.
 */

describe("a NAV csempe láthatóságának forrása", () => {
  /**
   * A KONTROLL A KERESÉSRE: the module this file is about exists in the table
   * and is still tied to its served navigation entry.
   */
  it("megtalálja a modult, amiről állít valamit", () => {
    assert.equal(HOME_MODULES.NAV.title, "NAV-szinkron");
    assert.equal(TILE_ENTRY.NAV, "nav-integration-mobile");
  });

  it("a csempe addig nem jelenik meg, amíg nem nyit meg semmit", () => {
    assert.equal(
      HOME_MODULES.NAV.route,
      null,
      "A NAV csempe már megnyit valamit, tehát a szerep-listás ág indoka " +
        "elévült. A döntés a KÖZÖS FORRÁSBAN lakik " +
        "(`packages/types/src/navigation.ts`, a `nav-integration-mobile` tétel " +
        "`retiredBy` mezője): a láthatóság mostantól a hívásához tartozó " +
        "jogosultságból jöjjön, és ezzel a szerep-listás ág kiesik.",
    );
    // And while it has no screen, not even a served entry draws it.
    const mindenKiszolgalva = (_kod: TileCode) => true;
    assert.ok(!launcherModules(mindenKiszolgalva).includes("NAV"));
  });
});
