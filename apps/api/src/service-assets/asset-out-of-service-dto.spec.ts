// A DTO dekoratorai `Reflect`-en at olvassak a metaadatot; az importnak a DTO
// modul kiertekelese ELE kell kerulnie.
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { AssetListQueryDto, UpdateAssetDto } from "./dto/asset.dto.js";

/**
 * AZ "UZEMEN KIVUL" A HTTP-KAPUN (Balazs kerese, 2026-09-30).
 *
 * Az integracios spec a vezerlot KOZVETLENUL hivja, tehat a `ValidationPipe`
 * ott nem fut: ha az ertek kimaradna a DTO engedelyezett listajarol, az a spec
 * zold maradna, mikozben a valodi PATCH 400-at adna. Ez a spec a kaput meri.
 */
/** A PATCH kotelezo utkozes-orzoje; a spec a `status` mezorol szol. */
const EXPECTED = "2026-09-30T12:00:00.000Z";
const statusErrors = (dto: object) =>
  validateSync(dto).filter((error) => error.property === "status");

describe("Üzemen kívül a DTO-kon", () => {
  it("a PATCH elfogadja", () => {
    const dto = plainToInstance(UpdateAssetDto, {
      status: "OUT_OF_SERVICE",
      expectedUpdatedAt: EXPECTED,
    });
    assert.deepEqual(validateSync(dto), []);
  });

  it("a lista szűrője elfogadja", () => {
    const dto = plainToInstance(AssetListQueryDto, {
      status: "OUT_OF_SERVICE",
    });
    assert.deepEqual(validateSync(dto), []);
  });

  it("KONTROLL: egy nem létező állapotot elutasít", () => {
    const dto = plainToInstance(UpdateAssetDto, {
      status: "BROKEN",
      expectedUpdatedAt: EXPECTED,
    });
    assert.equal(statusErrors(dto).length, 1);
    assert.equal(validateSync(dto).length, 1);
  });
});
