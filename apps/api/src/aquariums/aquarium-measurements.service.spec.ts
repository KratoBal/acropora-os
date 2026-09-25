import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";

import { AquariumMeasurementsService } from "./aquarium-measurements.service.js";
import type { CreateAquariumMeasurementDto } from "./dto/aquarium-measurement.dto.js";

/**
 * A "MÉRÉS IDEJE" JÖVŐBE MUTATÓ ÉRTÉKÉNEK ELUTASÍTÁSA -- Balázs kérése,
 * 2026-09-25: a mező mostantól szerkeszthető, de az akvárium ma nem tud
 * olyan mérést, amit még nem végeztek el.
 *
 * VALÓDI ADATBÁZIS NÉLKÜL: ez tisztán bemenet-ellenőrzés, a repository
 * (és ezen keresztül a Postgres) egyáltalán nem látja a hívást, ha itt
 * elakad -- lásd `contracts.service.spec.ts` fejlécét ugyanerről a
 * mintáról.
 */

const AQUARIUM = {
  id: "aq-1",
  name: "AQ-1",
  maintainers: [],
};

function fakeAquariums(overrides: Partial<Record<string, unknown>> = {}) {
  return { detail: async () => AQUARIUM, ...overrides };
}

function fakeRepository(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    create: async () => ({
      occasion: { id: "2026-09-25T08:00:00.000Z" },
      created: true,
    }),
    ...overrides,
  };
}

function makeService(
  repositoryOverrides: Partial<Record<string, unknown>> = {},
  aquariumsOverrides: Partial<Record<string, unknown>> = {},
) {
  const repository = fakeRepository(repositoryOverrides);
  const aquariums = fakeAquariums(aquariumsOverrides);
  const notifications = { notifyAquariumMeasurementRecorded: () => {} };
  return {
    service: new AquariumMeasurementsService(
      repository as never,
      aquariums as never,
      notifications as never,
      {} as never,
      {} as never,
    ),
    repository,
  };
}

function input(
  overrides: Partial<CreateAquariumMeasurementDto> = {},
): CreateAquariumMeasurementDto {
  return {
    values: [{ parameterCode: "PH", value: 7.2 }],
    ...overrides,
  } as CreateAquariumMeasurementDto;
}

describe("AquariumMeasurementsService.create -- a mérés ideje", () => {
  it("POZITÍV KONTROLL: measuredAt nélkül létrehozza a mérést", async () => {
    const { service } = makeService();
    const result = await service.create("aq-1", input(), "actor-1");
    assert.equal(result.id, "2026-09-25T08:00:00.000Z");
  });

  it("POZITÍV KONTROLL: múltbeli measuredAt-tel létrehozza a mérést", async () => {
    const { service } = makeService();
    const result = await service.create(
      "aq-1",
      input({ measuredAt: "2020-01-01T08:00:00.000Z" }),
      "actor-1",
    );
    assert.equal(result.id, "2026-09-25T08:00:00.000Z");
  });

  it("jövőbeli measuredAt-re 400-at dob, ÉS A REPOSITORY-T MEG SEM HÍVJA", async () => {
    /*
      MI PIROSÍT: a jövő-ellenőrzés elhagyása. Enélkül a hívás lejutna a
      repository-ig, ami elfogadná -- egy szerelő ekkor egy még el nem
      végzett mérést rögzíthetne, holnapi vagy jövő heti dátummal.
    */
    let repositoryCalled = false;
    const { service } = makeService({
      create: async () => {
        repositoryCalled = true;
        return { occasion: { id: "never" }, created: true };
      },
    });
    const futureIso = new Date(Date.now() + 60_000).toISOString();

    await assert.rejects(
      () => service.create("aq-1", input({ measuredAt: futureIso }), "actor-1"),
      (error: unknown) =>
        error instanceof BadRequestException &&
        (error as Error).message === "A mérés ideje nem lehet a jövőben.",
    );
    assert.equal(repositoryCalled, false);
  });
});
