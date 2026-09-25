import { readFileSync } from "node:fs";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * AZ ESZKÖZ-AKVÁRIUM HOZZÁRENDELÉS KÜLÖN JOGOT KÉR, NEM A `SERVICE_MANAGE`-ET
 * -- ugyanaz a minta, mint az `aquarium-permission.spec.ts`.
 *
 * === MIÉRT KÜLÖN FÁJL, NEM A MEGLÉVŐ `service-assets.partner-write-scope.spec.ts`-BE ===
 *
 * Az a fájl a HATÓKÖRT méri (a partner a saját eszközét éri-e el) --
 * mock-olt `ServiceAssetsService`-en és `ServiceAssetsRepository`-n, mert a
 * hatókör-döntés a SZOLGÁLTATÁS-RÉTEGBEN lakik. Ez a fájl a JOGOT méri: a
 * VEZÉRLŐ melyik dekorátort viseli, és hogy a szűk DTO-n túl semmi mást nem
 * enged át a hívó felé. A kettő KÉT KÜLÖN TENGELY (lásd
 * `route-permission-coverage.spec.ts` fejlécét), és ez a fájl csak a
 * másodikról szól -- a hatókört az `update()` már bizonyítottan helyesen
 * kezeli (`requireAssetInScope`, `validateReferences`), azt nem ismétli meg.
 */
const CONTROLLER = "src/service-assets/service-assets.controller.ts";
const DTO = "src/service-assets/dto/asset.dto.ts";

const olvas = (ut: string) => readFileSync(ut, "utf8");

describe("eszköz-akvárium hozzárendelés: jog és DTO", () => {
  it("POZITÍV KONTROLL: mind a két fájl olvasható és nem üres", () => {
    for (const ut of [CONTROLLER, DTO])
      assert.ok(olvas(ut).length > 500, `${ut}: üres vagy gyanúsan rövid`);
  });

  /**
   * MI PIROSÍT: ha a `:id/aquarium` útvonal `SERVICE_MANAGE`-et kérne (amit
   * MA minden `PARTNER_SERVICE` fiók visel) a dedikált
   * `SERVICE_ASSET_AQUARIUM_ASSIGN` helyett -- akkor a "külön jog" döntés
   * (emlék 1843) csendben elveszne, a végpont ugyanúgy nyitva állna minden
   * partner-fióknak, mint az általános `PATCH :id`.
   */
  it("a :id/aquarium útvonal SERVICE_ASSET_AQUARIUM_ASSIGN-t kér", () => {
    const src = olvas(CONTROLLER);
    const i = src.indexOf('@Patch(":id/aquarium")');
    assert.notEqual(i, -1, '@Patch(":id/aquarium") nincs a vezérlőben');
    const decorator = /@RequirePermissions\(PERMISSIONS\.([A-Z_]+)\)/.exec(
      src.slice(i, i + 200),
    );
    assert.ok(decorator, "nincs RequirePermissions dekorátor a route után");
    assert.equal(decorator[1], "SERVICE_ASSET_AQUARIUM_ASSIGN");
  });

  /**
   * A VEZÉRLŐ A MEGLÉVŐ `service.update()`-ot HÍVJA, NEM ÚJ METÓDUST --
   * ez a hatókör- és ütközés-védelem öröklésének a garanciája. MI PIROSÍT:
   * ha valaha egy ÚJ, saját `assignAquarium`-szerű service metódus váltaná
   * fel, ami esetleg elfelejtené a `requireAssetInScope`-ot vagy a
   * `expectedUpdatedAt`-ot.
   */
  it("a vezérlő a meglévő service.update()-ot hívja, csak aquariumId-vel és expectedUpdatedAt-tal", () => {
    const src = olvas(CONTROLLER);
    const i = src.indexOf('@Patch(":id/aquarium")');
    const block = src.slice(i, i + 600);
    assert.match(
      block,
      /this\.service\.update\(\s*id,\s*\{\s*aquariumId: input\.aquariumId,\s*expectedUpdatedAt: input\.expectedUpdatedAt,\s*\},\s*user\.id,\s*user,\s*\)/,
    );
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
});
