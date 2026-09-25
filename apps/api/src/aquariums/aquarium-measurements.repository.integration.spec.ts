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
    const PREFIX = `AQM-INT-${suffix}`;
    const aquariums = new AquariumsRepository();
    const measurements = new AquariumMeasurementsRepository();
    let actorUserId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      /**
       * A `measurements.create()` VALÓDI FELHASZNÁLÓT ÍR: a `DomainEvent.
       * actorUserId`-nek van idegenkulcsa (`onDelete: SetNull`), tehát egy
       * nem létező "no-actor" string a beszúrásnál idegenkulcs-hibával
       * bukik -- ez maga volt a CI leletje. Az `AquariumsRepository.
       * create()` ezzel szemben az `_actorUserId`-t sosem írja sehova
       * (lásd a saját fejlécét), ott a "no-actor" változatlanul biztonságos.
       */
      const user = await prisma.user.create({
        data: {
          email: `${PREFIX.toLowerCase()}-actor@example.invalid`,
          displayName: `${PREFIX} aktor`,
          role: "SERVICE",
        },
        select: { id: true },
      });
      actorUserId = user.id;
    });

    after(removeLeftovers);

    /**
     * A `DomainEvent.actorUserId`-t NEM KELL KÜLÖN TÖRÖLNI: az idegenkulcs
     * `onDelete: SetNull`, tehát a felhasználó törlésekor a mező magától
     * NULL-ra áll -- a domain-esemény sora megmarad, csak a hivatkozás tűnik
     * el. Az `AquariumMeasurement` törlése az `Aquarium` felől CASCADE
     * (`onDelete: Cascade`), tehát elég a szülőt törölni; a darabszám mégis
     * KÜLÖN ELLENŐRZÖTT, mert egy hallgatólagos cascade-feltevés önmagában
     * nem mérés.
     */
    async function removeLeftovers() {
      await prisma.aquariumMeasurement.deleteMany({
        where: { aquarium: { name: { startsWith: PREFIX } } },
      });
      await prisma.aquarium.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: PREFIX.toLowerCase() } },
      });
      const measurementsLeft = await prisma.aquariumMeasurement.count({
        where: { aquarium: { name: { startsWith: PREFIX } } },
      });
      const aquariumsLeft = await prisma.aquarium.count({
        where: { name: { startsWith: PREFIX } },
      });
      const usersLeft = await prisma.user.count({
        where: { email: { startsWith: PREFIX.toLowerCase() } },
      });
      nincsMaradek([
        { nev: "AquariumMeasurement", darab: measurementsLeft },
        { nev: "Aquarium", darab: aquariumsLeft },
        { nev: "User", darab: usersLeft },
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
        const aquariumId = await testAquarium(`${PREFIX}-kontroll`);
        const elso = await measurements.create(
          aquariumId,
          {
            measuredAt: new Date(Date.UTC(2026, 8, 24, 8, 0, 0)).toISOString(),
            values: [{ parameterCode: "PH", value: 7.2 }],
          },
          actorUserId,
        );
        const masodik = await measurements.create(
          aquariumId,
          {
            measuredAt: new Date(Date.UTC(2026, 8, 24, 8, 1, 0)).toISOString(),
            values: [{ parameterCode: "PH", value: 7.3 }],
          },
          actorUserId,
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
        const aquariumId = await testAquarium(`${PREFIX}-utkozes`);
        const measuredAt = new Date(
          Date.UTC(2026, 8, 24, 9, 0, 0),
        ).toISOString();
        await measurements.create(
          aquariumId,
          { measuredAt, values: [{ parameterCode: "PH", value: 7.2 }] },
          actorUserId,
        );

        await assert.rejects(
          () =>
            measurements.create(
              aquariumId,
              {
                measuredAt,
                values: [{ parameterCode: "HOMERSEKLET", value: 25 }],
              },
              actorUserId,
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
        const aquariumId = await testAquarium(`${PREFIX}-verseny`);
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
