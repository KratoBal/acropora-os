import "reflect-metadata";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ConflictException } from "@nestjs/common";
import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ContractsRepository } from "./contracts.repository.js";
import { ContractsService } from "./contracts.service.js";
import type { UpdateContractDto } from "./dto.js";

/**
 * A TÉTEL-ID STABILITÁSA ÉS A HELYSZÍN-ALAPÚ ESZKÖZ-ELLENŐRZÉS, ADATBÁZISON.
 *
 * Balázs éles hibája (2026-09-24 21:48, Állatkert, SZ2026/0000019), acrobot
 * jelentése alapján, KÉT KÜLÖN OK:
 *
 * 1. A `ContractsRepository.update()` MINDEN mentéskor törölte és
 *    újraépítette az ÖSSZES `ContractItem` sort, új `id`-vel. A kliens
 *    tétel-kulcsos állapota (kijelölt tételek a megrendelőlaphoz, helyszín,
 *    eszközök) a RÉGI id-n maradt, ezért a következő megrendelőlap-
 *    kiállítás "olyan tétel, ami nem is létezik" hibával hasalt el.
 * 2. A `JobAssetPicker` a HELYSZÍN alfája szerint kínál eszközöket, a
 *    korábbi ellenőrzés (`assetsBelongToCustomer`) viszont a SZERZŐDÉS
 *    partnerét nézte. A kettő szétcsúszhat, ha ugyanahhoz a valós
 *    partnerhez (itt: Állatkert) KÉT `Customer` sor tartozik.
 *
 * Ez a suite sorokat hoz létre és töröl, ezért csak tesztelésre megnevezett
 * adatbázison fut; lásd `integrationDatabaseGate`.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "CTR-INT-";

describe("Szerződés-tétel integritás", { skip: gate.mode === "skip" }, () => {
  const suffix = `${Date.now() % 1_000_000}`;
  const repository = new ContractsRepository();
  const service = new ContractsService(repository);

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
  });

  after(async () => {
    if (gate.mode !== "run") return;
    await removeLeftovers();
    nincsMaradek([
      {
        nev: "a suite szerződései bent maradtak a takarítás után",
        darab: await prisma.contract.count({
          where: { number: { startsWith: PREFIX } },
        }),
      },
      {
        nev: "a suite eszközei bent maradtak a takarítás után",
        darab: await prisma.asset.count({
          where: { assetNumber: { startsWith: PREFIX } },
        }),
      },
      {
        nev: "a suite helyszínei bent maradtak a takarítás után",
        darab: await prisma.worksheetDepartment.count({
          where: { customer: { customerNumber: { startsWith: PREFIX } } },
        }),
      },
      {
        nev: "a suite vevői bent maradtak a takarítás után",
        darab: await prisma.customer.count({
          where: { customerNumber: { startsWith: PREFIX } },
        }),
      },
    ]);
  });

  /**
   * A SORREND KÖTÖTT: a `MaintenanceOrderItem` a `ContractItem`-re
   * `Restrict`-tel mutat, az `Asset` a `WorksheetDepartment`-re szintén
   * `Restrict`-tel, a `WorksheetDepartment` pedig a `Customer`-re -- tehát
   * belülről kifelé kell törölni, különben a takarítás maga akadna el
   * ugyanazon a megkötésen, amit a suite mér.
   */
  async function removeLeftovers() {
    const customers = await prisma.customer.findMany({
      where: { customerNumber: { startsWith: PREFIX } },
      select: { id: true },
    });
    const customerIds = customers.map((row) => row.id);

    const contracts = await prisma.contract.findMany({
      where: { number: { startsWith: PREFIX } },
      select: { id: true },
    });
    const contractIds = contracts.map((row) => row.id);
    if (contractIds.length) {
      await prisma.maintenanceOrderItem.deleteMany({
        where: { maintenanceOrder: { contractId: { in: contractIds } } },
      });
      await prisma.maintenanceOrder.deleteMany({
        where: { contractId: { in: contractIds } },
      });
      await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
    }
    await prisma.asset.deleteMany({
      where: { assetNumber: { startsWith: PREFIX } },
    });
    if (customerIds.length)
      await prisma.worksheetDepartment.deleteMany({
        where: { customerId: { in: customerIds } },
      });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }

  async function makeCustomer(tag: string) {
    return prisma.customer.create({
      data: {
        customerNumber: `${PREFIX}${suffix}-${tag}`,
        type: "COMPANY",
        displayName: `Integritás teszt ${tag} ${suffix}`,
      },
    });
  }

  it("frissítéskor a MEGLÉVŐ tétel id-je állandó marad, és a tétel-szám a küldött listáéval egyezik", async () => {
    const customer = await makeCustomer("A");
    const created = await service.create({
      customerId: customer.id,
      number: `${PREFIX}${suffix}-1`,
      title: "Éves karbantartás",
      validFrom: "2026-01-01",
      items: [
        {
          description: "Első tétel",
          unitNet: "1000",
          quantity: "1",
          occasionsPerYear: 1,
          vatRatePercent: "27",
        },
        {
          description: "Második tétel",
          unitNet: "2000",
          quantity: "1",
          occasionsPerYear: 1,
          vatRatePercent: "27",
        },
      ],
    });
    assert.ok(created);
    const contract = created!;
    assert.equal(contract.items.length, 2);
    const first = contract.items[0]!;
    const second = contract.items[1]!;

    // A VALÓDI KLIENS (`contract-detail-page.tsx` `save()`) IS A TELJES
    // TÉTEL-ADATOT KÜLDI, NEM CSAK A VÁLTOZOTT MEZŐT -- ugyanígy itt is: az
    // `id` a MEGLÉVŐ két tételen a persziszencia-vizsgálat tárgya, a
    // harmadikon (nincs `id`) az ÚJ tétel létrehozását méri.
    const patch = {
      items: [
        {
          id: first.id,
          description: "Első tétel, átírva",
          unitNet: "1000",
          quantity: "1",
          occasionsPerYear: 1,
          vatRatePercent: "27",
        },
        {
          id: second.id,
          description: "Második tétel",
          unitNet: "2000",
          quantity: "1",
          occasionsPerYear: 1,
          vatRatePercent: "27",
        },
        {
          description: "Új, harmadik tétel",
          unitNet: "3000",
          quantity: "1",
          occasionsPerYear: 1,
          vatRatePercent: "27",
        },
      ],
    } as UpdateContractDto;
    const updated = await service.update(contract.id, patch);

    assert.equal(updated.items.length, 3);
    assert.equal(updated.items[0]!.id, first.id);
    assert.equal(updated.items[0]!.description, "Első tétel, átírva");
    assert.equal(updated.items[1]!.id, second.id);
    assert.deepEqual(
      updated.items.map((item) => item.position),
      [1, 2, 3],
    );
  });

  it("P2003-at ad (409), ha egy tételt törölnénk, amihez már készült megrendelőlap", async () => {
    const customer = await makeCustomer("B");
    const contract = await service.create({
      customerId: customer.id,
      number: `${PREFIX}${suffix}-2`,
      title: "Éves karbantartás",
      validFrom: "2026-01-01",
      items: [
        {
          description: "Egyetlen tétel",
          unitNet: "1000",
          quantity: "1",
          occasionsPerYear: 1,
          vatRatePercent: "27",
        },
      ],
    });
    const item = contract!.items[0]!;
    const order = await prisma.maintenanceOrder.create({
      data: {
        contractId: contract!.id,
        number: `${PREFIX}${suffix}-ORDER`,
        occasionYear: 2026,
        items: {
          create: {
            contractItemId: item.id,
            description: item.description,
            unitNet: item.unitNet,
            quantity: item.quantity,
            vatRatePercent: item.vatRatePercent,
          },
        },
      },
    });
    assert.ok(order);

    // A TÉTELT KIHAGYJUK A KÜLDÖTT LISTÁBÓL -- ez törlési szándék, és PONT
    // ehhez a tételhez már készült megrendelőlap.
    await assert.rejects(
      () => service.update(contract!.id, { items: [] } as UpdateContractDto),
      (error: unknown) =>
        error instanceof ConflictException &&
        (error as Error).message.includes("már készült megrendelőlap"),
    );
  });

  it("a helyszín alfájában álló eszköz menthető, még ha az eszköz customerId-je NEM a szerződés partnerét mutatja", async () => {
    /*
      A DUPLIKÁLT PARTNER-REKORD SZIMULÁCIÓJA (Állatkert-eset): a szerződés
      az "A" vevőé, a helyszín is "A" alá tartozik (a `departmentBelongsToCustomer`
      ezt átengedi), az ESZKÖZ `customerId`-je viszont a MÁSIK, "B" vevőre
      mutat -- pontosan úgy, ahogy egy valós duplikált partner-rekordnál
      előállhat. A `JobAssetPicker` a helyszín alfája szerint kínálná fel
      ezt az eszközt, tehát a szervernek is el kell fogadnia.
    */
    const customerA = await makeCustomer("C1");
    const customerB = await makeCustomer("C2");
    const department = await prisma.worksheetDepartment.create({
      data: {
        customerId: customerA.id,
        code: "DEPT1",
        name: "Integritás teszt helyszín",
      },
    });
    const asset = await prisma.asset.create({
      data: {
        assetNumber: `${PREFIX}${suffix}-ASSET`,
        name: "Integritás teszt eszköz",
        departmentId: department.id,
        customerId: customerB.id,
      },
    });

    const contract = await service.create({
      customerId: customerA.id,
      number: `${PREFIX}${suffix}-3`,
      title: "Éves karbantartás",
      validFrom: "2026-01-01",
      items: [
        {
          description: "Tétel eszközzel",
          unitNet: "1000",
          quantity: "1",
          occasionsPerYear: 1,
          vatRatePercent: "27",
          departmentId: department.id,
          assetIds: [asset.id],
        },
      ],
    });

    assert.equal(contract!.items[0]!.assets.length, 1);
    assert.equal(contract!.items[0]!.assets[0]!.assetId, asset.id);
  });

  it("POZITÍV/NEGATÍV KONTROLL: a helyszín alfáján KÍVÜLI eszközt továbbra is elutasítja", async () => {
    const customer = await makeCustomer("D1");
    const otherCustomer = await makeCustomer("D2");
    const department = await prisma.worksheetDepartment.create({
      data: {
        customerId: customer.id,
        code: "DEP2A",
        name: "Integritás teszt helyszín (más ág)",
      },
    });
    const otherDepartment = await prisma.worksheetDepartment.create({
      data: {
        customerId: otherCustomer.id,
        code: "DEP2B",
        name: "Idegen helyszín",
      },
    });
    const outsideAsset = await prisma.asset.create({
      data: {
        assetNumber: `${PREFIX}${suffix}-OUTSIDE`,
        name: "Idegen eszköz",
        departmentId: otherDepartment.id,
        customerId: otherCustomer.id,
      },
    });

    await assert.rejects(
      () =>
        service.create({
          customerId: customer.id,
          number: `${PREFIX}${suffix}-4`,
          title: "Éves karbantartás",
          validFrom: "2026-01-01",
          items: [
            {
              description: "Tétel idegen eszközzel",
              unitNet: "1000",
              quantity: "1",
              occasionsPerYear: 1,
              vatRatePercent: "27",
              departmentId: department.id,
              assetIds: [outsideAsset.id],
            },
          ],
        }),
      /idegen vagy ismeretlen eszköz/,
    );
  });
});
