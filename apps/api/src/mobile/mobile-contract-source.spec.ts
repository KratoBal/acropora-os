import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dtoMezok } from "./mobile-contract-source.js";

/**
 * `dtoMezok()` KIOLVASÁSÁT MÉRI, NEM VALÓDI DTO-N -- szándékosan, mert a
 * két hívó (`mobile-request-body.spec.ts`, `mobile-request-call-site.spec.ts`)
 * mindig egy ÉLŐ DTO-t ad neki, és egy ott piros lelet nem különbözteti meg
 * "a mezőt nem küldi a mobil" és "a kiolvasás nem látja" -- lásd a
 * `dtoMezok()` saját fejlécét, mit fedez ez a fájl 2026-09-24 óta.
 */
const MINTA = `
export class MintaDto {
  @IsString() nev: string;
  @IsOptional() @IsBoolean() zaszlo = false;
  @IsOptional() @IsInt() darab: number = 1;
}
`;

describe("dtoMezok", () => {
  it("a ':' alakú mezőt látja", () => {
    assert.ok(dtoMezok(MINTA, "MintaDto").has("nev"));
  });

  /**
   * EZ AZ ÁLLÍTÁS BUKOTT VOLNA A JAVÍTÁS ELŐTT: a `zaszlo` mező típus-jelölés
   * nélkül áll (`= false;`), ugyanaz az alak, mint a valódi
   * `CreateAquariumDto.systemVolumeIsManual` volt 2026-09-24 előtt.
   */
  it("a '=' alakú, TÍPUS-JELÖLÉS NÉLKÜLI mezőt is látja", () => {
    assert.ok(dtoMezok(MINTA, "MintaDto").has("zaszlo"));
  });

  it("a '=' alakú, típus-jelöléssel ELLÁTOTT mezőt is látja", () => {
    assert.ok(dtoMezok(MINTA, "MintaDto").has("darab"));
  });

  /**
   * KALIBRÁCIÓ: a régi ':'-ra váró minta itt PONTOSAN a `zaszlo`-t hagyta
   * volna ki, tehát ez az állítás két mezőt találna három helyett.
   */
  it("kalibráció: mind a három mező megvan, pontosan három", () => {
    assert.deepEqual([...dtoMezok(MINTA, "MintaDto")].sort(), [
      "darab",
      "nev",
      "zaszlo",
    ]);
  });
});
