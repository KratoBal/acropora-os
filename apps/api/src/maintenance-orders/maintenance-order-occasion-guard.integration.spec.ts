import "reflect-metadata";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { maintenanceOrderOccasionYear } from "./maintenance-order-occasion-year.js";
import { MaintenanceOrdersRepository } from "./maintenance-orders.repository.js";

/**
 * AZ ÉVES ALKALOMKERET FOGLALÁSA, ADATBÁZISON (karbantartási felmérés S0/1,
 * zár: barracuda 31567).
 *
 * A `MaintenanceOrdersRepository.reserveOccasions()` szerződésenkénti zár
 * alatt számol és ír. A szolgáltatás tesztje ezt a metódust hamisítja, tehát a
 * számlálás és a zár csak itt mérhető. MI PIROSÍT:
 *   - ha a megrendelőlap nélküli lap sora nem számít bele a keretbe (a B út
 *     megkerülné a keretet);
 *   - ha a visszavont megrendelőlap, a lemondott lap vagy a megrendelőlapos lap
 *     sora mégis beleszámít (az utóbbi kétszer foglalna egy alkalmat);
 *   - ha túllépésnél a hívó beszúrása mégis lefut;
 *   - ha két egyszerre indított foglalás az utolsó alkalomra MINDKETTŐ átmegy
 *     (a zár hiánya).
 *
 * Ez a suite sorokat hoz létre és töröl, ezért csak tesztelésre megnevezett
 * adatbázison fut; lásd `integrationDatabaseGate`.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "MOG-INT-";

describe(
  "Megrendelőlap: az éves alkalomkeret foglalása zárral",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    const repository = new MaintenanceOrdersRepository();
    const year = maintenanceOrderOccasionYear(new Date());

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "a suite lapjai bent maradtak a takarítás után",
          darab: await prisma.serviceJob.count({
            where: { jobNumber: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite megrendelőlapjai bent maradtak a takarítás után",
          darab: await prisma.maintenanceOrder.count({
            where: { number: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite szerződései bent maradtak a takarítás után",
          darab: await prisma.contract.count({
            where: { number: { startsWith: PREFIX } },
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
     * BELÜLRŐL KIFELÉ: a lap törlése viszi a `ServiceJobContractItem` sorait
     * (Cascade); a megrendelőlap tétele a szerződés-tételre `Restrict`-tel
     * mutat, a megrendelőlap a szerződésre szintén; a lap a helyszínre
     * `Restrict`-tel; a helyszín a vevőre.
     */
    async function removeLeftovers() {
      await prisma.serviceJob.deleteMany({
        where: { jobNumber: { startsWith: PREFIX } },
      });
      await prisma.maintenanceOrderItem.deleteMany({
        where: { maintenanceOrder: { number: { startsWith: PREFIX } } },
      });
      await prisma.maintenanceOrder.deleteMany({
        where: { number: { startsWith: PREFIX } },
      });
      await prisma.contract.deleteMany({
        where: { number: { startsWith: PREFIX } },
      });
      const customers = await prisma.customer.findMany({
        where: { customerNumber: { startsWith: PREFIX } },
        select: { id: true },
      });
      const customerIds = customers.map((row) => row.id);
      if (customerIds.length)
        await prisma.worksheetDepartment.deleteMany({
          where: { customerId: { in: customerIds } },
        });
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    }

    let counter = 0;
    const next = () => `${PREFIX}${suffix}-${++counter}`;

    async function setup(occasions: readonly number[]) {
      const customer = await prisma.customer.create({
        data: {
          customerNumber: next(),
          type: "COMPANY",
          displayName: `Alkalomkeret teszt ${suffix}`,
        },
      });
      const department = await prisma.worksheetDepartment.create({
        data: { customerId: customer.id, code: "KERT", name: "Keret teszt" },
      });
      const contract = await prisma.contract.create({
        data: {
          customerId: customer.id,
          number: next(),
          title: "Keret teszt",
          validFrom: new Date("2026-01-01"),
          status: "ACTIVE",
        },
      });
      const items = [];
      for (const [index, occasionsPerYear] of occasions.entries())
        items.push(
          await prisma.contractItem.create({
            data: {
              contractId: contract.id,
              position: index + 1,
              description: `Tétel ${index + 1}`,
              unitNet: new Prisma.Decimal(100000),
              quantity: new Prisma.Decimal(1),
              occasionsPerYear,
              vatRatePercent: new Prisma.Decimal(27),
              departmentId: department.id,
            },
          }),
        );
      return { customer, department, contract, items };
    }

    type Item = Awaited<ReturnType<typeof setup>>["items"][number];
    const orderItem = (item: Item) => ({
      contractItemId: item.id,
      description: item.description,
      unitNet: item.unitNet,
      quantity: item.quantity,
      vatRatePercent: item.vatRatePercent,
    });
    const reserveInput = (contractId: string, items: readonly Item[]) => ({
      contractId,
      year,
      items: items.map((item) => ({
        contractItemId: item.id,
        description: item.description,
        occasionsPerYear: item.occasionsPerYear,
      })),
    });

    it("a megrendelőlap nélküli lap sora beleszámít; a visszavont, a lemondott és a megrendelőlapos nem", async () => {
      const { customer, department, contract, items } = await setup([2, 1]);
      const [a, b] = items as [Item, Item];
      const order = (status: "ISSUED" | "REVOKED", item: Item) =>
        prisma.maintenanceOrder.create({
          data: {
            contractId: contract.id,
            number: next(),
            occasionYear: year,
            status,
            items: { create: [orderItem(item)] },
          },
        });
      const job = (status: "NEW" | "CANCELLED", item: Item) =>
        prisma.serviceJob.create({
          data: {
            jobNumber: next(),
            title: "Keret teszt lap",
            kind: "MAINTENANCE",
            status,
            customerId: customer.id,
            departmentId: department.id,
            contractId: contract.id,
            contractItems: {
              create: [
                {
                  contractItemId: item.id,
                  description: item.description,
                  unitNet: item.unitNet,
                  quantity: item.quantity,
                  vatRatePercent: item.vatRatePercent,
                },
              ],
            },
          },
        });

      // A tétel: 1 kiállított megrendelőlap + 1 megrendelőlap nélküli lap = 2 = a kerete
      await order("ISSUED", a);
      await order("REVOKED", a);
      await job("NEW", a);
      // B tétel: csak lemondott lap és megrendelőlapos lap: 0 a felhasználás
      await job("CANCELLED", b);
      const withOrder = await job("NEW", b);
      const bOrder = await order("ISSUED", b);
      await prisma.maintenanceOrder.update({
        where: { id: bOrder.id },
        data: { serviceJobId: withOrder.id, status: "REVOKED" },
      });

      let writes = 0;
      const write = async () => {
        writes += 1;
        return "írva";
      };
      const exhausted = await repository.reserveOccasions(
        reserveInput(contract.id, [a]),
        write,
      );
      const free = await repository.reserveOccasions(
        reserveInput(contract.id, [b]),
        write,
      );
      assert.deepEqual(
        [exhausted, free, writes],
        [{ ok: false, exhausted: ["Tétel 1"] }, { ok: true, value: "írva" }, 1],
      );
    });

    it("S4: a beszúrt tételsor árrögzítéssel áll, az állapot megszámolja, és a következő foglalás már felhasználásnak látja", async () => {
      const { customer, department, contract, items } = await setup([1]);
      const [d] = items as [Item];
      const job = await prisma.serviceJob.create({
        data: {
          jobNumber: next(),
          title: "Keret teszt lap (B út)",
          kind: "MAINTENANCE",
          customerId: customer.id,
          departmentId: department.id,
          contractId: contract.id,
        },
      });
      const before = await repository.serviceJobContractItemState(job.id);
      const first = await repository.reserveOccasions(
        reserveInput(contract.id, [d]),
        (tx) =>
          repository.insertServiceJobContractItems(tx, job.id, [
            {
              contractItemId: d.id,
              description: d.description,
              unitNet: d.unitNet,
              quantity: d.quantity,
              vatRatePercent: d.vatRatePercent,
            },
          ]),
      );
      const after = await repository.serviceJobContractItemState(job.id);
      const stored = await prisma.serviceJobContractItem.findMany({
        where: { serviceJobId: job.id },
        select: { contractItemId: true, unitNet: true },
      });
      const second = await repository.reserveOccasions(
        reserveInput(contract.id, [d]),
        async () => "nem kellene lefutnia",
      );
      assert.deepEqual(
        [
          before?.itemCount,
          first.ok,
          after?.itemCount,
          stored.map((row) => [row.contractItemId, row.unitNet.toString()]),
          second,
        ],
        [0, true, 1, [[d.id, "100000"]], { ok: false, exhausted: ["Tétel 1"] }],
      );
    });

    it("két egyszerre indított foglalás az utolsó alkalomra: pontosan egy megy át", async () => {
      const { contract, items } = await setup([1]);
      const [c] = items as [Item];
      const attempt = () =>
        repository.reserveOccasions(
          reserveInput(contract.id, [c]),
          async (tx) => {
            // a késleltetés nélkül a két tranzakció ritkán fedné egymást
            await new Promise((resolve) => setTimeout(resolve, 300));
            return repository.issue(
              {
                contractId: contract.id,
                number: next(),
                occasionYear: year,
                issuedByName: null,
                items: [orderItem(c)],
                document: {
                  fileName: "keret-teszt.docx",
                  contentType: "application/pdf",
                  sizeBytes: 1,
                  content: Buffer.from("x"),
                },
              },
              tx,
            );
          },
        );
      const results = await Promise.all([attempt(), attempt()]);
      assert.deepEqual(
        [
          results.map((result) => result.ok).sort(),
          await prisma.maintenanceOrder.count({
            where: { contractId: contract.id },
          }),
        ],
        [[false, true], 1],
      );
    });
  },
);
