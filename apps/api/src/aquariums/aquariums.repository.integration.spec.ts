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
const TEST_EMAIL_DOMAIN = "aquariums-integration.invalid";
const CUSTOMER_PREFIX = "AQ-INT-CUST-";

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
      await prisma.aquariumMaintainer.deleteMany({
        where: { aquarium: { name: { startsWith: "AQ-INT-" } } },
      });
      await prisma.aquariumMeasurement.deleteMany({
        where: { aquarium: { name: { startsWith: "AQ-INT-" } } },
      });
      await prisma.aquarium.deleteMany({
        where: { name: { startsWith: "AQ-INT-" } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });
      // A HELYSZÍNEK AZ AKVÁRIUMOK UTÁN, DE A VEVŐK ELŐTT -- az
      // `Aquarium.departmentId` és a `WorksheetDepartment.customerId` is
      // `Restrict`, tehát amíg akvárium hivatkozik rá, vagy amíg a
      // helyszín létezik, a szülő nem törölhető.
      await prisma.worksheetDepartment.deleteMany({
        where: { name: { startsWith: "AQ-INT-" } },
      });
      // AZ AKVÁRIUMOK UTÁN, mert az Aquarium.customerId `onDelete: SetNull`
      // -- egy törölt vevőt a fenti sor már nem talál meg name szerint, a
      // sorrend mégis a biztonságosabb, hogy a takarítás önmagában is
      // értelmes maradjon, ha valaha külön futtatnák.
      await prisma.customer.deleteMany({
        where: { customerNumber: { startsWith: CUSTOMER_PREFIX } },
      });
      const equipmentLeft = await prisma.aquariumEquipment.count({
        where: { aquarium: { name: { startsWith: "AQ-INT-" } } },
      });
      const aquariumsLeft = await prisma.aquarium.count({
        where: { name: { startsWith: "AQ-INT-" } },
      });
      const usersLeft = await prisma.user.count({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });
      const departmentsLeft = await prisma.worksheetDepartment.count({
        where: { name: { startsWith: "AQ-INT-" } },
      });
      const customersLeft = await prisma.customer.count({
        where: { customerNumber: { startsWith: CUSTOMER_PREFIX } },
      });
      nincsMaradek([
        { nev: "AquariumEquipment", darab: equipmentLeft },
        { nev: "Aquarium", darab: aquariumsLeft },
        { nev: "User", darab: usersLeft },
        { nev: "WorksheetDepartment", darab: departmentsLeft },
        { nev: "Customer", darab: customersLeft },
      ]);
    }

    function createInput(
      overrides: {
        clientOperationId?: string;
        ownershipType?: "OWN" | "CUSTOMER";
        customerId?: string | null;
        departmentId?: string;
        name?: string;
      } = {},
    ) {
      return {
        ownershipType: "OWN" as const,
        customerId: null,
        name: `AQ-INT-${suffix}`,
        waterBodyType: "AKVARIUM" as const,
        systemVolumeIsManual: false,
        equipment: [],
        targets: [],
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

    /**
     * A LISTA-PILOT KÉRÉSÉRE (acrobot, 2026-09-24 16:19): a "Karbantartók"
     * és "Utolsó vízmérés" mostantól a LISTA-végponton is megjelenik, két
     * batch-elt (nem soronkénti) `include`-dal -- lásd a `listInclude`
     * fejlécét a repository-ban. Ez a teszt ADATBÁZISON méri, hogy a kettő
     * ténylegesen odaér a `list()` válaszába, nem csak a `detail()`-be.
     */
    describe("list -- karbantartók és utolsó vízmérés", () => {
      it("a lista soronként adja a karbantartókat és a legutóbbi mérés dátumát", async () => {
        const aquarium = await repository.create(
          createInput({
            clientOperationId: `aquarium-create:OWN:list-meres-${suffix}`,
          }),
          "no-actor",
        );

        const maintainer = await prisma.user.create({
          data: {
            email: `list-maintainer-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: "Lista Karbantartó",
            role: "SERVICE",
            isActive: true,
          },
        });
        await prisma.aquariumMaintainer.create({
          data: { aquariumId: aquarium.id, userId: maintainer.id },
        });

        const regebbi = new Date(Date.UTC(2026, 8, 1, 10, 0, 0));
        const legutobbi = new Date(Date.UTC(2026, 8, 20, 10, 0, 0));
        await prisma.aquariumMeasurement.create({
          data: {
            aquariumId: aquarium.id,
            parameterCode: "PH",
            value: "7.8",
            unit: "pH",
            measuredAt: regebbi,
          },
        });
        await prisma.aquariumMeasurement.create({
          data: {
            aquariumId: aquarium.id,
            parameterCode: "PH",
            value: "7.9",
            unit: "pH",
            measuredAt: legutobbi,
          },
        });

        const lista = await repository.list({
          page: 1,
          pageSize: 25,
          search: aquarium.name,
        });
        const talalt = lista.items.find((item) => item.id === aquarium.id);
        assert.ok(
          talalt,
          "a listának tartalmaznia kell a létrehozott akváriumot",
        );
        assert.deepEqual(talalt!.maintainers.map((m) => m.userId).sort(), [
          maintainer.id,
        ]);
        /*
          A LEGUTOBBI, NEM A REGEBBI: ha a `listInclude` `orderBy`-ja hibás
          (pl. `asc`), ez az állítás a régebbi dátumot kapná -- a két
          létrehozott sor SZÁNDÉKOSAN két különböző napra esik, hogy a
          sorrend ténylegesen megmérhető legyen.
        */
        assert.equal(talalt!.lastMeasuredAt, legutobbi.toISOString());
      });
    });

    /**
     * AZ ESZKÖZ-FELVITEL "Akvárium" VÁLASZTÓJÁHOZ (2026-09-25, acrobot
     * döntése): a szűrő a KIVÁLASZTOTT vevő aktív akváriumaira szűkít --
     * ez a teszt azt méri, hogy a szűrő TÉNYLEG szűkít, nem csak elfogad
     * egy paramétert. Két külön vevő, két külön akvárium: ha a `where`
     * ág hibás (pl. lemarad a spread), MINDKETTŐ visszajönne.
     */
    describe("list -- customerId szűrő", () => {
      it("csak a kiválasztott vevő akváriumát adja vissza", async () => {
        const customerA = await prisma.customer.create({
          data: {
            customerNumber: `${CUSTOMER_PREFIX}A-${suffix}`,
            type: "COMPANY",
            displayName: `Akvárium szűrő A ${suffix}`,
          },
        });
        const customerB = await prisma.customer.create({
          data: {
            customerNumber: `${CUSTOMER_PREFIX}B-${suffix}`,
            type: "COMPANY",
            displayName: `Akvárium szűrő B ${suffix}`,
          },
        });

        const aquariumA = await repository.create(
          createInput({
            clientOperationId: `aquarium-create:CUSTOMER:filter-a-${suffix}`,
            ownershipType: "CUSTOMER",
            customerId: customerA.id,
            name: `AQ-INT-filter-a-${suffix}`,
          }),
          "no-actor",
        );
        await repository.create(
          createInput({
            clientOperationId: `aquarium-create:CUSTOMER:filter-b-${suffix}`,
            ownershipType: "CUSTOMER",
            customerId: customerB.id,
            name: `AQ-INT-filter-b-${suffix}`,
          }),
          "no-actor",
        );

        const lista = await repository.list({
          page: 1,
          pageSize: 25,
          customerId: customerA.id,
        });
        const ids = lista.items.map((item) => item.id);
        assert.ok(
          ids.includes(aquariumA.id),
          "a szűrt vevő akváriumának szerepelnie kell",
        );
        assert.equal(
          ids.some((id) => id !== aquariumA.id),
          false,
          "a másik vevő akváriuma NEM szerepelhet a szűrt listában",
        );
      });
    });

    /**
     * A HATÓKÖR-SZŰRÉS, ÉLŐ ADATBÁZISON -- Balázs kifejezett kérése
     * (2026-09-25, Partner Portál Akváriumok terv): "teszt mindkét irányra
     * (saját látszik, másik ügyfélé 404)". Az `aquariumVisibilityWhere`
     * saját (`aquarium-visibility.spec.ts`) tesztje a WHERE-ALAKOT
     * bizonyítja, DB nélkül; ez a teszt azt, hogy a `detail()` a Prisma
     * `findFirst`-tel TÉNYLEG ezt a viselkedést adja vissza -- ugyanaz a
     * különbség, mint az `aquarium-visibility.ts` fejlécében: a szabály és
     * a beépítése két külön kérdés.
     */
    describe("detail -- hatókör-szűrés (departmentId a soron)", () => {
      it("a saját ügyfél, kiosztott helyszínéhez tartozó akvárium látszik, a másik ügyfélé nem", async () => {
        const customerA = await prisma.customer.create({
          data: {
            customerNumber: `${CUSTOMER_PREFIX}SCOPE-A-${suffix}`,
            type: "COMPANY",
            displayName: `Akvárium hatókör A ${suffix}`,
          },
        });
        const customerB = await prisma.customer.create({
          data: {
            customerNumber: `${CUSTOMER_PREFIX}SCOPE-B-${suffix}`,
            type: "COMPANY",
            displayName: `Akvárium hatókör B ${suffix}`,
          },
        });
        const departmentA = await prisma.worksheetDepartment.create({
          data: {
            customerId: customerA.id,
            code: "AQI01",
            name: `AQ-INT-department-a-${suffix}`,
          },
        });

        const aquariumA = await repository.create(
          createInput({
            clientOperationId: `aquarium-create:CUSTOMER:scope-a-${suffix}`,
            ownershipType: "CUSTOMER",
            customerId: customerA.id,
            departmentId: departmentA.id,
            name: `AQ-INT-scope-a-${suffix}`,
          }),
          "no-actor",
        );
        const aquariumB = await repository.create(
          createInput({
            clientOperationId: `aquarium-create:CUSTOMER:scope-b-${suffix}`,
            ownershipType: "CUSTOMER",
            customerId: customerB.id,
            name: `AQ-INT-scope-b-${suffix}`,
          }),
          "no-actor",
        );

        const visibility = {
          AND: [
            { customerId: customerA.id },
            { departmentId: { in: [departmentA.id] } },
          ],
        };

        const own = await repository.detail(aquariumA.id, visibility);
        assert.equal(
          own?.id,
          aquariumA.id,
          "a saját ügyfél, kiosztott helyszínéhez tartozó akvárium látszania kell",
        );

        const other = await repository.detail(aquariumB.id, visibility);
        assert.equal(
          other,
          null,
          "a másik ügyfél akváriuma NEM kaphat találatot -- ez a 404 forrása a service rétegben",
        );

        /*
          ÉS A HELYSZÍN NÉLKÜL KIOSZTOTT SAJÁT AKVÁRIUM SEM LÁTSZIK, ha a
          kérő helyszín szerint szűkül -- lásd `aquarium-visibility.ts`
          fejlécét: a `null` sosem eleme egy `in` listának.
        */
        const ownWithoutDepartment = await repository.create(
          createInput({
            clientOperationId: `aquarium-create:CUSTOMER:scope-a-no-dept-${suffix}`,
            ownershipType: "CUSTOMER",
            customerId: customerA.id,
            name: `AQ-INT-scope-a-no-dept-${suffix}`,
          }),
          "no-actor",
        );
        const missingDepartment = await repository.detail(
          ownWithoutDepartment.id,
          visibility,
        );
        assert.equal(
          missingDepartment,
          null,
          "helyszín nélküli saját akvárium sem látszik a helyszín szerint szűkített hívónak",
        );
      });
    });
  },
);
