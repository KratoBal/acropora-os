import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import {
  CreateMortalityDto,
  MortalityListQueryDto,
  UpdateMortalityDto,
} from "./dto/mortality.dto.js";

/** Ugyanazzal a beállítással, mint a globális ValidationPipe (app.configuration.ts). */
function problems(type: new () => object, plain: Record<string, unknown>) {
  return validateSync(plainToInstance(type, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((error) => error.property);
}

const VALID = {
  productId: "p",
  quantity: "2",
  aquariumId: "a",
  sourceType: "SUPPLIER",
  supplierId: "s",
};

describe("CreateMortalityDto", () => {
  it("az érvényes bemenet átmegy (a szám szövegként is)", () => {
    assert.deepEqual(problems(CreateMortalityDto, VALID), []);
  });

  it("a példányszám pozitív egész", () => {
    assert.deepEqual(problems(CreateMortalityDto, { ...VALID, quantity: 0 }), [
      "quantity",
    ]);
    assert.deepEqual(
      problems(CreateMortalityDto, { ...VALID, quantity: 1.5 }),
      ["quantity"],
    );
  });

  it("ismeretlen forrás-típus nem megy át", () => {
    assert.deepEqual(
      problems(CreateMortalityDto, { ...VALID, sourceType: "GIFT" }),
      ["sourceType"],
    );
  });

  it("a rögzítő és az időpont nem bemenet", () => {
    assert.deepEqual(
      problems(CreateMortalityDto, {
        ...VALID,
        recordedById: "x",
        recordedAt: "2026-01-01",
      }).sort(),
      ["recordedAt", "recordedById"],
    );
  });

  it("a kötelező mezők hiánya", () => {
    // az élőlény (termék VAGY név) a szolgáltatás szabálya, nem a DTO-é
    assert.deepEqual(problems(CreateMortalityDto, {}).sort(), [
      "aquariumId",
      "quantity",
      "sourceType",
    ]);
  });

  it("a szabad szöveges élőlény-név hossza korlátos", () => {
    assert.deepEqual(
      problems(CreateMortalityDto, {
        productName: "x".repeat(201),
        quantity: 1,
        aquariumId: "a",
        sourceType: "TRADE",
      }),
      ["productName"],
    );
  });
});

describe("UpdateMortalityDto", () => {
  it("üres és null mezők is átmennek (a null törlés)", () => {
    assert.deepEqual(problems(UpdateMortalityDto, {}), []);
    assert.deepEqual(
      problems(UpdateMortalityDto, {
        supplierId: null,
        sourceNote: null,
        note: null,
      }),
      [],
    );
  });

  it("a rögzítő itt sem módosítható", () => {
    assert.deepEqual(problems(UpdateMortalityDto, { recordedById: "x" }), [
      "recordedById",
    ]);
  });
});

describe("MortalityListQueryDto", () => {
  it("a lapméret legfeljebb 100", () => {
    assert.deepEqual(problems(MortalityListQueryDto, { pageSize: "100" }), []);
    assert.deepEqual(problems(MortalityListQueryDto, { pageSize: "101" }), [
      "pageSize",
    ]);
  });

  it("a dátum ÉÉÉÉ-HH-NN", () => {
    assert.deepEqual(
      problems(MortalityListQueryDto, { from: "2026-10-06" }),
      [],
    );
    assert.deepEqual(problems(MortalityListQueryDto, { to: "2026.10.06" }), [
      "to",
    ]);
  });
});
