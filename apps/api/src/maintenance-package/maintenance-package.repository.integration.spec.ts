import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { MaintenancePackageRepository } from "./maintenance-package.repository.js";

/**
 * A CSOMAG LEKÉRDEZÉSE VALÓDI ADATBÁZISON (t-20261118-csomag-kapu-letoltes; Luca 2026-11-18 14:43; barracuda, #2696): az igazolás két példánya közül CSAK a legújabb aláírt (`SIGNED_FORM`) és a
 * legújabb kiállított (`GENERATED_FORM`) jön vissza a bájtjaival, két külön, `take 1`-es lekérdezésből (egy közös select minden feltöltött aláírt példány bájtját a memóriába hozná; a feltöltés
 * ismételhető). MI PIROSÍT: ha az ismételten feltöltött aláírt példányok közül nem a legújabb jön; ha a kiállított példány hiányzik; ha igazolás nélkül a `documents` nem üres / a
 * `completionCertificate` nem `null`; ha több mint két példány jön vissza.
 *
 * A HELYI FUTÁS EZEN NEM MÉR SEMMIT: nincs helyi postgres. A "megírtam" és a "lefutott" közé a CI esik.
 */
const gate = integrationDatabaseGate(process.env);
const TEST_CUSTOMER = "PKG-REPO-TEST";

describe(
  "a karbantartási csomag lekérdezése: az igazolás példányai (valódi adatbázis)",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new MaintenancePackageRepository();
    let customerId = "";
    let departmentId = "";

    async function removeLeftovers() {
      await prisma.completionCertificate.deleteMany({
        where: { number: { startsWith: "PKGREPO-" } },
      });
      const customers = await prisma.customer.findMany({
        where: { customerNumber: { startsWith: TEST_CUSTOMER } },
        select: { id: true },
      });
      const ids = customers.map((customer) => customer.id);
      if (ids.length) {
        // a munkalapok (a lapon létrehozott és a hozzárendelt) a lap előtt: a kapcsolat a lappal együtt törlődik
        await prisma.worksheet.deleteMany({
          where: { customerId: { in: ids } },
        });
        await prisma.serviceJob.deleteMany({
          where: { customerId: { in: ids } },
        });
        await prisma.worksheetDepartment.deleteMany({
          where: { customerId: { in: ids } },
        });
        await prisma.customer.deleteMany({ where: { id: { in: ids } } });
      }
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      customerId = (
        await prisma.customer.create({
          data: {
            customerNumber: `${TEST_CUSTOMER}-${Date.now() % 1_000_000}`,
            type: "COMPANY",
            displayName: "Csomag repo teszt",
          },
          select: { id: true },
        })
      ).id;
      departmentId = (
        await prisma.worksheetDepartment.create({
          data: { customerId, code: "PKR", name: "Csomag" },
          select: { id: true },
        })
      ).id;
    });

    after(async () => {
      await removeLeftovers();
    });

    const job = (jobNumber: string) =>
      prisma.serviceJob.create({
        data: {
          jobNumber,
          kind: "MAINTENANCE",
          title: jobNumber,
          customerId,
          departmentId,
        },
        select: { id: true },
      });
    const doc = (
      type: "SIGNED_FORM" | "GENERATED_FORM",
      fileName: string,
      createdAt: string,
    ) => ({
      type,
      fileName,
      contentType: "application/pdf",
      sizeBytes: 4,
      content: Buffer.from(`%PDF-${fileName}`),
      createdAt: new Date(createdAt),
    });

    it("az ismételten feltöltött aláírt példányok közül a legújabb, plusz a kiállított jön vissza; más nem", async () => {
      const { id } = await job("KT-2097-001");
      await prisma.completionCertificate.create({
        data: {
          serviceJobId: id,
          number: "PKGREPO-001",
          documents: {
            create: [
              doc("GENERATED_FORM", "kiallitott.pdf", "2097-01-01T09:00:00Z"),
              doc("SIGNED_FORM", "alairt-regi.pdf", "2097-01-02T09:00:00Z"),
              doc("SIGNED_FORM", "alairt-uj.pdf", "2097-01-03T09:00:00Z"),
            ],
          },
        },
      });

      const data = await repository.packageData(id);
      const documents = data?.completionCertificate?.documents ?? [];
      assert.deepEqual(
        documents.map((d) => [d.type, d.fileName]),
        [
          ["SIGNED_FORM", "alairt-uj.pdf"],
          ["GENERATED_FORM", "kiallitott.pdf"],
        ],
      );
      assert.equal(
        Buffer.from(documents[0]!.content!).toString(),
        "%PDF-alairt-uj.pdf",
      );
    });

    it("csak kiállított példánynál az az egy; igazolás nélkül a completionCertificate null", async () => {
      const onlyIssued = await job("KT-2097-002");
      await prisma.completionCertificate.create({
        data: {
          serviceJobId: onlyIssued.id,
          number: "PKGREPO-002",
          documents: {
            create: [
              doc("GENERATED_FORM", "kiallitott2.pdf", "2097-01-01T09:00:00Z"),
            ],
          },
        },
      });
      const a = await repository.packageData(onlyIssued.id);
      assert.deepEqual(
        a?.completionCertificate?.documents.map((d) => d.type),
        ["GENERATED_FORM"],
      );

      const none = await job("KT-2097-003");
      const b = await repository.packageData(none.id);
      assert.equal(b?.completionCertificate, null);
    });

    it("a hozzárendelt (kapcsolódó) munkalap a linkedWorksheets-ben jön vissza, nem a worksheets-ben (Luca, kártya 5afb868a)", async () => {
      const { id } = await job("KT-2097-004");
      const own = await prisma.worksheet.create({
        data: { customerId, departmentId, serviceJobId: id },
        select: { id: true },
      });
      const assigned = await prisma.worksheet.create({
        data: { customerId, departmentId },
        select: { id: true },
      });
      await prisma.serviceJobLinkedWorksheet.create({
        data: { serviceJobId: id, worksheetId: assigned.id },
      });
      const data = await repository.packageData(id);
      assert.deepEqual(
        data?.worksheets.map((sheet) => sheet.id),
        [own.id],
      );
      assert.deepEqual(
        data?.linkedWorksheets.map((link) => link.worksheet.id),
        [assigned.id],
      );
    });
  },
);
