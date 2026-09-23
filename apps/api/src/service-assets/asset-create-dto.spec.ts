// A DTO dekoratorai `Reflect`-en at olvassak a metaadatot, amit az alkalmazas a
// `main.ts`-ben telepit. Egy egysegteszt enelkul indul, tehat az importnak a DTO
// modul kiertekelese ELE kell kerulnie.
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { CreateAssetDto } from "./dto/asset.dto.js";

/**
 * A MATRICAKOD A FELVITELI AGON IS A HATARON AKAD EL.
 *
 * === UGYANAZ A RES, EGGYEL ARREBB ===
 *
 * acrobot 2026-09-16-an megtalalta, hogy az `@IsOptional()` a `null`-t ugyanugy
 * kihagyja, mint az `undefined`-ot, es a modosito osztalyon be is zartuk. A
 * FELVITELI osztaly viszont valtozatlan maradt, es ott ugyanaz a lanc all:
 *
 *     labelCode: null  ->  nulla validacios hiba
 *                      ->  `input.labelCode === undefined` HAMIS
 *                      ->  `normalizeAssetLabelCode(null)` -> `raw.trim()`
 *                      ->  TypeError -> a `map` vegen `throw error` -> 500
 *
 * Merve ezen az osztalyon, ugyanazzal a modszerrel, mielott javitottam.
 *
 * ELES TORES NEM VOLT: a webes es a mobil kliens is `?? undefined` alakban
 * kuldi. A hatar viszont nyitva allt -- es a modosito osztaly megjegyzese azt
 * sugallta, hogy a csapda kezelve van.
 *
 * === MIERT A DTO, ES NEM A TAROLO ===
 *
 * Mert a dontes a HATARON van. Ha a tarolo fogna el, egy kesobbi
 * "egyszerusites" vissza `@IsOptional()`-re CSENDBEN ujranyitna a rest, es a
 * tarolo tesztjei zoldek maradnanak -- ok a normalizalt erteket kapjak.
 */
function uzenetek(torzs: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(CreateAssetDto, torzs)).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

/** A minimalis ervenyes torzs a felvitelhez. */
const ALAP = {
  ownerType: "CUSTOMER",
  ownerId: "customer-1",
  kind: "EQUIPMENT",
  name: "Szivattyú",
};

describe("az eszköz-felvitel matricakód mezője", () => {
  it("a HIÁNYZÓ mező rendben van: nincs matrica", () => {
    assert.deepEqual(uzenetek(ALAP), []);
  });

  it("az `undefined` ugyanaz, mint a hiányzó mező", () => {
    assert.deepEqual(uzenetek({ ...ALAP, labelCode: undefined }), []);
  });

  /** EZ AZ AZ ALLITAS, AMIERT A FAJL LETEZIK. */
  it("a `null` ELBUKIK, és nem jut el a tárolóig", () => {
    const uzenet = uzenetek({ ...ALAP, labelCode: null });
    assert.ok(
      uzenet.length > 0,
      "a null nem mehet át: a tárolóban TypeError lenne belőle, tehát 500",
    );
    assert.ok(
      uzenet.some((m) => m.includes("labelCode")),
      `a hibaüzenet nevezze meg a mezőt, most ez jött: ${uzenet.join("; ")}`,
    );
  });

  it("az érvényes kód átmegy", () => {
    assert.deepEqual(uzenetek({ ...ALAP, labelCode: "V2196" }), []);
  });

  /**
   * A TESTVEREI MARADNAK `@IsOptional()`-ON, ES EZ NEM KOVETKEZETLENSEG.
   *
   * A `model` es a `serialNumber` erteket az `optionalText` nyeli el, ami a
   * `null`-t kezeli. A matrica azert mas, mert a normalizaloja NEM. Ha ezt az
   * allitast valaki "egysegesitesbol" atirja, epp azt a kulonbseget tunteti
   * el, amiert a fenti szuro szigorubb.
   */
  it("a szöveges testvérek `null` értéke ÁTMEGY, mert őket más nyeli el", () => {
    assert.deepEqual(
      uzenetek({ ...ALAP, model: null, serialNumber: null }),
      [],
    );
  });

  /**
   * A TELJESITMENY-PAR `null` ERTEKE IS ATMEGY -- es ez SZANDEKOS.
   *
   * Felvitelnel nincs mit torolni, tehat a `null` annyit tesz: nem adtak meg.
   * A tarolo ezt KEZELI (`teljesitmenyEredmenye` kulon agon nezi a `null`-t),
   * ellentetben a matricakod normalizalojaval. A kulonbseg tehat nem a mezo
   * tipusaban van, hanem abban, hogy a FOGADO oldal felkeszult-e ra.
   */
  it("a teljesítmény-pár `null` értéke átmegy, mert a tároló kezeli", () => {
    assert.deepEqual(
      uzenetek({ ...ALAP, performance: null, performanceUnitId: null }),
      [],
    );
  });

  /**
   * POZITIV KONTROLL A MERESRE MAGARA.
   *
   * A fenti "atmegy" allitasok akkor is zoldek lennenek, ha a `validateSync`
   * ezen az osztalyon SOHA nem talalna semmit -- peldaul mert a
   * `reflect-metadata` import lemaradt.
   */
  it("POZITÍV KONTROLL: egy szám elbukik, tehát a mérés tényleg fut", () => {
    const uzenet = uzenetek({ ...ALAP, labelCode: 42 });
    assert.ok(uzenet.length > 0, "a validáció nem fut: a mérés semmit nem ér");
    assert.ok(uzenet.some((m) => m.includes("must be a string")));
  });
});

/**
 * AZ ÖT IDEGEN KULCS A FELVITELI ÁGON IS -- lásd a `asset-update-dto.spec.ts`
 * azonos című leírását a teljes indokért (kanban 66c161e0, murena mérése,
 * 2026-09-23). Itt nincs `null`-ág (felvitelnél nincs mit törölni), tehát a
 * két állapot, amit szét kell választani, a HIÁNYZÓ mező (érvényes: „nem
 * adták meg") és az ÜRES SZÖVEG (érvénytelen: idegen kulcs elé kerülne).
 *
 * acrobot kérte kifejezetten: a hiányzó mező is kapjon saját állítást, ne
 * csak az üres szöveg -- különben a következő olvasó nem látja, hogy a kettő
 * KÜLÖN eset.
 */
describe("az eszköz-felvitel öt idegen kulcsa (hely, alegység, akvárium, szülő, termékváltozat)", () => {
  it("a HIÁNYZÓ mező rendben van: nincs megadva", () => {
    assert.deepEqual(uzenetek(ALAP), []);
  });

  it("az ÜRES szöveg MIND AZ ÖTÖN elbukik, egyszerre küldve", () => {
    const uzenet = uzenetek({
      ...ALAP,
      customerAddressId: "",
      departmentId: "",
      aquariumId: "",
      parentAssetId: "",
      productVariantId: "",
    });
    assert.ok(uzenet.length > 0, "egyik sem mehet át üresen");
    for (const mezo of [
      "customerAddressId",
      "departmentId",
      "aquariumId",
      "parentAssetId",
      "productVariantId",
    ])
      assert.ok(
        uzenet.some((m) => m.includes(mezo)),
        `a(z) ${mezo} hibaüzenete hiányzik, most ez jött: ${uzenet.join("; ")}`,
      );
  });

  it("az érvényes azonosítók átmennek", () => {
    assert.deepEqual(
      uzenetek({
        ...ALAP,
        customerAddressId: "addr-1",
        departmentId: "dept-1",
        aquariumId: "aq-1",
        parentAssetId: "asset-1",
        productVariantId: "variant-1",
      }),
      [],
    );
  });

  it("POZITÍV KONTROLL: egy szám elbukik, tehát a mérés tényleg fut", () => {
    const uzenet = uzenetek({ ...ALAP, departmentId: 42 });
    assert.ok(uzenet.length > 0, "a validáció nem fut: a mérés semmit nem ér");
    assert.ok(uzenet.some((m) => m.includes("must be a string")));
  });
});
