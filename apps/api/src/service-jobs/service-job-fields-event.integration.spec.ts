import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";

/**
 * A MEZO-VALTOZAS NAPLOSORT IR -- ES A FAJTAJA A LENYEG, NEM A LETEZESE.
 *
 * A `ServiceJobEvent.kind` alapertelmezese `STATUS_CHANGE` (schema.prisma:3442).
 * Egy `kind` nelkul irt sor tehat NEM hianyosnak latszik, hanem
 * ALLAPOTVALTASNAK -- es egy "van-e esemeny" alaku allitas a ROSSZ fajtara is
 * zold lenne. Ezert mind a ket allitas az ERTEKRE mer.
 *
 * MIERT INTEGRACIOS, ES NEM EGYSEG-TESZT: a `ServiceJobsRepository` a `prisma`
 * peldanyt BEDROTOZZA (`private readonly database = prisma`), tehat duplaval
 * nem peldanyosithato. Az elso futasa a CI.
 *
 * E1 es E2 KET KULON ALLITAS, KET KULON UTRA. Egy kozos allitas, ami mindkettot
 * fedne, nem bizonyitana, hogy a ket ut kulon-kulon naplozik -- es pont az a
 * hiba, amit el akarunk kerulni: a naplo a KISEBB valtozast rogziti es a
 * NAGYOBBAT nem.
 */

const gate = integrationDatabaseGate(process.env);
const PREFIX = "ITFIELDSEVT";

const repository = new ServiceJobsRepository();
let ugyfelId = "";
let egysegId = "";
let jegyId = "";

async function takarit() {
  await prisma.serviceJobEvent.deleteMany({
    where: { serviceJob: { jobNumber: { startsWith: PREFIX } } },
  });
  await prisma.serviceJob.deleteMany({
    where: { jobNumber: { startsWith: PREFIX } },
  });
  await prisma.worksheetDepartment.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

async function fajtak(): Promise<string[]> {
  const sorok = await prisma.serviceJobEvent.findMany({
    where: { serviceJobId: jegyId },
    select: { kind: true },
  });
  return sorok.map((sor) => String(sor.kind));
}

describe(
  "a jegy mező-változásának naplósora",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await takarit();
      const ugyfel = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}001`,
          type: "COMPANY",
          displayName: `${PREFIX} Teszt Ugyfel`,
        },
        select: { id: true },
      });
      ugyfelId = ugyfel.id;
      const egyseg = await prisma.worksheetDepartment.create({
        data: { customerId: ugyfelId, code: "AKV", name: "Akvárium" },
        select: { id: true },
      });
      egysegId = egyseg.id;
      const jegy = await prisma.serviceJob.create({
        data: {
          jobNumber: `${PREFIX}-0001`,
          title: "Teszt hibajegy",
          customerId: ugyfelId,
        },
        select: { id: true },
      });
      jegyId = jegy.id;
    });

    after(takarit);

    it("E1: a leírás írása FIELDS_EDITED fajtájú sort ír", async () => {
      const ok = await repository.updateFields({
        serviceJobId: jegyId,
        description: "Új leírás",
        actorUserId: null,
      });

      assert.equal(ok, true);
      assert.deepEqual(await fajtak(), ["FIELDS_EDITED"]);
    });

    it("E2: a helyszín-átvezetés is FIELDS_EDITED fajtájú sort ír", async () => {
      const ok = await repository.setPlacement({
        serviceJobId: jegyId,
        departmentId: egysegId,
        assetIds: [],
        worksheetIds: [],
        actorUserId: null,
      });

      assert.equal(ok, true);
      assert.deepEqual(await fajtak(), ["FIELDS_EDITED", "FIELDS_EDITED"]);
    });

    /**
     * KONTROLL: a fajta NEM az alapertelmezes. Enelkul a ket fenti allitas
     * ugyanugy zold lenne egy olyan megvalositason, ami a `kind` mezot
     * kihagyja -- csak akkor `STATUS_CHANGE` allna a sorokban.
     */
    it("KONTROLL: egyetlen sor sem STATUS_CHANGE", async () => {
      const mind = await fajtak();

      assert.equal(mind.length, 2, "a ket fenti allitas irta oket");
      assert.ok(!mind.includes("STATUS_CHANGE"));
    });
  },
);
