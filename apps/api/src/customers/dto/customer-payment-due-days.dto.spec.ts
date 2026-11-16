// class-validator reads the metadata the decorators write; production installs it in `main.ts`
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { CreateCustomerDto, UpdateCustomerDto } from "./customer.dto.js";

/*
  A VEVŐ FIZETÉSI HATÁRIDEJE A SZERVEREN (Balázs 2026-11-11 10:58 UTC): ugyanaz a szabály, mint a Partnereknél (`supplier.dto.ts`):
  egész, 0-365, hiányzó = nincs saját érték. MI PIROSÍT: a határon kívüli, tört vagy szöveges érték átmegy; a nulla elbukik (a
  "hamis" érték miatt); az Update `null`-ja (törlés) elbukik; a Create a mezőt kötelezővé teszi.
*/
const problems = async (
  Dto: typeof CreateCustomerDto | typeof UpdateCustomerDto,
  extra: Record<string, unknown>,
) => {
  const base =
    Dto === CreateCustomerDto
      ? { type: "COMPANY", displayName: "Teszt" }
      : { expectedUpdatedAt: "2026-11-11T10:00:00.000Z" };
  // the two classes are one union: one constructor type for `plainToInstance`
  const errors = await validate(
    plainToInstance(Dto as new () => object, { ...base, ...extra }),
  );
  return errors.filter((e) => e.property === "paymentDueDays");
};

describe("a vevő fizetési határideje (DTO)", () => {
  for (const [name, Dto] of [
    ["létrehozás", CreateCustomerDto],
    ["módosítás", UpdateCustomerDto],
  ] as const) {
    it(`${name}: egész szám 0 és 365 között elfogadott, a határokkal együtt`, async () => {
      for (const value of [0, 1, 8, 15, 30, 365])
        assert.equal(
          (await problems(Dto, { paymentDueDays: value })).length,
          0,
          String(value),
        );
    });

    it(`${name}: a határon kívüli, tört, szöveges és nem szám érték elutasított`, async () => {
      for (const value of [
        -1,
        366,
        1000,
        1.5,
        30.01,
        "30",
        "",
        true,
        [],
        {},
        Number.NaN,
      ])
        assert.equal(
          (await problems(Dto, { paymentDueDays: value })).length > 0,
          true,
          JSON.stringify(value),
        );
    });

    it(`${name}: a hiányzó mező rendben van (nincs saját érték)`, async () => {
      assert.equal((await problems(Dto, {})).length, 0);
    });
  }

  it("módosítás: a null törli a napot (az alapérték visszaáll), és átmegy a szűrőn", async () => {
    assert.equal(
      (await problems(UpdateCustomerDto, { paymentDueDays: null })).length,
      0,
    );
  });
});
