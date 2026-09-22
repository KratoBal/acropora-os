// A DTO dekoratorai a `Reflect` metaadatain at olvasnak, amit az alkalmazas a
// `main.ts`-ben telepit. Egy egysegteszt enelkul indul, tehat ez az import
// KOTELEZOEN elsokent all, meg a DTO modulja elott.
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { AssetListQueryDto } from "./dto/asset.dto.js";

/**
 * A KATEGORIA-SZURO KAPUJA, NEM A LOGIKAJA.
 *
 * A `assetCategoryWhere` kulon meg van merve: mit epit a ket kerdesbol. Amit AZ
 * nem mond meg, az az, hogy a ket mezo egyaltalan ATJUT-E a validalason -- egy
 * `@IsIn` nelkuli mezo barmit atenged, es a szemet ertek csak a Prisma
 * hataran derulne ki, futasidoben.
 *
 * ES A KAPU HIANYA ITT NEM CSAK CSUNYA: a `category` erteket a where-epito
 * HAROMFELE olvassa (`"with"`, `"without"`, minden mas: nincs szures). Egy
 * elgepelt `withuot` tehat NEM hibat adna, hanem CSENDBEN kikapcsolna a
 * szurest -- a kezelo azt latna, hogy a szuro nem csinal semmit.
 */

function panaszok(input: unknown): string[] {
  const dto = plainToInstance(AssetListQueryDto, input);
  return validateSync(dto).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

describe("asset list category query", () => {
  it("KONTROLL: a kategoria nelkuli lekerdezes valtozatlanul atmegy", () => {
    assert.deepEqual(panaszok({}), []);
  });

  it("elfogadja a `without` erteket", () => {
    assert.deepEqual(panaszok({ category: "without" }), []);
  });

  it("elfogadja a `with` erteket", () => {
    assert.deepEqual(panaszok({ category: "with" }), []);
  });

  it("elfogadja a kategoria azonositojat", () => {
    assert.deepEqual(panaszok({ categoryId: "cat-szivattyu" }), []);
  });

  /**
   * A KETTO EGYUTT IS MEHET, es ez nem elnezes: a where-epito `AND`-del koti
   * oket. A „van kategoriaja ES ez az" kerdes onmagaban keves ertelmu, de a
   * TILTASA tobbe kerulne, mint amennyit er -- es a where-epito sajat specje
   * pont azt meri, hogy ilyenkor sem irja felul az egyik a masikat.
   */
  it("a ket mezo EGYUTT is elfogadott", () => {
    assert.deepEqual(panaszok({ category: "with", categoryId: "cat-1" }), []);
  });

  /**
   * EZ AZ AZ ALLITAS, AMIERT AZ EGESZ FAJL LETEZIK. Az `@IsIn` nelkul ez a sor
   * zold lenne, es a hibas ertek CSENDBEN kikapcsolna a szurest.
   */
  it("elutasitja a harmadik erteket", () => {
    assert.ok(
      panaszok({ category: "withuot" }).length > 0,
      "az elgepelt ertek nem juthat at a kapun",
    );
  });

  it("elutasitja a nem szoveges azonositot", () => {
    assert.ok(panaszok({ categoryId: 42 }).length > 0);
  });
});
