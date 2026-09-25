import { readFileSync } from "node:fs";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * A PARTNER PORTÁL "ESZKÖZÖK A MEDENCÉBEN" HOZZÁRENDELŐ FELÜLETE A SZERVER
 * SZÁMOLT `canAssignAssets` MEZŐJÉN ÁLL, NEM KLIENS-OLDALI JOGON.
 *
 * === MIÉRT KELL EZ A MEZŐ, ÉS MIÉRT NEM ELÉG A MEGLÉVŐ 403-VÉDELEM ===
 *
 * `service-assets.service.ts` `assignAquarium()`-ja (lásd
 * `asset-aquarium-assign-permission.spec.ts`) MÁR ellenőrzi a felhasználó-
 * kénti `AQUARIUM_ASSET_ASSIGN` képességet, ÍRÁSKOR. Ez elég ahhoz, hogy
 * illetéktelen hívó SOSE tudjon hozzárendelni -- de nem elég ahhoz, hogy a
 * PORTÁL GOMBJA eleve NE JELENJEN MEG annak, akinél nincs bejelölve. Balázs
 * kifejezett kérése (emlék 1843, 1847, acrobot msg_id 23679): "csak a
 * jelölővel rendelkezőnek látszik a gomb" -- ez egy MEGJELENÍTÉSI döntés,
 * és a klienshez a `MATERIAL_REQUEST_MARK_RECEIVED` mintája (próbálkozz,
 * kapj 403-at) nem illik, mert egy hozzárendelés/levétel valódi
 * mellékhatással jár, azt nem próbálgatjuk -- lásd `aquarium-assets.tsx`
 * fejlécét a portál oldalán.
 *
 * === A MEZŐ MINDEN, ÜGYFÉLNEK VISSZAADOTT AKVÁRIUM-ADATLAPON RAJTA VAN ===
 *
 * `AquariumDetail.canAssignAssets` KÖTELEZŐ mező (`packages/types`), tehát
 * `detail()`-en KÍVÜL a `create()`/`update()`/`addEquipment()`/
 * `removeEquipment()` válaszán is jelen kell lennie -- ezek mind
 * `AquariumDetail`-t adnak a kliensnek. Ha csak `detail()` töltené ki, a
 * többi válasz vagy fordítási hibával állna, vagy egy elnémított
 * típuskényszerítéssel a mező NÉMÁN `undefined` maradna éles válaszban.
 */
const SERVICE = "src/aquariums/aquariums.service.ts";
const REPOSITORY = "src/aquariums/aquariums.repository.ts";
const TYPES = "../../packages/types/src/aquarium-management.ts";

const olvas = (ut: string) => readFileSync(ut, "utf8");
const kod = (ut: string) =>
  olvas(ut)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("az akvárium-adatlap canAssignAssets mezője", () => {
  it("POZITÍV KONTROLL: mind a három fájl olvasható és nem üres", () => {
    for (const ut of [SERVICE, REPOSITORY, TYPES])
      assert.ok(olvas(ut).length > 300, `${ut}: üres vagy gyanúsan rövid`);
  });

  it("az AquariumDetail típus kötelezően viseli a canAssignAssets mezőt", () => {
    const s = kod(TYPES);
    assert.match(s, /canAssignAssets: boolean;/);
    // NEM opcionális (`canAssignAssets?:`) -- lásd a fájl fejlécét, miért
    // kell minden producer-nek kitöltenie.
    assert.doesNotMatch(s, /canAssignAssets\?: boolean/);
  });

  it("a repository hasAquariumAssetAssignCapability-je az AQUARIUM_ASSET_ASSIGN kapacitást kérdezi le", () => {
    const src = olvas(REPOSITORY);
    const i = src.indexOf("async hasAquariumAssetAssignCapability(");
    assert.notEqual(i, -1, "hasAquariumAssetAssignCapability nincs a repóban");
    const block = src.slice(i, i + 400);
    assert.match(block, /capability: "AQUARIUM_ASSET_ASSIGN"/);
  });

  /**
   * SZÁNDÉKOS DUPLIKÁCIÓ, NEM CROSS-MODULE IMPORT -- lásd a repository
   * metódus saját fejlécét az indokról. MI PIROSÍT: ha valaki a
   * `ServiceAssetsRepository`-t importálná ide, ami az aquariums modult a
   * service-assets modulhoz kötné egy generikus, két soros lekérdezésért.
   */
  it("az aquariums repository NEM importálja a service-assets modult", () => {
    const s = kod(REPOSITORY);
    assert.doesNotMatch(s, /service-assets/);
  });

  /**
   * A `withCanAssignAssets` MINDEN, ÜGYFÉLNEK VISSZAADOTT METÓDUSBAN
   * SZEREPEL. MI PIROSÍT: ha egy új vagy meglévő végpont visszatérne a
   * repository nyers válaszával, kihagyva a mezőt.
   */
  it("detail(), create(), update(), addEquipment() és removeEquipment() mind alkalmazza a withCanAssignAssets-et", () => {
    const s = kod(SERVICE);
    const helperIndex = s.indexOf("private async withCanAssignAssets");
    assert.notEqual(helperIndex, -1, "nincs withCanAssignAssets helper");

    for (const metodus of [
      "async detail(",
      "async create(",
      "async update(",
      "async addEquipment(",
      "async removeEquipment(",
    ]) {
      const i = s.indexOf(metodus);
      assert.notEqual(i, -1, `${metodus} nincs a service-ben`);
      // A METÓDUS TÖRZSÉT A KÖVETKEZŐ "  async "/"  private " kezdetig
      // vesszük -- durvább határ, mint egy zárójel-számláló, de a service
      // ezen a szinten nem ágyaz metódust metódusba, tehát elég pontos.
      const kovetkezo = s.indexOf("\n  async ", i + metodus.length);
      const block = s.slice(i, kovetkezo === -1 ? s.length : kovetkezo);
      assert.match(
        block,
        /withCanAssignAssets/,
        `${metodus} törzse nem hívja a withCanAssignAssets-et`,
      );
    }
  });

  /**
   * A HELPER A KAPACITÁST A HÍVÓ (user.id) SZERINT KÉRDEZI LE, NEM AZ
   * AKVÁRIUM VALAMELYIK MEZŐJE SZERINT -- egy `aquarium.id`-re tévedő
   * lekérdezés mindig ugyanazt az (értelmetlen) választ adná, függetlenül
   * attól, KI kéri le az adatlapot.
   */
  it("a withCanAssignAssets a hívó user.id-jét adja át a kapacitás-lekérdezésnek", () => {
    const s = kod(SERVICE);
    const i = s.indexOf("private async withCanAssignAssets");
    const end = s.indexOf("\n  }", i);
    const block = s.slice(i, end);
    assert.match(block, /hasAquariumAssetAssignCapability\(user\.id\)/);
  });
});
