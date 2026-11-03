import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  CreateAttributeSetDto,
  SetProductAttributeSetDto,
} from "./dto/attribute-set.dto.js";

/*
  A KÖTÉS TÖRZSE (barracuda, #2100 review): az `attributeSetId` kulcs KÖTELEZŐ, a `null` megengedett.
  MI PIROSÍT: ha egy üres törzs (`{}`) vagy egy elgépelt kulcs (`attributeSetID`) átmenne, és a
  kötés csendben leválna (egy kliens-hiba adatot törölne, és sikert jelezne); ha a kifejezett
  `null` nem menne (nincs mód a levételre); ha egy nem szöveg érték átmenne.
*/
const errorsOf = async (body: unknown) =>
  (
    await validate(plainToInstance(SetProductAttributeSetDto, body as object))
  ).map((e) => e.property);

describe("SetProductAttributeSetDto", () => {
  it("an empty body, a misspelled key and an undefined value are refused", async () => {
    assert.deepEqual(await errorsOf({}), ["attributeSetId"]);
    assert.deepEqual(await errorsOf({ attributeSetID: "set-1" }), [
      "attributeSetId",
    ]);
    assert.deepEqual(await errorsOf({ attributeSetId: undefined }), [
      "attributeSetId",
    ]);
  });

  it("an explicit null unbinds; a string binds; a non-string value is refused", async () => {
    assert.deepEqual(await errorsOf({ attributeSetId: null }), []);
    assert.deepEqual(await errorsOf({ attributeSetId: "set-1" }), []);
    assert.deepEqual(await errorsOf({ attributeSetId: 5 }), ["attributeSetId"]);
    assert.deepEqual(await errorsOf({ attributeSetId: "x".repeat(101) }), [
      "attributeSetId",
    ]);
  });
});

describe("CreateAttributeSetDto", () => {
  it("needs a key, a name and the attribute list, and checks each attribute key's shape", async () => {
    const valid = {
      key: "water_treatment",
      name: "Vízkezelő szerek",
      attributes: [{ attributeKey: "volume", required: true }],
    };
    assert.deepEqual(
      (await validate(plainToInstance(CreateAttributeSetDto, valid))).length,
      0,
    );
    const broken = await validate(
      plainToInstance(CreateAttributeSetDto, {
        key: "Bad Key",
        name: "",
        attributes: [{ attributeKey: "9x" }],
      }),
    );
    assert.ok(
      broken.length >= 2,
      "a bad key, an empty name and a bad attribute key are refused",
    );
  });
});
