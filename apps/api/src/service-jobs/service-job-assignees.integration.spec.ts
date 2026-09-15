import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";

/**
 * A DELEGALAS ADATBAZIS-SZINTU IGERETEI.
 *
 * Harom allitas all a semaban, es MOCKKAL EGYIKET SEM lehet bizonyitani: az
 * osszetett kulcs, a jegy torlesenel a `Cascade`, es a kioszto torlesenel a
 * `SetNull`. Mindharom AKKOR szamit, amikor mar kesz a rendszer, es mindharom
 * NEMAN romlik el: egy hianyzo kulcs nem hibazik, csak ketszer teszi fel
 * ugyanazt az embert.
 *
 * === MIERT ITT, ES NEM A GEPEMEN LEMERVE ===
 *
 * Ebben a konteneben NINCS postgres kiszolgalo (`ECONNREFUSED` a
 * 127.0.0.1:5432 porton, merve 2026-09-14) es nincs `psql` sem. A szemet-
 * adatbazisos recept tehat itt nem futtathato -- masik rendszer kell hozza.
 * A CI viszont valodi adatbazison futtatja a migraciokat, es a `test:integration`
 * szkript FELDERITI ezt a fajlt, tehat felvenni sehova nem kell.
 *
 * A suite sorokat hoz letre es torol, ezert csak tesztelesre megnevezett
 * adatbazison fut; lasd `integrationDatabaseGate`.
 *
 * === A HELYI ZOLD ES A CI PIROS KULONBSEGE ITT NEM MEGBIZHATATLANSAG ===
 *
 * Ez a fajl a helyi `pnpm test` futasban NEM fut le, es KET FUGGETLEN okbol
 * sem -- mind a kettot lemertem (2026-09-14):
 *
 *     a szkript NEV SZERINT kizarja      `find ... ! -name '*.integration.spec.js'`
 *     es a kapu amugy is `skip` modban    RUN_DB_INTEGRATION nincs beallitva
 *
 * Vagyis a helyi zold NEM allit semmit errol a suite-rol -- nem tevedett, hanem
 * NEM SZOLALT MEG.
 *
 * ES EZ MEG IS TORTENT, 2026-09-14-en: a fenti allitasok kozul az egyik a CI-ben
 * bukott el, miutan helyben minden zold volt. A kulonbseg pontosan a fentebb
 * megnevezett korlat MUKODESE volt (nincs postgres a fejlesztoi konteneben),
 * nem a helyi futas hibaja.
 *
 * AMIT EBBOL A KOVETKEZO OLVASONAK TUDNIA KELL: ennel a fajlnal a "megirtam" es
 * a "lefutott" koze EGY CI-KOR esik. Aki itt allitast ir vagy modosit, annak a
 * meresere varnia kell -- es NEM szabad abbol, hogy helyben zold, arra
 * kovetkeztetni, hogy az allitas egyaltalan elsult valaha.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_EMAIL_DOMAIN = "service-job-assignees-integration.invalid";

/**
 * A SUITE SAJAT HIBAJEGYEINEK ELOTAGJA. Nevet kap, mert a takaritas ES az
 * allitas is olvassa -- ket helyen allo szoveg-literal eloszor egyezik, aztan
 * az egyiket valaki atirja, es a takaritas nem hibazna tole, csak nem talalna
 * semmit.
 */
const TEST_JOB_PREFIX = "HJ-INT-";

describe(
  "ServiceJobAssignee integration",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    let officeUserId: string;
    let technicianUserId: string;
    let secondTechnicianUserId: string;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      const office = await prisma.user.create({
        data: {
          email: `office-${suffix}@${TEST_EMAIL_DOMAIN}`,
          displayName: "Iroda Ilona",
          role: "OWNER",
        },
        select: { id: true },
      });
      officeUserId = office.id;

      const technician = await prisma.user.create({
        data: {
          email: `tech-${suffix}@${TEST_EMAIL_DOMAIN}`,
          displayName: "Szerelő Sándor",
          role: "SERVICE",
        },
        select: { id: true },
      });
      technicianUserId = technician.id;

      const second = await prisma.user.create({
        data: {
          email: `tech2-${suffix}@${TEST_EMAIL_DOMAIN}`,
          displayName: "Szerelő Sára",
          role: "SERVICE",
        },
        select: { id: true },
      });
      secondTechnicianUserId = second.id;
    });

    after(async () => {
      await removeLeftovers();
      /**
       * ES A TAKARITAS EREDMENYET MEG IS MERJUK: mindharom `deleteMany` nulla
       * sorra is sikeres, tehat egy elcsuszott elotag vagy domain pontosan ugy
       * nez ki, mint egy tiszta futas.
       *
       * A `ServiceJobAssignee` NEM SZEREPEL: a `serviceJobId` ES a `userId` is
       * `Cascade`, tehat barmelyik oldal torlese elviszi.
       *
       * A JEGY ES A FELHASZNALO VISZONT KULON ALL, es nem csak mas
       * `onDelete` miatt: a `ServiceJob.openedById` NEM IDEGEN KULCS, hanem egy
       * indexelt, nullazhato szoveg-oszlop. A felhasznalo torlese tehat sem el
       * nem viszi a jegyet, sem ki nem nullazza a mezot -- az ertek ott marad
       * egy mar nem letezo sorra mutatva. Ezert kap mindketto sajat szamlalot.
       */
      assert.equal(
        await prisma.serviceJob.count({
          where: { jobNumber: { startsWith: TEST_JOB_PREFIX } },
        }),
        0,
        "a suite hibajegyei bent maradtak a takaritas utan",
      );
      assert.equal(
        await prisma.user.count({
          where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
        }),
        0,
        "a suite felhasznaloi bent maradtak a takaritas utan",
      );
    });

    async function newJob(number: string) {
      const job = await prisma.serviceJob.create({
        data: {
          jobNumber: number,
          title: "Nem indul a szivattyú",
          openedById: officeUserId,
        },
        select: { id: true },
      });
      return job.id;
    }

    /**
     * ISMERT POZITIV KONTROLL, ES A LISTA ELSO SORA: egy delegalas EGYALTALAN
     * felirhato. Enelkul minden alabbi tiltas azert is teljesulhetne, mert a
     * tabla soha nem vesz fel semmit.
     */
    it("egy kolléga felkerül a jegyre", async () => {
      const jobId = await newJob(`HJ-INT-${suffix}-1`);

      await prisma.serviceJobAssignee.create({
        data: {
          serviceJobId: jobId,
          userId: technicianUserId,
          assignedById: officeUserId,
        },
      });

      const rows = await prisma.serviceJobAssignee.findMany({
        where: { serviceJobId: jobId },
      });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.userId, technicianUserId);
    });

    /**
     * UGYANAZ AZ EMBER KETSZER NEM KERULHET FEL. Ez az osszetett kulcs egyetlen
     * feladata, es potkulccsal (`id`) a tabla csendben ket sort venne fel.
     */
    it("ugyanaz a kolléga kétszer nem kerülhet ugyanarra a jegyre", async () => {
      const jobId = await newJob(`HJ-INT-${suffix}-2`);
      const data = {
        serviceJobId: jobId,
        userId: technicianUserId,
        assignedById: officeUserId,
      };

      await prisma.serviceJobAssignee.create({ data });

      await assert.rejects(
        () => prisma.serviceJobAssignee.create({ data }),
        (error: unknown) => {
          /**
           * A MEZO-PAROSRA MERUNK, NEM A TABLA NEVERE -- ES EZT A CI JAVITOTTA
           * KI RAJTAM (2026-09-14, run 34877414701).
           *
           * Elso alakja a `/ServiceJobAssignee/` mintara ment. A megkotes
           * MUKODOTT, az allitas bukott el: a Prisma uzenete a modellt
           * KISBETUVEL kezdi (`prisma.serviceJobAssignee.create()`), a
           * mintam viszont nagybetus volt. Egy jo javitasrol mondott pirosat,
           * es ez a legrosszabb fajta: konnyu belole azt olvasni, hogy a
           * megkotes nem all.
           *
           * A MEZO-PAROS JOBB MERCE A NEVNEL: pontosan azt a ket oszlopot
           * nevezi meg, amitol a paros az azonossag. Ha a tablara valaha kerul
           * egy MASIK egyediseg (peldaul [serviceJobId, assignedById]), az
           * ugyanugy elutasitana -- es ez az allitas akkor NEM lenne zold,
           * mert a `userId` hianyozna belole.
           *
           * A mintat a CI VALODI hibaszovegen kalibraltam, harom iranyban: a
           * regi minta nem talal, az uj mindket mezore talal, es egy masik
           * megkotes uzenete NEM elegiti ki.
           *
           * KET KULON ILLESZTES, NEM EGY `/serviceJobId.*userId/` ALAKU MINTA.
           * Ugyanazt a ket mezot koveteli meg, de a sorrendjuket NEM: egy
           * pontozott minta akkor is pirosodna, ha a Prisma egyszer felcsereli
           * a mezoket az uzenetben, vagy sort tor kozejuk (a `.` alapbol nem
           * illeszkedik ujsorra). Az allitas a KET MEZO EGYUTTALLASAROL szol,
           * nem a felsorolasuk rendjerol -- es egy orzo, ami egy idegen
           * formazasi reszleten is elsul, elobb-utobb atlepett pirosat ad.
           */
          const szoveg = String(error);
          assert.match(szoveg, /serviceJobId/);
          assert.match(szoveg, /userId/);
          return true;
        },
      );
    });

    /**
     * KET KULONBOZO EMBER UGYANARRA A JEGYRE: a tagadas parja. Enelkul a fenti
     * szelet egy olyan kulcstol is zold lenne, ami CSAK EGY delegaltat engedne
     * jegyenkent -- vagyis pontosan azt tiltana, amit Balazs kert.
     */
    it("két különböző kolléga viszont felkerülhet ugyanarra a jegyre", async () => {
      const jobId = await newJob(`HJ-INT-${suffix}-3`);

      await prisma.serviceJobAssignee.createMany({
        data: [
          { serviceJobId: jobId, userId: technicianUserId },
          { serviceJobId: jobId, userId: secondTechnicianUserId },
        ],
      });

      const rows = await prisma.serviceJobAssignee.findMany({
        where: { serviceJobId: jobId },
      });
      assert.equal(rows.length, 2);
    });

    /**
     * A JEGY TORLESE VIGYE A DELEGALASOKAT (`Cascade`). `Restrict` mellett egy
     * jegy torlese elhasalna, es a hibauzenet egy kapcsolotablarol szolna,
     * amirol a felhasznalo nem is tud.
     */
    it("a jegy törlése viszi a delegálásokat", async () => {
      const jobId = await newJob(`HJ-INT-${suffix}-4`);
      await prisma.serviceJobAssignee.create({
        data: { serviceJobId: jobId, userId: technicianUserId },
      });

      await prisma.serviceJob.delete({ where: { id: jobId } });

      const rows = await prisma.serviceJobAssignee.findMany({
        where: { serviceJobId: jobId },
      });
      assert.equal(rows.length, 0);
    });

    /**
     * A KIOSZTO TORLESE A SORT MEGHAGYJA (`SetNull`), a delegaltet viszont
     * VISZI (`Cascade`). A ket irany szandekosan kulonbozik: hogy KI dolgozik a
     * jegyen, az a sor letjogosultsaga; hogy ki osztotta ki, csak kiseradat.
     */
    it("a kiosztó törlése után a delegálás megmarad, gazdátlanul", async () => {
      const jobId = await newJob(`HJ-INT-${suffix}-5`);
      const assigner = await prisma.user.create({
        data: {
          email: `assigner-${suffix}@${TEST_EMAIL_DOMAIN}`,
          displayName: "Kiosztó Karcsi",
          role: "OWNER",
        },
        select: { id: true },
      });
      await prisma.serviceJobAssignee.create({
        data: {
          serviceJobId: jobId,
          userId: technicianUserId,
          assignedById: assigner.id,
        },
      });

      await prisma.user.delete({ where: { id: assigner.id } });

      const row = await prisma.serviceJobAssignee.findUnique({
        where: {
          serviceJobId_userId: {
            serviceJobId: jobId,
            userId: technicianUserId,
          },
        },
      });
      assert.ok(row, "a delegálás eltűnt a kiosztó törlésekor");
      assert.equal(row?.assignedById, null);
    });

    async function removeLeftovers() {
      await prisma.serviceJobAssignee.deleteMany({
        where: { serviceJob: { jobNumber: { startsWith: TEST_JOB_PREFIX } } },
      });
      await prisma.serviceJob.deleteMany({
        where: { jobNumber: { startsWith: TEST_JOB_PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });
    }
  },
);
