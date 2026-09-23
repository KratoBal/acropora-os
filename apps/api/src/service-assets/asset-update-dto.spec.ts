// A DTO dekoratorai `Reflect`-en at olvassak a metaadatot, amit az alkalmazas a
// `main.ts`-ben telepit. Egy egysegteszt enelkul indul, tehat az importnak a DTO
// modul kiertekelese ELE kell kerulnie.
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { UpdateAssetDto } from "./dto/asset.dto.js";

/**
 * A MATRICAKOD A HATARON AKAD EL, NEM A TAROLOBAN.
 *
 * === A MERT HIBA (acrobot, 2026-09-16, a #715 atvetelekor) ===
 *
 * A mezo `@IsString() @IsOptional()` alakban allt, a megjegyzese pedig azt
 * igerte, hogy egy `null` "hangosan elbukik a validacion". NEM BUKOTT EL: az
 * `@IsOptional()` dokumentalt viselkedese, hogy a `null`-t UGYANUGY kihagyja,
 * mint az `undefined`-ot.
 *
 * A kovetkezmeny nem elmeleti volt. A `null` igy eljutott a taroloig, ahol
 * `input.labelCode !== undefined` IGAZ ra, a `normalizeAssetLabelCode` pedig
 * `raw.trim()`-et hiv rajta -- `TypeError`, amit a szolgaltatas `map`
 * fuggvenye a vegen tovabbdob. Vagyis **500 lett belole, nem 400**.
 *
 * ES A `null` NEM KITALALT ESET: az `UpdateAssetDto` MINDEN testvere
 * `string | null`, es a webes szerkeszto minden szoveges mezore ezt az alakot
 * kuldi (`serialNumber.trim() || null`). A termeszetes, a szomszedaival egyezo
 * alak volt az, ami 500-at adott.
 *
 * === MIERT EZ A FAJL, ES MIERT NEM A TAROLO TESZTJE ===
 *
 * Mert a dontes a HATARON van. Ha a tarolo fogna el, ugyanez a vedelem allna,
 * de egy `@IsOptional()`-re visszaegyszerusites CSENDBEN ujranyitna a rest --
 * es a tarolo tesztjei tovabbra is zoldek lennenek, hiszen ok a normalizalt
 * erteket kapjak. Ez a spec a DTO-t meri, ott, ahol a dontes all.
 */

function uzenetek(torzs: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(UpdateAssetDto, torzs)).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

/** A minimalis ervenyes torzs: a verzio-belyeg kotelezo. */
const ALAP = { expectedUpdatedAt: "2026-09-16T10:00:00.000Z" };

describe("az eszköz-módosítás matricakód mezője", () => {
  it("a HIÁNYZÓ mező rendben van: azt jelenti, ne nyúlj hozzá", () => {
    assert.deepEqual(uzenetek(ALAP), []);
  });

  it("az `undefined` ugyanaz, mint a hiányzó mező", () => {
    assert.deepEqual(uzenetek({ ...ALAP, labelCode: undefined }), []);
  });

  /**
   * EZ AZ AZ ALLITAS, AMIERT A FAJL LETEZIK.
   *
   * A `null` a tobbi mezon "toroljed"-et jelent; a matricat viszont ezen az
   * uton nem lehet leszedni. Tehat vagy elutasitjuk a HATARON, vagy csendben
   * mast csinalunk, mint amit a hivo ker. Az elsot valasztottuk.
   */
  it("a `null` ELBUKIK, és nem jut el a tárolóig", () => {
    const uzenet = uzenetek({ ...ALAP, labelCode: null });
    assert.ok(
      uzenet.length > 0,
      "a null nem mehet at: a tárolóban TypeError lenne belőle, tehát 500",
    );
    // A MONDAT IS SZAMIT: a hivonak meg kell tudnia, MELYIK mezovel van baj.
    assert.ok(
      uzenet.some((m) => m.includes("labelCode")),
      `a hibaüzenet nevezze meg a mezőt, most ez jött: ${uzenet.join("; ")}`,
    );
  });

  /**
   * AZ URES SZOVEG ATMEGY A HATARON -- ES EZ SZANDEKOS, NEM RES.
   *
   * Az alak-ellenorzes a szolgaltatase (`normalizeAssetLabelCode`), egy helyen
   * az egesz rendszerben. Az ures szoveg ott adja a 400-at, ugyanazzal a
   * mondattal, mint minden mas rossz alak. Ha a DTO is dontene rola, ket minta
   * allna ugyanarra -- epp az, amit a mezo megjegyzese tilt.
   */
  it("az ÜRES szöveg a határon átmegy, mert az alakról a szolgáltatás dönt", () => {
    assert.deepEqual(uzenetek({ ...ALAP, labelCode: "" }), []);
  });

  it("az érvényes kód átmegy", () => {
    assert.deepEqual(uzenetek({ ...ALAP, labelCode: "V2196" }), []);
  });

  /**
   * POZITIV KONTROLL A MERESRE MAGARA.
   *
   * A fenti negy "atmegy" allitas akkor is zold lenne, ha a `validateSync`
   * ezen az osztalyon SOHA nem talalna semmit -- peldaul mert a `reflect-metadata`
   * import lemaradt, es a dekoratorok metaadata sehol nincs. Ez a sor mondja
   * ki, hogy a mero eszkoz MUKODIK.
   */
  it("POZITÍV KONTROLL: egy szám elbukik, tehát a mérés tényleg fut", () => {
    const uzenet = uzenetek({ ...ALAP, labelCode: 42 });
    assert.ok(uzenet.length > 0, "a validáció nem fut: a mérés semmit nem ér");
    assert.ok(uzenet.some((m) => m.includes("must be a string")));
  });
});

/**
 * A KATEGÓRIA ÉS A FUNKCIÓ -- A `null` ITT AZ ELLENKEZŐJE ANNAK, AMI FENTEBB
 * A MATRICAKÓDNÁL ÁLLT, ÉS EZ SZÁNDÉKOS, NEM ELLENTMONDÁS.
 *
 * A matricánál a `null` bukik el (nincs "leszedés" esemény), az ÜRES SZÖVEG
 * megy át (az alakról a szolgáltatás dönt). Itt PONT FORDÍTVA: a `null`
 * megy át (törli a kötést), az ÜRES SZÖVEG bukik el.
 *
 * === A MÉRT HIBA (acrobot, 2026-09-23, a #1030 átvételekor) ===
 *
 * A repository korábban `input.categoryId || null` alakban állt, ami az
 * `undefined`-et (a mező elhagyását) IS `null`-ra vitte -- élesben 45 FANK
 * szelepen tűnt el kétszer a kategória/funkció, ugyanezen a végponton. A
 * javítás a DTO-értéket közvetlenül adja tovább, ÚGY VISZONT az `""` a
 * repositoryból változatlanul a Prisma elé jutna, ahol az idegen kulcs
 * szabálya nem talál `""` azonosítójú sort -- ez adatbázis-hibát, 500-at
 * adna, nem 400-at. A `@MinLength(1)` a DTO-n zárja le ezt a rést, MIELŐTT
 * a kérdés a tárolóig jutna.
 */
describe("az eszköz-módosítás kategória és funkció mezője", () => {
  it("a HIÁNYZÓ mező rendben van: azt jelenti, ne nyúlj hozzá", () => {
    assert.deepEqual(uzenetek(ALAP), []);
  });

  it("az `undefined` ugyanaz, mint a hiányzó mező", () => {
    assert.deepEqual(uzenetek({ ...ALAP, categoryId: undefined }), []);
  });

  /**
   * EZ AZ AZ ALLITAS, AMIERT A HATAR A DTO DOLGA: a `null` TOVÁBBRA IS
   * ENGEDETT -- ez a mező kötésének törlése, és ez a mezőnek LÉTEZŐ,
   * használt útja, ellentétben a matricakóddal.
   */
  it("a `null` ÁTMEGY: ez törli a kötést", () => {
    assert.deepEqual(uzenetek({ ...ALAP, categoryId: null }), []);
  });

  /**
   * EZ AZ ÚJ ELUTASÍTÁS. A `""` korábban csendben `null`-lá vált a
   * repositoryban; a repository-javítás után enélkül a DTO nélkül a
   * Prisma elé jutna, változatlanul -- lásd a fájl fejlécét.
   */
  it("az ÜRES szöveg ELBUKIK: nem mehet a tárolóig", () => {
    const uzenet = uzenetek({ ...ALAP, categoryId: "" });
    assert.ok(
      uzenet.length > 0,
      "az üres szöveg nem mehet át: a tárolóban idegen kulcs hiba lenne belőle, tehát 500",
    );
    assert.ok(
      uzenet.some((m) => m.includes("categoryId")),
      `a hibaüzenet nevezze meg a mezőt, most ez jött: ${uzenet.join("; ")}`,
    );
  });

  it("az érvényes azonosító átmegy", () => {
    assert.deepEqual(uzenetek({ ...ALAP, categoryId: "cat-1" }), []);
  });

  it("POZITÍV KONTROLL: egy szám elbukik, tehát a mérés tényleg fut", () => {
    const uzenet = uzenetek({ ...ALAP, categoryId: 42 });
    assert.ok(uzenet.length > 0, "a validáció nem fut: a mérés semmit nem ér");
    assert.ok(uzenet.some((m) => m.includes("must be a string")));
  });

  /**
   * A `functionId` UGYANAZT AZ ALAKOT KÖVETI, ÉS A DTO FEJLÉCE EZT KI IS
   * MONDJA ("ugyanaz az alak, mint a categoryId-nél"). Ez az állítás nem a
   * teljes esetlistát ismétli meg -- azt a fenti hat `it` már megméri --,
   * hanem azt, hogy a KÉT MEZŐ TÉNYLEG EGYFORMÁN viselkedik, ugyanazon a
   * bemeneten: ha valaki csak a `categoryId`-t javítaná, a `functionId`
   * csendben lemaradna.
   */
  it("a functionId ugyanígy: null átmegy, üres szöveg elbukik", () => {
    assert.deepEqual(uzenetek({ ...ALAP, functionId: null }), []);
    const uzenet = uzenetek({ ...ALAP, functionId: "" });
    assert.ok(uzenet.length > 0, "az üres functionId nem mehet át");
    assert.ok(uzenet.some((m) => m.includes("functionId")));
  });
});
