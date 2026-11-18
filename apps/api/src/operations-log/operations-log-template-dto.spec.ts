import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { CreateOperationsTaskTemplateDto } from "./dto/operations-task-template.dto.js";
import { toDto } from "./operations-log.repository.js";

/*
  AZ EGYSÉGES RÖGZÍTÉS KAPCSOLÓJA A SABLON OLVASÁSI ÉS ÍRÁSI ALAKJÁN (card d2222173). MI PIROSÍT: ha a kérés DTO-ja nem fogadja az igaz/hamis
  kapcsolót, vagy szöveget enged helyette; ha az olvasási alak (amit a webes szerkesztő és a telefon kap) nem hordozza a sor kapcsolóját.
*/
const body = (over: Record<string, unknown> = {}) =>
  plainToInstance(CreateOperationsTaskTemplateDto, {
    name: "Homokszűrő visszamosás",
    frequency: "WEEKLY",
    assetIds: ["a1"],
    fields: [],
    ...over,
  });

describe("a sablon DTO kapcsolója", () => {
  it("igaz és hamis jó, a hiánya jó, a szöveg és a szám nem", async () => {
    assert.equal((await validate(body({ uniformRecording: true }))).length, 0);
    assert.equal((await validate(body({ uniformRecording: false }))).length, 0);
    assert.equal((await validate(body())).length, 0);
    for (const bad of ["true", "igen", 1, 0, null]) {
      const errors = await validate(body({ uniformRecording: bad }));
      assert.ok(
        errors.some((e) => e.property === "uniformRecording"),
        `a(z) ${JSON.stringify(bad)} nem elfogadott`,
      );
    }
  });
});

describe("a sablon olvasási alakja", () => {
  const row = (uniformRecording: boolean) =>
    ({
      id: "t1",
      name: "Homokszűrő visszamosás",
      description: null,
      frequency: "WEEKLY",
      assetCategoryId: null,
      isActive: true,
      uniformRecording,
      updatedAt: new Date("2026-11-18T08:00:00.000Z"),
      assets: [],
      assetCategory: null,
      fields: [],
    }) as never;

  it("a sor kapcsolóját hordozza, igazat és hamisat is", () => {
    assert.equal(toDto(row(true)).uniformRecording, true);
    assert.equal(toDto(row(false)).uniformRecording, false);
  });
});
