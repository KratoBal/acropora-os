import { readFileSync } from "node:fs";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * AZ ESZKÖZ-AKVÁRIUM HOZZÁRENDELÉS `SERVICE_MANAGE` ALATT ÁLL, DE EGY
 * MÁSODIK, FELHASZNÁLÓNKÉNTI KÉPESSÉGGEL SZŰKÍTVE.
 *
 * === A MECHANIZMUS MEGVÁLTOZOTT (emlék 1843, majd 1847) ===
 *
 * Balázs első döntése (1843, 2026-09-25 14:24 UTC) alapján ez a fájl
 * eredetileg egy DEDIKÁLT, szerep-szintű jogot (`SERVICE_ASSET_AQUARIUM_
 * ASSIGN`) mért. Balázs pontosított (1847, 16:12 UTC): a kért minta
 * FELHASZNÁLÓNKÉNTI jelölő, ugyanaz, mint a `MATERIAL_REQUEST_MARK_
 * RECEIVED` (`ServiceCapability`/`UserServiceCapability`) -- NEM
 * szerep-szintű jog, mert a `PARTNER_SERVICE` szerep MÁR MA viseli a
 * `SERVICE_MANAGE`-et, tehát egy szerep-szintű bővítés AZONNAL minden
 * partner-fióknak megnyitná a képességet.
 *
 * === MIÉRT KÜLÖN FÁJL, NEM A MEGLÉVŐ `service-assets.partner-write-scope.spec.ts`-BE ===
 *
 * Az a fájl a HATÓKÖRT méri (a partner a saját eszközét éri-e el) --
 * mock-olt `ServiceAssetsService`-en és `ServiceAssetsRepository`-n, mert a
 * hatókör-döntés a SZOLGÁLTATÁS-RÉTEGBEN lakik. Ez a fájl a JOGOT/
 * KÉPESSÉGET méri: a VEZÉRLŐ melyik dekorátort viseli, a SERVICE-réteg
 * ellenőrzi-e a kapacitást a `update()` hívása ELŐTT, és hogy a szűk
 * DTO-n túl semmi mást nem enged át a hívó felé. Két külön tengely (lásd
 * `route-permission-coverage.spec.ts` fejlécét), és ez a fájl csak a
 * másodikról szól -- a hatókört az `update()` már bizonyítottan helyesen
 * kezeli (`requireAssetInScope`, `validateReferences`), azt nem ismétli meg.
 */
const CONTROLLER = "src/service-assets/service-assets.controller.ts";
const SERVICE = "src/service-assets/service-assets.service.ts";
const REPOSITORY = "src/service-assets/service-assets.repository.ts";
const DTO = "src/service-assets/dto/asset.dto.ts";

const olvas = (ut: string) => readFileSync(ut, "utf8");

describe("eszköz-akvárium hozzárendelés: jog, kapacitás és DTO", () => {
  it("POZITÍV KONTROLL: mind a négy fájl olvasható és nem üres", () => {
    for (const ut of [CONTROLLER, SERVICE, REPOSITORY, DTO])
      assert.ok(olvas(ut).length > 500, `${ut}: üres vagy gyanúsan rövid`);
  });

  /**
   * MI PIROSÍT: ha a `:id/aquarium` útvonal BÁRMILYEN MÁS jogot kérne, mint
   * `SERVICE_MANAGE` -- az azt jelentené, hogy a tényleges szűkítés
   * (a kapacitás-ellenőrzés) elmaradt, VAGY hogy egy szerep-szintű jogot
   * vezettünk vissza, amit Balázs kifejezetten elutasított.
   */
  it("a :id/aquarium útvonal SERVICE_MANAGE-et kér (a szűkítés a service-rétegben van)", () => {
    const src = olvas(CONTROLLER);
    const i = src.indexOf('@Patch(":id/aquarium")');
    assert.notEqual(i, -1, '@Patch(":id/aquarium") nincs a vezérlőben');
    const decorator = /@RequirePermissions\(PERMISSIONS\.([A-Z_]+)\)/.exec(
      src.slice(i, i + 200),
    );
    assert.ok(decorator, "nincs RequirePermissions dekorátor a route után");
    assert.equal(decorator[1], "SERVICE_MANAGE");
  });

  /**
   * MI PIROSÍT: ha a vezérlő közvetlenül `service.update()`-ot hívna a
   * kapacitás-ellenőrzés kihagyásával -- akkor a végpont ténylegesen
   * `SERVICE_MANAGE`-re szűkülne, vagyis MINDEN `PARTNER_SERVICE` fióknak
   * nyitva állna, ugyanaz a rés, amit a mai mechanizmus el akar kerülni.
   */
  it("a vezérlő a service.assignAquarium()-ot hívja, nem közvetlenül update()-ot", () => {
    const src = olvas(CONTROLLER);
    const i = src.indexOf('@Patch(":id/aquarium")');
    const block = src.slice(i, i + 400);
    assert.match(
      block,
      /this\.service\.assignAquarium\(id, input, user\.id, user\)/,
    );
  });

  /**
   * A SERVICE-RÉTEG TÉNYLEGESEN ELLENŐRZI A KAPACITÁST, `update()` HÍVÁSA
   * ELŐTT, ÉS ELUTASÍTJA, HA HIÁNYZIK.
   *
   * MI PIROSÍT: ha az ellenőrzés hiányozna, vagy ha `update()` a
   * kapacitás-ellenőrzés ELŐTT futna le (ami azt jelentené, hogy a hívó a
   * mellékhatást -- az írást -- akkor is elérné, ha utána a kapacitás
   * hiánya miatt dobnánk).
   */
  it("a service.assignAquarium() a hasAquariumAssetAssignCapability-t ellenőrzi update() előtt, és 403-at dob, ha hiányzik", () => {
    const src = olvas(SERVICE);
    const i = src.indexOf("async assignAquarium(");
    assert.notEqual(i, -1, "assignAquarium nincs a service-ben");
    const end = src.indexOf("\n  }", i);
    const block = src.slice(i, end);
    const kapacitasSor = block.indexOf("hasAquariumAssetAssignCapability");
    const forbiddenSor = block.indexOf("ForbiddenException");
    const updateSor = block.indexOf("this.update(");
    assert.ok(kapacitasSor !== -1, "nincs kapacitás-ellenőrzés");
    assert.ok(forbiddenSor !== -1, "nincs ForbiddenException a hiány esetére");
    assert.ok(updateSor !== -1, "nincs this.update() hívás");
    assert.ok(
      kapacitasSor < forbiddenSor && forbiddenSor < updateSor,
      "a sorrend nem kapacitás -> elutasítás -> update()",
    );
  });

  /**
   * A REPOSITORY A VALÓDI ENUM-ÉRTÉKET KÉRDEZI LE, NEM EGY ELGÉPELTET --
   * ez azért kell külön állításnak, mert egy rossz string csendben mindig
   * `null`-t (nincs bejelölve) adna vissza, tehát a hiba a KAPACITÁSSAL
   * RENDELKEZŐ hívónál is 403-at eredményezne, sosem a hiányzónál.
   */
  it("a repository az AQUARIUM_ASSET_ASSIGN kapacitást kérdezi le", () => {
    const src = olvas(REPOSITORY);
    const i = src.indexOf("async hasAquariumAssetAssignCapability(");
    assert.notEqual(i, -1, "hasAquariumAssetAssignCapability nincs a repóban");
    const block = src.slice(i, i + 400);
    assert.match(block, /capability: "AQUARIUM_ASSET_ASSIGN"/);
  });

  /**
   * A DTO CSAK KÉT MEZŐT ISMER -- ha bővülne, a kliens (a portál) más
   * mezőt is küldhetne, és a "szűk végpont" garancia elveszne.
   */
  it("az AssignAssetAquariumDto csak aquariumId-t és expectedUpdatedAt-ot ismer", () => {
    const src = olvas(DTO);
    const i = src.indexOf("export class AssignAssetAquariumDto");
    assert.notEqual(i, -1, "AssignAssetAquariumDto nincs a fájlban");
    const end = src.indexOf("}", i);
    const block = src.slice(i, end);
    const mezok = [...block.matchAll(/(\w+)!:/g)].map((m) => m[1]);
    assert.deepEqual(mezok.sort(), ["aquariumId", "expectedUpdatedAt"]);
  });

  /**
   * A `null` ÉRVÉNYES, AZ `undefined` HIBA -- `@ValidateIf`, NEM
   * `@IsOptional()`. Lásd az `UpdateAssetDto` `labelCode` mezőjének
   * fejlécét a mért, valós hibáról, amit ez a minta előz meg (egy `null`,
   * ami `@IsOptional()` mellett átment volna a validáción, és lentebb
   * TypeError-t dobott volna).
   */
  it("az aquariumId @ValidateIf-fel megy, nem @IsOptional()-lel", () => {
    const src = olvas(DTO);
    const i = src.indexOf("export class AssignAssetAquariumDto");
    const end = src.indexOf("}", i);
    const block = src.slice(i, end);
    assert.match(block, /@ValidateIf\(\(_object, value\) => value !== null\)/);
    assert.doesNotMatch(block, /@IsOptional\(\)/);
  });

  /**
   * KONTROLL: A `SERVICE_ASSET_AQUARIUM_ASSIGN` NÉV SEHOL NEM MARADT BENT
   * -- ha maradt volna, az azt jelentené, hogy a régi, szerep-szintű
   * mechanizmus RÉSZBEN életben van, két párhuzamos (és ellentmondó)
   * kapuval.
   */
  it("KONTROLL: a régi, szerep-szintű jog neve sehol nem maradt a vezérlőben vagy a service-ben", () => {
    assert.doesNotMatch(olvas(CONTROLLER), /SERVICE_ASSET_AQUARIUM_ASSIGN/);
    assert.doesNotMatch(olvas(SERVICE), /SERVICE_ASSET_AQUARIUM_ASSIGN/);
  });
});
