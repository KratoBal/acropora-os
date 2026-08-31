import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ConflictException, NotFoundException } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceAssetsController } from "./service-assets.controller.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";
import { ServiceAssetsService } from "./service-assets.service.js";

/**
 * AZ ESZKOZ TORLESE, MIND A HAROM VISSZATARTO AGGAL, ADATBAZISON.
 *
 * A `assetDeletionRefusal` egysegtesztje a SZABALYT meri (mit ad harom szamra);
 * ez a suite azt, hogy a szamok HONNAN jonnek -- vagyis hogy a lekerdezes
 * tenylegesen megtalalja a hibajegy-, munkalap- es gyerek-kapcsolatot. A ketto
 * kulon romlik el: egy helyes szabaly rossz szamokkal ugyanugy torol.
 *
 * A HIBAJEGY-AGAT SZANDEKOSAN KEZZEL VISSZUK FEL. A `ServiceJob` tablaba ma
 * egyetlen alkalmazas-kod sem ir (merve 2026-08-31: nulla `serviceJob.create`,
 * nincs vegpont), tehat ha a fixtura is csak az alkalmazason at dolgozna, ez az
 * ag SOSEM allna elo, es a rola szolo allitas nem tudna elbukni. Egy merce, ami
 * nem tud elbukni, rosszabb a semminel.
 *
 * A suite sorokat hoz letre es torol, ezert csak tesztelesre megnevezett
 * adatbazison fut; lasd integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "DEL-INT-";

/**
 * BELSOS KERO, KIIRVA. A kontroller `AuthenticatedUser`-t var; itt a partner-
 * kotes NULL, tehat a hatokor belsos. Amit ez a suite mer, az a TORLES
 * FELTETELE, nem a hatokor -- azt kulon suite meri.
 */
const INTERNAL_USER = {
  id: "internal-test-user",
  email: "internal@asset-deletion.invalid",
  displayName: "Belsős",
  role: "OWNER",
  customerId: null,
  supplierId: null,
} as AuthenticatedUser;

describe("Eszköz törlése", { skip: gate.mode === "skip" }, () => {
  const suffix = `${Date.now() % 1_000_000}`;
  const assets = new ServiceAssetsController(
    new ServiceAssetsService(new ServiceAssetsRepository()),
  );

  let free: string;
  let withServiceJob: string;
  let withWorksheetLine: string;
  let withChild: string;

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();

    const customer = await prisma.customer.create({
      data: {
        customerNumber: `${PREFIX}${suffix}`,
        type: "COMPANY",
        displayName: `Törlés teszt ${suffix}`,
      },
    });
    const asset = async (tag: string, parentAssetId?: string) =>
      (
        await prisma.asset.create({
          data: {
            assetNumber: `${PREFIX}${suffix}-${tag}`,
            name: `Törlés teszt ${tag}`,
            customerId: customer.id,
            parentAssetId,
          },
        })
      ).id;

    free = await asset("FREE");
    withServiceJob = await asset("JOB");
    withWorksheetLine = await asset("LINE");
    withChild = await asset("PARENT");
    await asset("CHILD", withChild);

    const job = await prisma.serviceJob.create({
      data: {
        jobNumber: `${PREFIX}${suffix}`,
        title: "Törlés teszt hibajegy",
        customerId: customer.id,
      },
    });
    await prisma.serviceJobAsset.create({
      data: { serviceJobId: job.id, assetId: withServiceJob },
    });

    const department = await prisma.worksheetDepartment.create({
      data: { customerId: customer.id, code: "DEL", name: "Törlés teszt" },
    });
    await prisma.worksheet.create({
      data: {
        customerId: customer.id,
        departmentId: department.id,
        versions: {
          create: {
            version: 1,
            subject: "Törlés teszt lap",
            lines: {
              create: {
                position: 1,
                description: "Törlés teszt sor",
                assetId: withWorksheetLine,
                quantity: 1,
                unit: "db",
                unitNet: 0,
                vatRatePercent: 27,
                netAmount: 0,
                vatAmount: 0,
                grossAmount: 0,
              },
            },
          },
        },
      },
    });
  });

  after(async () => {
    if (gate.mode !== "run") return;
    await removeLeftovers();
  });

  async function removeLeftovers() {
    const customers = await prisma.customer.findMany({
      where: { customerNumber: { startsWith: PREFIX } },
      select: { id: true },
    });
    const ids = customers.map((customer) => customer.id);
    if (ids.length > 0) {
      await prisma.worksheet.deleteMany({ where: { customerId: { in: ids } } });
      await prisma.serviceJob.deleteMany({
        where: { customerId: { in: ids } },
      });
      await prisma.worksheetDepartment.deleteMany({
        where: { customerId: { in: ids } },
      });
    }
    // A gyerek ELOSZOR, mert a szulore mutato hivatkozas `SetNull`, de a
    // torlesi sorrend igy olvashato marad.
    await prisma.asset.deleteMany({
      where: {
        assetNumber: { startsWith: PREFIX },
        parentAssetId: { not: null },
      },
    });
    await prisma.asset.deleteMany({
      where: { assetNumber: { startsWith: PREFIX } },
    });
    await prisma.customer.deleteMany({
      where: { customerNumber: { startsWith: PREFIX } },
    });
  }

  /**
   * A KONTROLL: enelkul a harom visszautasitas ugy is igaz lenne, ha a vegpont
   * MINDIG megtagadna a torlest.
   */
  it("kontroll: a szabad eszköz törölhető, és utána tényleg nincs", async () => {
    assert.deepEqual(await assets.remove(free), { ok: true });
    assert.equal(await prisma.asset.findUnique({ where: { id: free } }), null);
    await assert.rejects(
      () => assets.detail(free, INTERNAL_USER),
      NotFoundException,
    );
  });

  it("hibajegyhez tartozó eszköz NEM törölhető, és megmarad", async () => {
    await assert.rejects(
      () => assets.remove(withServiceJob),
      (error: Error) =>
        error instanceof ConflictException && /hibajegy/.test(error.message),
    );
    assert.ok(
      await prisma.asset.findUnique({ where: { id: withServiceJob } }),
      "az őrző akkor őrző, ha nem történt semmi",
    );
  });

  it("munkalapsorhoz tartozó eszköz NEM törölhető, és megmarad", async () => {
    await assert.rejects(
      () => assets.remove(withWorksheetLine),
      (error: Error) =>
        error instanceof ConflictException && /munkalapsor/.test(error.message),
    );
    assert.ok(
      await prisma.asset.findUnique({ where: { id: withWorksheetLine } }),
    );
  });

  /**
   * A HARMADIK AG AZ EN OLVASATOM, nem Balazs szava -- lasd az
   * `asset-deletion.ts` jegyzetet. A sema `SetNull`-t hasznal, tehat enelkul a
   * torles ATMENNE, es a gyerekek CSENDBEN gyoker szintre kerulnenek.
   */
  it("alárendelt eszközzel rendelkező eszköz NEM törölhető", async () => {
    await assert.rejects(
      () => assets.remove(withChild),
      (error: Error) =>
        error instanceof ConflictException && /alárendelt/.test(error.message),
    );
    assert.ok(await prisma.asset.findUnique({ where: { id: withChild } }));
  });

  it("nem létező eszköz törlése 404", async () => {
    await assert.rejects(
      () => assets.remove("cmth0000000000000000000000"),
      NotFoundException,
    );
  });
});
