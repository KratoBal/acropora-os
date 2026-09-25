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
     * A `DomainEvent` SORÁT KÜLÖN KELL TÖRÖLNI -- ÉS EZ ELŐSZÖR TÉVEDÉS
     * VOLT ITT (mérve, CI verify run 36106350535).
     *
     * Az `actorUserId` idegenkulcsa `onDelete: SetNull`, tehát a felhasználó
     * törlésekor CSAK a hivatkozás áll NULL-ra -- maga a domain-esemény SORA
     * megmarad, örökre, mert `DomainEvent.aggregateId` egy sima szöveg-mező,
     * nincs idegenkulcsa az `Aquarium`-hoz, tehát az `Aquarium` törlése
     * SEMMILYEN cascade-ot nem indít rajta. A `measurements.create()`
     * viszont MINDEN sikeres híváskor ír egy `aquarium-measurement.recorded`
     * eseményt (lásd a repository fejlécét) -- ez a suite tehát három
     * takarítatlan sort hagyott globálisan a `DomainEvent` táblán minden
     * futásnál.
     *
     * ÉS EZ NEM CSAK EZT A SUITE-OT SZENNYEZTE: az `unas-apply.integration.
     * spec.ts` saját asszerciója a `DomainEvent` GLOBÁLIS darabszámára kérdez
     * (`assert.equal(await prisma.domainEvent.count(), 3)`), mert a UNAS
     * import a saját eseményeit `createdAt >= SUITE_KEZDET` ablakkal, nem
     * elő-taggal azonosítja. A két suite ugyanazon a megosztott CI-
     * adatbázison fut, tehát az itt maradt három sor ÉPP ANNYIT tolt el egy
     * MÁSIK, teljesen független modul mérésén (6 lett a várt 3 helyett).
     */
    async function removeLeftovers() {
      const aquariumIds = (
        await prisma.aquarium.findMany({
          where: { name: { startsWith: PREFIX } },
          select: { id: true },
        })
      ).map((row) => row.id);
      if (aquariumIds.length > 0)
        await prisma.domainEvent.deleteMany({
          where: {
            aggregateType: "Aquarium",
            aggregateId: { in: aquariumIds },
          },
        });
      await prisma.aquariumMeasurement.deleteMany({
        where: { aquarium: { name: { startsWith: PREFIX } } },
      });
      await prisma.aquarium.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: PREFIX.toLowerCase() } },
      });
      const domainEventsLeft =
        aquariumIds.length > 0
          ? await prisma.domainEvent.count({
              where: {
                aggregateType: "Aquarium",
                aggregateId: { in: aquariumIds },
              },
            })
          : 0;
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
        { nev: "DomainEvent", darab: domainEventsLeft },
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
