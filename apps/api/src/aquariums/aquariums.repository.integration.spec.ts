import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { AquariumsRepository } from "./aquariums.repository.js";

/**
 * A HELYSZÍNI FELVITEL IDEMPOTENCIÁJA, ADATBÁZISON.
 *
 * Balázs 2026-09-16-i döntése szerint a telefon terepen is rögzít; egy
 * akvárium tipikusan az ügyfélnél, rossz térfedésnél kerül felvitelre. A
 * telefon a hálózati hibát SZÁNDÉKOSAN újrapróbálja (`saveOrQueue` a mobil
 * oldalon), és épp ott lehet, hogy a kérés MÁR lefutott, csak a válasz
 * veszett el.
 *
 * MIÉRT ADATBÁZISON: a kód előzetes keresése két PÁRHUZAMOS kérésnél
 * elcsúszhat, és azt az esetet KIZÁRÓLAG az egyedi index vágja el. Mockkal
 * ez a rés láthatatlan marad -- ugyanaz az indok, mint a
 * `worksheets.repository.integration.spec.ts` saját fejlécében.
 */
const gate = integrationDatabaseGate(process.env);

describe(
  "AquariumsRepository integration",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const repository = new AquariumsRepository();

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
    });

    after(removeLeftovers);

    async function removeLeftovers() {
      await prisma.aquariumEquipment.deleteMany({
        where: { aquarium: { name: { startsWith: "AQ-INT-" } } },
      });
      await prisma.aquarium.deleteMany({
        where: { name: { startsWith: "AQ-INT-" } },
      });
      const equipmentLeft = await prisma.aquariumEquipment.count({
        where: { aquarium: { name: { startsWith: "AQ-INT-" } } },
      });
      const aquariumsLeft = await prisma.aquarium.count({
        where: { name: { startsWith: "AQ-INT-" } },
      });
      nincsMaradek([
        { nev: "AquariumEquipment", darab: equipmentLeft },
        { nev: "Aquarium", darab: aquariumsLeft },
      ]);
    }

    function createInput(overrides: { clientOperationId?: string } = {}) {
      return {
        ownershipType: "OWN" as const,
        customerId: null,
        name: `AQ-INT-${suffix}`,
        waterBodyType: "AKVARIUM" as const,
        systemVolumeIsManual: false,
        equipment: [],
        ...overrides,
      };
    }

    /**
     * A KONTROLL A SUITE SAJÁT TAKARÍTÁSÁRA: ha ez pirosodik, a leltár maga
     * nem mér semmit, és a többi állítás zölden hazudna.
     */
    it("POZITÍV KONTROLL: a suite létre tud hozni egy akváriumot", async () => {
      const created = await repository.create(createInput(), "no-actor");
      assert.equal(created.name, `AQ-INT-${suffix}`);
    });

    describe("a kliens művelet-azonosítója", () => {
      const KULCS = `aquarium-create:OWN:${new Date(
        Date.UTC(2026, 8, 24, 14, 30, 0),
      ).toISOString()}`;
      const MASIK = `aquarium-create:OWN:${new Date(
        Date.UTC(2026, 8, 24, 14, 35, 0),
      ).toISOString()}`;

      it("UGYANAZ a kulcs kétszer EGY akváriumot ad", async () => {
        /*
          MI PIROSÍT: a kulcsra keresés elhagyása a létrehozás elől. Enélkül
          két akvárium keletkezne, és a szerelő azt látná, hogy mindent
          kétszer rögzített -- nem hibaüzenetet, hanem két sort, amiről el
          kell dönteni, melyik az igazi.
        */
        const elso = await repository.create(
          createInput({ clientOperationId: KULCS }),
          "no-actor",
        );
        const masodik = await repository.create(
          createInput({ clientOperationId: KULCS }),
          "no-actor",
        );

        assert.equal(masodik.id, elso.id);
        // ÉS A TÁBLÁBAN IS EGY SOR ÁLL: a két azonosító egyezése magában még
        // jöhetne két rekordból is.
        const darab = await prisma.aquarium.count({
          where: { clientOperationId: KULCS },
        });
        assert.equal(darab, 1);
      });

      it("MÁSIK kulcs MÁSIK akváriumot ad", async () => {
        // TESTVÉR-KONTROLL: enélkül egy változat, ami MINDIG az elsőt adja
        // vissza, átmenne a fenti állításon.
        const masik = await repository.create(
          createInput({ clientOperationId: MASIK }),
          "no-actor",
        );
        const elso = await prisma.aquarium.findUnique({
          where: { clientOperationId: KULCS },
          select: { id: true },
        });
        assert.notEqual(masik.id, elso?.id);
      });

      it("KULCS NÉLKÜL továbbra is minden hívás LÉTREHOZ", async () => {
        /*
          A MÁSIK IRÁNY, ÉS EZ VÉDI A WEBES ŰRLAPOT: az nem küld kulcsot, és
          ma működik. Egy javítás, ami a kulcs nélküli hívásokat összevonná
          vagy a mezőt kötelezővé tenné, azt állítaná le.
        */
        const egyik = await repository.create(createInput(), "no-actor");
        const masik = await repository.create(createInput(), "no-actor");
        assert.notEqual(masik.id, egyik.id);
      });

      it("byClientOperationId megtalálja a meglévőt, és nullt ad az ismeretlenre", async () => {
        const talalt = await repository.byClientOperationId(KULCS);
        assert.equal(talalt?.name, `AQ-INT-${suffix}`);

        const nincs = await repository.byClientOperationId(
          "aquarium-create:OWN:soha-nem-letezett",
        );
        assert.equal(nincs, null);
      });
    });
  },
);
