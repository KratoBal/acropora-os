import "reflect-metadata";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { MaintenanceOrdersRepository } from "./maintenance-orders.repository.js";

/**
 * A VEVŐ SAJÁT MEGRENDELŐLAPJA ADATBÁZISON (karbantartási felmérés S6).
 *
 * A szolgáltatás tesztje a repository-t hamisítja, tehát két dolog csak itt
 * mérhető: hogy a `createCustomerForm` sora tényleg `CUSTOMER_FORM` forrású,
 * `SIGNED`, és a PDF `CUSTOMER_FORM` dokumentumként áll mellette; és hogy a
 * `customerFormDuplicate` a kettős beküldést pontosan akkor ismeri fel, amikor
 * kell. MI PIROSÍT: egy bájtra azonos PDF ugyanazokra a tételekre nem ismétlés;
 * egy azonos méretű, de más PDF ismétlés; más tétel-halmaz ismétlés; egy
 * visszavont megrendelőlap még mindig ismétlésnek számít.
 *
 * Ez a suite sorokat hoz létre és töröl, ezért csak tesztelésre megnevezett
 * adatbázison fut; lásd `integrationDatabaseGate`.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "MOC-INT-";

describe(
  "Megrendelőlap: a vevő saját megrendelőlapja",
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
     * BELÜLRŐL KIFELÉ: a megrendelőlap a szerződésre `Restrict`-tel mutat (a
     * tételei és a dokumentumai kaszkádolnak), a szerződés a vevőre és a
     * helyszínre, a helyszín a vevőre.
     */
    async function removeLeftovers() {
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

    it("a sor CUSTOMER_FORM, SIGNED, és az ismétlést pontosan felismeri", async () => {
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}${suffix}`,
          type: "COMPANY",
          displayName: `Vevői megrendelőlap teszt ${suffix}`,
        },
      });
      const department = await prisma.worksheetDepartment.create({
        data: { customerId: customer.id, code: "CAPA", name: "Cápasuli" },
      });
      const contract = await prisma.contract.create({
        data: {
          customerId: customer.id,
          number: `${PREFIX}${suffix}-1`,
          title: "Cápasuli karbantartás",
          validFrom: new Date("2026-01-01"),
          status: "ACTIVE",
        },
      });
      const item = (position: number) =>
        prisma.contractItem.create({
          data: {
            contractId: contract.id,
            position,
            description: `Tétel ${position}`,
            unitNet: new Prisma.Decimal(100000),
            quantity: new Prisma.Decimal(1),
            occasionsPerYear: 4,
            vatRatePercent: new Prisma.Decimal(27),
            departmentId: department.id,
          },
        });
      const first = await item(1);
      const second = await item(2);
      const pdf = Buffer.from("%PDF-1.4 vevoi megrendelolap A");
      const sameSizeOther = Buffer.from("%PDF-1.4 vevoi megrendelolap B");
      assert.equal(pdf.length, sameSizeOther.length);

      const order = await repository.createCustomerForm({
        contractId: contract.id,
        number: `${PREFIX}${suffix}-MR`,
        occasionYear: 2026,
        issuedByName: "Teszt Elek",
        items: [first, second].map((row) => ({
          contractItemId: row.id,
          description: row.description,
          unitNet: row.unitNet,
          quantity: row.quantity,
          vatRatePercent: row.vatRatePercent,
        })),
        document: {
          fileName: "vevo.pdf",
          contentType: "application/pdf",
          content: pdf,
        },
      });
      assert.equal(order.source, "CUSTOMER_FORM");
      assert.equal(order.status, "SIGNED");
      assert.ok(order.signedAt);
      assert.equal(order.serviceJobId, null);
      const documents = await prisma.maintenanceOrderDocument.findMany({
        where: { maintenanceOrderId: order.id },
        select: { type: true, sizeBytes: true, content: true },
      });
      assert.equal(documents.length, 1);
      assert.equal(documents[0]?.type, "CUSTOMER_FORM");
      assert.ok(Buffer.from(documents[0]!.content!).equals(pdf));

      const duplicate = (itemIds: string[], content: Buffer) =>
        repository.customerFormDuplicate({
          contractId: contract.id,
          itemIds,
          content,
        });
      // ugyanaz a PDF, ugyanazok a tételek (más sorrendben is): ismétlés
      assert.equal(
        await duplicate([second.id, first.id], pdf),
        `${PREFIX}${suffix}-MR`,
      );
      // azonos méretű, de más PDF: új rendelés, nem ismétlés
      assert.equal(await duplicate([first.id, second.id], sameSizeOther), null);
      // más tétel-halmaz: nem ismétlés
      assert.equal(await duplicate([first.id], pdf), null);
      // visszavonva: többé nem ismétlés
      await prisma.maintenanceOrder.update({
        where: { id: order.id },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
      assert.equal(await duplicate([first.id, second.id], pdf), null);
    });
  },
);
