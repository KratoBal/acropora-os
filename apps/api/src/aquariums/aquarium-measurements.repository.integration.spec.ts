import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { AquariumMeasurementsRepository } from "./aquarium-measurements.repository.js";
import { AquariumsRepository } from "./aquariums.repository.js";

/**
 * AZ ALKALOM-ÜTKÖZÉS KIZÁRÓLAG ADATBÁZISON MÉRHETŐ.
 *
 * A `create()` ELŐZETES keresése (a normál eset) mockkal is tesztelhető
 * lenne, de az `@@unique([aquariumId, measuredAt, parameterCode])`
 * VERSENYHELYZETI védelme -- két olyan beszúrás, ami az előzetes keresés
 * UTÁN, de a saját beszúrása ELŐTT fut le -- csak a valódi egyedi index
 * hibájával mérhető. Ugyanaz az indok, mint az `aquariums.repository.
 * integration.spec.ts` saját fejlécében a `clientOperationId`-nél.
 */
const gate = integrationDatabaseGate(process.env);

describe(
  "AquariumMeasurementsRepository integration",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const aquariums = new AquariumsRepository();
    const measurements = new AquariumMeasurementsRepository();

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
    });

    after(removeLeftovers);

    async function removeLeftovers() {
      await prisma.aquariumMeasurement.deleteMany({
        where: { aquarium: { name: { startsWith: "AQM-INT-" } } },
      });
      await prisma.aquarium.deleteMany({
        where: { name: { startsWith: "AQM-INT-" } },
      });
      const measurementsLeft = await prisma.aquariumMeasurement.count({
        where: { aquarium: { name: { startsWith: "AQM-INT-" } } },
      });
      const aquariumsLeft = await prisma.aquarium.count({
        where: { name: { startsWith: "AQM-INT-" } },
      });
      nincsMaradek([
        { nev: "AquariumMeasurement", darab: measurementsLeft },
        { nev: "Aquarium", darab: aquariumsLeft },
      ]);
    }

    async function testAquarium(name: string) {
      const created = await aquariums.create(
        {
          ownershipType: "OWN",
          customerId: null,
          name,
          waterBodyType: "AKVARIUM",
          systemVolumeIsManual: false,
          equipment: [],
          targets: [],
        },
        "no-actor",
      );
      return created.id;
    }

    describe("két alkalom ugyanarra az időpontra", () => {
      it("POZITÍV KONTROLL: két KÜLÖNBÖZŐ időpont két külön alkalmat ad", async () => {
        const aquariumId = await testAquarium(`AQM-INT-${suffix}-kontroll`);
        const elso = await measurements.create(
          aquariumId,
          {
            measuredAt: new Date(Date.UTC(2026, 8, 24, 8, 0, 0)).toISOString(),
            values: [{ parameterCode: "PH", value: 7.2 }],
          },
          "no-actor",
        );
        const masodik = await measurements.create(
          aquariumId,
          {
            measuredAt: new Date(Date.UTC(2026, 8, 24, 8, 1, 0)).toISOString(),
            values: [{ parameterCode: "PH", value: 7.3 }],
          },
          "no-actor",
        );
        assert.notEqual(masodik.occasion.id, elso.occasion.id);
      });

      it("ugyanaz a measuredAt 409-et ad, a második beszúrás előtt", async () => {
        /*
          MI PIROSÍT: az előzetes keresés elhagyása a beszúrás elől. Enélkül
          a második hívás sikeresen létrehozná a sorokat, és a két alkalom
          a listázásnál ÉSZREVÉTLENÜL eggyé olvadna -- pont az a hiba, amit
          Balázs jelzett (dátum-only választó, két aznapi mérés egy
          alkalommá olvadt).
        */
        const aquariumId = await testAquarium(`AQM-INT-${suffix}-utkozes`);
        const measuredAt = new Date(
          Date.UTC(2026, 8, 24, 9, 0, 0),
        ).toISOString();
        await measurements.create(
          aquariumId,
          { measuredAt, values: [{ parameterCode: "PH", value: 7.2 }] },
          "no-actor",
        );

        await assert.rejects(
          () =>
            measurements.create(
              aquariumId,
              {
                measuredAt,
                values: [{ parameterCode: "HOMERSEKLET", value: 25 }],
              },
              "no-actor",
            ),
          (error: unknown) =>
            error instanceof Error &&
            error.constructor.name === "ConflictException",
        );

        // ÉS A TÁBLÁBAN IS CSAK AZ ELSŐ ALKALOM SORAI ÁLLNAK: a hibának nem
        // szabad félbehagyott sort maradnia.
        const rows = await prisma.aquariumMeasurement.count({
          where: { aquariumId },
        });
        assert.equal(rows, 1);
      });

      it("VERSENYHELYZET: az egyedi index a beszúrásnál is elkapja, nem csak az előzetes keresés", async () => {
        /*
          Ez azt a rést méri, amit az előzetes keresés NEM tud lezárni: két
          beszúrás, ami MÁR TÚL van a keresésen. Itt a repository create()-jét
          megkerülve, közvetlenül a séma egyedi indexét mérjük -- ha ez a
          teszt zöld a megszorítás NÉLKÜL is, az egyedi index nem véd semmit.
        */
        const aquariumId = await testAquarium(`AQM-INT-${suffix}-verseny`);
        const measuredAt = new Date(Date.UTC(2026, 8, 24, 10, 0, 0));

        await prisma.aquariumMeasurement.create({
          data: {
            aquariumId,
            parameterCode: "PH",
            value: 7.2,
            unit: "pH",
            measuredAt,
            measuredById: null,
            source: null,
            notes: null,
            clientOperationId: null,
          },
        });

        await assert.rejects(() =>
          prisma.aquariumMeasurement.create({
            data: {
              aquariumId,
              parameterCode: "PH",
              value: 7.4,
              unit: "pH",
              measuredAt,
              measuredById: null,
              source: null,
              notes: null,
              clientOperationId: null,
            },
          }),
        );
      });
    });
  },
);
