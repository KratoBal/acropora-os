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
          // A HELYSZIN 2026-09-22 ota KOTELEZO (Balazs dontese, message_id
          // 1552018256280162385: "1 legyen kotelezo"). A fixtura eddig is
          // letrehozta az egyseget, csak nem kototte a jegyhez -- az allitasok
          // a mezo-esemenyeket merik, a helyszin nem resze egyiknek sem.
          departmentId: egysegId,
        },
        select: { id: true },
      });
      jegyId = jegy.id;
    });

    after(takarit);

    it("E1: a leírás írása FIELDS_EDITED fajtájú sort ír", async () => {
      const ok = await repository.updateFields({
        serviceJobId: jegyId,
        fields: { title: "Javított cím", description: "Új leírás" },
        note: "A hibajegy címe és leírása módosult.",
        actorUserId: null,
      });

      assert.equal(ok, true);
      assert.deepEqual(await fajtak(), ["FIELDS_EDITED"]);

      /**
       * ES A MEZOK TENYLEG ATIRODTAK. Enelkul az allitas csak a NAPLOSORT
       * merne, es zold maradna egy olyan megvalositason, ami naplot ir, de a
       * jegyhez nem nyul.
       */
      const jegy = await prisma.serviceJob.findUniqueOrThrow({
        where: { id: jegyId },
        select: { title: true, description: true },
      });
      assert.deepEqual(jegy, {
        title: "Javított cím",
        description: "Új leírás",
      });
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
     * E3: A `NOTIFICATION_SENT` SOR IS KELETKEZHET -- EGY MEGLEVO RES ZARASA.
     *
     * A fajta 2026-09-02 ota all az enumban, es a kod IR ilyen sort
     * (`ticket-mail.repository.ts`, `recordNotification`), a megkotes viszont
     * SOHA nem kapott ra agat: minden ilyen iras a CHECK-en dobott. Merve
     * 2026-09-22, ugyanabban a korben, mint a `FIELDS_EDITED` bukasa -- es
     * ugyanaz az egy sor zarja mind a kettot.
     *
     * KOZVETLENUL A `prisma`-val ir, nem a tarolon at: a kerdes az ADATBAZIS
     * megkoteserol szol, nem arrol, hogy a levelezo modul helyesen hivja-e.
     */
    it("E3: a NOTIFICATION_SENT sor is keletkezhet", async () => {
      await prisma.serviceJobEvent.create({
        data: {
          serviceJobId: jegyId,
          kind: "NOTIFICATION_SENT",
          note: "Teszt értesítés",
        },
      });

      assert.ok((await fajtak()).includes("NOTIFICATION_SENT"));
    });

    /**
     * KONTROLL: A MEGKOTES TOVABBRA IS MEGKOT.
     *
     * A harom fenti allitas ZOLD LENNE akkor is, ha a migracio a megkotest
     * ELDOBTA volna, ahelyett hogy bovitette. Ez a sor valasztja szet a kettot:
     * egy `STATUS_CHANGE` `toStatus` NELKUL tovabbra is elutasitas.
     */
    it("KONTROLL: a STATUS_CHANGE cél-állapot nélkül továbbra is elutasítás", async () => {
      await assert.rejects(() =>
        prisma.serviceJobEvent.create({
          data: { serviceJobId: jegyId, kind: "STATUS_CHANGE" },
        }),
      );
    });

    /**
     * KONTROLL: a fajta NEM az alapertelmezes. Enelkul a ket fenti allitas
     * ugyanugy zold lenne egy olyan megvalositason, ami a `kind` mezot
     * kihagyja -- csak akkor `STATUS_CHANGE` allna a sorokban.
     */
    it("KONTROLL: egyetlen sor sem STATUS_CHANGE", async () => {
      const mind = await fajtak();

      assert.equal(mind.length, 3, "a harom fenti allitas irta oket");
      assert.ok(!mind.includes("STATUS_CHANGE"));
    });
  },
);
