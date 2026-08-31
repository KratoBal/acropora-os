// A DTO dekoratorokat hasznal, amik a `Reflect.getMetadata` fuggvenyt keresik.
// A sorrend szamit: ez a sor a DTO behuzasa ELOTT.
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { AssetListQueryDto } from "./dto/asset.dto.js";

/**
 * A KÉT ALAK A VALÓDI VALIDÁCIÓS ÚTON, NEM A TISZTA FÜGGVÉNYEN.
 *
 * MIÉRT KELL, HA A `toIdList`-nek MÁR VAN TESZTJE: az a függvényt méri, ezek a
 * BEKÖTÉST. Egy helyes normalizáló és egy oda nem kötött `@Transform` együtt is
 * zöld egységtesztet ad -- a hiba csak akkor jönne elő, amikor a végpont
 * tényleg megkapja a kérést.
 *
 * A beállítás ugyanaz, amit a `configureApp` használ (`transform`, `whitelist`,
 * `forbidNonWhitelisted`), mert egy másik beállítással mért eredmény nem erről
 * a rendszerről szólna.
 */
function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(AssetListQueryDto, query, {
    enableImplicitConversion: false,
  });
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, errors };
}

describe("the unit filter on the real validation path", () => {
  it("wires the transform to the plural field", () => {
    const { dto, errors } = parse({ departmentIds: ["a", "b"] });
    assert.deepEqual(errors, []);
    assert.deepEqual(dto.departmentIds, ["a", "b"]);
  });

  it("accepts the comma separated form through the same path", () => {
    const { dto, errors } = parse({ departmentIds: "a,b" });
    assert.deepEqual(errors, []);
    assert.deepEqual(dto.departmentIds, ["a", "b"]);
  });

  it("keeps a single value working", () => {
    const { dto, errors } = parse({ departmentId: "a" });
    assert.deepEqual(errors, []);
    assert.equal(dto.departmentId, "a");
  });

  /**
   * A MÁSIK ALAK RÖGZÍTÉSE, ÉS EZ A TESZT LÉTEZÉSÉNEK A FŐ OKA.
   *
   * A singularis mező `string` marad, tehát egy ISMÉTELT `departmentId` ma
   * validációs hibát ad -- NEM veszi csendben az egyiket. Ezt azért kell
   * kimondani, mert a többes alak bevezetése pont ezt tudná elmozdítani: ha
   * valaki később a `departmentId`-t is megnyitná tömbre, a mai hangos hiba
   * NÉMA elfogadássá válna, és a kliens azt hinné, mindkét értéke számít.
   *
   * (A mai viselkedést nautilus mérte meg 2026-08-31-én, ugyanezen az úton.)
   */
  it("still refuses a repeated singular parameter instead of taking one silently", () => {
    const { errors } = parse({ departmentId: ["a", "b"] });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.property, "departmentId");
  });
});
