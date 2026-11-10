import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { UpdateProductDto } from "./dto/update-product.dto.js";

/*
  MI PIROSIT (kartya 20b0dd47, S2): a nev szokozokkal megy tovabb (a repository mar nem tudja, mi volt az eredeti); egy
  200 karakternel hosszabb nev atmegy; a null (torles) elutasitva; egy nem szoveg (szam, tomb) atmegy; a ket nyelv
  felcserelve (egy nev egy masik mezobe kerul).
*/
const dto = (body: Record<string, unknown>) =>
  plainToInstance(UpdateProductDto, body);
const invalid = (body: Record<string, unknown>) =>
  validateSync(dto(body)).length > 0;

describe("az UpdateProductDto nev-mezoi", () => {
  it("a szoveget a szokozok nelkul adja tovabb, mezonkent a sajat helyen", () => {
    const value = dto({
      magyarNev: "  Szarvkorall ",
      angolNev: " Staghorn coral",
      nemetNev: "Hirschgeweihkoralle  ",
    });
    assert.equal(value.magyarNev, "Szarvkorall");
    assert.equal(value.angolNev, "Staghorn coral");
    assert.equal(value.nemetNev, "Hirschgeweihkoralle");
    assert.equal(
      invalid({ magyarNev: "x", angolNev: "y", nemetNev: "z" }),
      false,
    );
  });

  it("a null (torles) es a hianyzo mezo rendben van", () => {
    assert.equal(invalid({ nemetNev: null }), false);
    assert.equal(invalid({}), false);
  });

  it("a 200 karakternel hosszabb nevet elutasitja, a pontosan 200-at nem", () => {
    assert.equal(invalid({ angolNev: "a".repeat(200) }), false);
    assert.equal(invalid({ angolNev: "a".repeat(201) }), true);
    // a szokozok a hossz mérese elott leesnek
    assert.equal(invalid({ angolNev: ` ${"a".repeat(200)} ` }), false);
  });

  it("a nem szoveget elutasitja", () => {
    for (const bad of [5, true, ["x"], { a: 1 }])
      assert.equal(invalid({ magyarNev: bad }), true);
  });
});
