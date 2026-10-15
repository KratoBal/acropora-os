import "reflect-metadata";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { MaintenanceOrdersRepository } from "./maintenance-orders.repository.js";

/**
 * A SZERZŐDÉS-TÉTELEK ESZKÖZEI, AHOGY AZ ALÁÍRÁS ÁTVISZI ŐKET (karbantartási
 * felmérés S1, 2026-10-15), ADATBÁZISON.
 *
 * A `MaintenanceOrdersRepository.itemAssetsOnSite()` tételenként adja vissza a
 * `ContractItemAsset` eszközöket, de csak azokat, amik a tétel helyszínének
 * RÉSZFÁJÁN állnak. A szolgáltatás tesztje ezt a metódust hamisítja, tehát a
 * szűrés maga csak itt mérhető. MI PIROSÍT: ha egy másik ágra költözött eszköz
 * átjön (a lap és a munkalap létrehozása ekkor hibát dobna); ha egy gyerek-
 * helyszínen álló eszköz kiesik a felső helyszínű tételből; ha egy tétel a
 * másik tétel eszközét is megkapja; ha az eszköz nélküli tétel hiányzik a
 * válaszból.
 *
 * Ez a suite sorokat hoz létre és töröl, ezért csak tesztelésre megnevezett
 * adatbázison fut; lásd `integrationDatabaseGate`.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "MOA-INT-";

describe(
  "Megrendelőlap: a tételek helyszínen álló eszközei",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    const repository = new MaintenanceOrdersRepository();

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
     * BELÜLRŐL KIFELÉ: a `ContractItemAsset` az `Asset`-re `Restrict`-tel
     * mutat (a szerződés törlése kaszkádolja), az `Asset` a helyszínre, a
     * helyszín a vevőre. A gyerek-helyszín a szülőjére mutat, ezért előbb a
     * gyerekek mennek.
     */
    async function removeLeftovers() {
      const customers = await prisma.customer.findMany({
        where: { customerNumber: { startsWith: PREFIX } },
        select: { id: true },
      });
      const customerIds = customers.map((row) => row.id);
      await prisma.contract.deleteMany({
        where: { number: { startsWith: PREFIX } },
      });
      await prisma.asset.deleteMany({
        where: { assetNumber: { startsWith: PREFIX } },
      });
      if (customerIds.length) {
        await prisma.worksheetDepartment.deleteMany({
          where: { customerId: { in: customerIds }, parentId: { not: null } },
        });
        await prisma.worksheetDepartment.deleteMany({
          where: { customerId: { in: customerIds } },
        });
      }
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    }

    it("tételenként csak a tétel helyszínének részfáján álló eszközöket adja", async () => {
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}${suffix}`,
          type: "COMPANY",
          displayName: `Megrendelőlap eszköz teszt ${suffix}`,
        },
      });
      const capasuli = await prisma.worksheetDepartment.create({
        data: { customerId: customer.id, code: "CAPA", name: "Cápasuli" },
      });
      const kismedence = await prisma.worksheetDepartment.create({
        data: {
          customerId: customer.id,
          code: "KISM",
          name: "Kismedence",
          parentId: capasuli.id,
        },
      });
      const nagymedence = await prisma.worksheetDepartment.create({
        data: {
          customerId: customer.id,
          code: "NAGY",
          name: "Nagymedence",
          parentId: capasuli.id,
        },
      });
      const asset = (tag: string, departmentId: string) =>
        prisma.asset.create({
          data: {
            assetNumber: `${PREFIX}${suffix}-${tag}`,
            name: `Teszt eszköz ${tag}`,
            departmentId,
            customerId: customer.id,
          },
        });
      const szivattyu = await asset("SZIV", kismedence.id);
      // a szerződés óta a nagymedencébe költözött: a kismedence tételéből kiesik
      const atkoltozott = await asset("ATKO", nagymedence.id);
      const uvLampa = await asset("UV", nagymedence.id);

      const contract = await prisma.contract.create({
        data: {
          customerId: customer.id,
          number: `${PREFIX}${suffix}-1`,
          title: "Cápasuli karbantartás",
          validFrom: new Date("2026-01-01"),
          status: "ACTIVE",
        },
      });
      const item = (
        position: number,
        departmentId: string,
        assetIds: string[],
      ) =>
        prisma.contractItem.create({
          data: {
            contractId: contract.id,
            position,
            description: `Tétel ${position}`,
            unitNet: new Prisma.Decimal(100000),
            quantity: new Prisma.Decimal(1),
            occasionsPerYear: 4,
            vatRatePercent: new Prisma.Decimal(27),
            departmentId,
            assets: { create: assetIds.map((assetId) => ({ assetId })) },
          },
        });
      const kisTetel = await item(1, kismedence.id, [
        szivattyu.id,
        atkoltozott.id,
      ]);
      // a felső helyszínű tétel a gyerek-helyszínek eszközeit is megtartja
      const felsoTetel = await item(2, capasuli.id, [uvLampa.id, szivattyu.id]);
      const uresTetel = await item(3, nagymedence.id, []);

      const result = await repository.itemAssetsOnSite([
        { contractItemId: kisTetel.id, departmentId: kismedence.id },
        { contractItemId: felsoTetel.id, departmentId: capasuli.id },
        { contractItemId: uresTetel.id, departmentId: nagymedence.id },
      ]);

      assert.deepEqual(result.get(kisTetel.id), [szivattyu.id]);
      assert.deepEqual(
        [...(result.get(felsoTetel.id) ?? [])].sort(),
        [uvLampa.id, szivattyu.id].sort(),
      );
      assert.deepEqual(result.get(uresTetel.id), []);
      assert.equal(result.size, 3);
    });
  },
);
