import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { IsBoolean, IsOptional, IsString, validate } from "class-validator";

import { IsOptionalNotNull } from "./is-optional-not-null.js";

/*
  A NEM-NULL OPCIONÁLIS MEZŐ DEKORÁTORA (task t-20261118-null-oro). A tapasztalat: a #2675-ön az `@IsOptional()` az explicit null-t is átengedte egy
  nem-null logikai oszlopig (500 a 400 helyett). MI PIROSÍT: ha a hiányzó mező (undefined) nem átmegy; ha a null átmegy; ha az érték típusát nem ellenőrzi.
*/
class WithNotNull {
  @IsOptionalNotNull() @IsBoolean() flag?: boolean;
  @IsOptionalNotNull() @IsString() text?: string;
}

/** SEMMI típus-ellenőrző: a dekorátor egyedül is zárja a null-t (barracuda, #2678). */
class Alone {
  @IsOptionalNotNull() anything?: string;
}

class WithPlainOptional {
  @IsOptional() @IsBoolean() flag?: boolean;
}

const errorsOf = async <T extends object>(type: new () => T, plain: object) =>
  (await validate(plainToInstance(type, plain))).map((e) => e.property);

describe("IsOptionalNotNull", () => {
  it("a hiányzó mező átmegy, az érvényes érték átmegy", async () => {
    assert.deepEqual(await errorsOf(WithNotNull, {}), []);
    assert.deepEqual(
      await errorsOf(WithNotNull, { flag: true, text: "x" }),
      [],
    );
    assert.deepEqual(await errorsOf(WithNotNull, { flag: false }), []);
  });

  it("a null NEM megy át (400), és a rossz típus sem", async () => {
    assert.deepEqual(await errorsOf(WithNotNull, { flag: null }), ["flag"]);
    assert.deepEqual(await errorsOf(WithNotNull, { text: null }), ["text"]);
    assert.deepEqual(await errorsOf(WithNotNull, { flag: "true" }), ["flag"]);
  });

  it("egyedül kitéve is zárja a null-t, és a hiányt, valamint minden más értéket átenged", async () => {
    assert.deepEqual(await errorsOf(Alone, { anything: null }), ["anything"]);
    assert.deepEqual(await errorsOf(Alone, {}), []);
    assert.deepEqual(await errorsOf(Alone, { anything: "x" }), []);
  });

  it("POZITÍV KONTROLL: a sima @IsOptional() a null-t átengedi (ez a veszély, amit a dekorátor zár)", async () => {
    assert.deepEqual(await errorsOf(WithPlainOptional, { flag: null }), []);
  });
});
