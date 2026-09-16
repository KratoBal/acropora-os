import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";
import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/**
 * A HELYSZIN ES AZ ESZKOZOK EGYUTTES BEALLITASA -- VALODI SOROKON.
 *
 * === MIERT KELL, HOLOTT A SZABALY MAR MERVE VAN ===
 *
 * A `service-jobs.placement.spec.ts` a `setPlacement` BEMENETET meri: mi jutott
 * el a taroloig, es mi NEM. Az a DONTEST bizonyitja (az ellenorzes az iras
 * elott fut), es jol -- de a TABLA-IRAS ott meretlen marad. Kimondtam a #740
 * torzseben nyitott tetelkent, ez a fajl zarja be.
 *
 * === A NEGY ALLITAS, ES MELYIK MIT ZAR LE ===
 *
 *   a) a helyszin ES a sorok EGYUTT irodnak ki, a RESZFABOL is  -- a tranzakcio
 *   b) idegen helyszin eszkozenel SEMMI nem valtozik            -- a sorrend
 *   c) a bekuldott lista a TELJES halmaz: a kihagyott lekerul    -- a `notIn`
 *   d) a MARADO sor `createdAt`-ja NEM irodik ujra               -- `skipDuplicates`
 *
 * A d) az, amit MOCKKAL NEM lehet bizonyitani, es egyben a legcsendesebb: ha
 * minden mentes ujrairna az osszes sort, egy honapja csatolt eszkoz "ma
 * csatoltnak" latszana a feluleten -- semmi nem hibazna tole.
 *
 * === A RESZFA SZANDEKOS AZ a) ESETBEN ===
 *
 * A ket eszkoz kozul az egyik a helyszin ALATTI csomoponton all. Egy olyan
 * fixtura, ahol mindketto kozvetlenul a megnevezett egysegen ul, a
 * fa-bejarasrol SEMMIT nem allitana.
 *
 * === A VARHATO KALIBRACIO, ELORE LEIRVA ===
 *
 * Ez a fajl ITT NEM FUT (lasd lent), tehat a kalibraciot sem tudom elvegezni. A
 * varakozasomat ezert LEIROM, hogy a kovetkezo olvaso ossze tudja vetni:
 *
 *   a `serviceJobAsset.createMany` elhagyasa a taroloban
 *       -> a) es d) piros; b) zold, c) reszben (a levetel maga menne)
 *   a `assetsOutsideDepartment` ellenorzes elhagyasa a szolgaltatasban
 *       -> b) piros; a), c) es d) zold
 *   a `skipDuplicates` elhagyasa
 *       -> d) piros (egyedi kulcs miatt el is hasalna); a tobbi zold
 *
 * A harom rontas pirosai NEM fedik egymast, es epp ez mutatja meg, hogy a negy
 * allitas HAROM kulon dolgot mer, nem ugyanazt negyszer.
 *
 * === ITT NEM FUT, ES EZ A KAPU SZANDEKA ===
 *
 * Ebben a konteneben nincs postgres (nincs `psql`, nincs `docker`, es
 * `DATABASE_URL` sincs -- merve 2026-09-16). A korlat tehat NEM az, hogy
 * "nincs adatbazis", hanem hogy A FEJLESZTOI GEPEN nincs: a CI `verify` jobja
 * valodi postgres szolgaltatast inditt, a `test:integration` felderiti ezt a
 * fajlt, es a `integration-suite-gate.mjs` elbuktatja a jobot, ha a suite NEM
 * futott le.
 *
 * AMIT EBBOL A KOVETKEZO OLVASONAK TUDNIA KELL: ennel a fajlnal a "megirtam" es
 * a "lefutott" koze EGY CI-KOR esik. A helyi zold errol a suite-rol SEMMIT nem
 * allit -- nem tevedett, hanem NEM SZOLALT MEG.
 *
 * A suite sorokat hoz letre es torol, ezert csak tesztelesre megnevezett
 * adatbazison fut; lasd `integrationDatabaseGate`.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_EMAIL_DOMAIN = "service-job-placement-integration.invalid";
const TEST_PREFIX = "SJP-INT-";
const TEST_JOB_PREFIX = "HJ-SJP-";

describe(
  "a hibajegy helyszine és eszközei valódi sorokon",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`.padStart(6, "0");
    const service = new ServiceJobsService(new ServiceJobsRepository());

    let actor: AuthenticatedUser;
    let customerId: string;
    /** A jegy eredeti helyszine. */
    let helyszin: string;
    /** A helyszin ALATTI csomopont: a reszfa-bejaras mercéje. */
    let alcsomopont: string;
    /** Testver helyszin ugyanannal a partnernel: ami KIVUL esik. */
    let masikHelyszin: string;
    let eszkozHelyszinen: string;
    let eszkozAlcsomoponton: string;
    let idegenEszkoz: string;

    let sorszam = 0;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      const user = await prisma.user.create({
        data: {
          email: `office-${suffix}@${TEST_EMAIL_DOMAIN}`,
          displayName: "Iroda Ilona",
          role: "OWNER",
          isActive: true,
        },
        select: { id: true },
      });
      actor = { id: user.id } as AuthenticatedUser;

      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${TEST_PREFIX}${suffix}`,
          type: "COMPANY",
          displayName: "Helyszínes Partner",
        },
        select: { id: true },
      });
      customerId = customer.id;

      const bio = await prisma.worksheetDepartment.create({
        data: { customerId, code: "BIO", name: "Biodóm" },
        select: { id: true },
      });
      helyszin = bio.id;

      const medence = await prisma.worksheetDepartment.create({
        data: {
          customerId,
          parentId: helyszin,
          code: "NAG",
          name: "Nagy medence",
        },
        select: { id: true },
      });
      alcsomopont = medence.id;

      const ppu = await prisma.worksheetDepartment.create({
        data: { customerId, code: "PPU", name: "PP Üzemeltetés" },
        select: { id: true },
      });
      masikHelyszin = ppu.id;

      eszkozHelyszinen = await newAsset("1", helyszin);
      eszkozAlcsomoponton = await newAsset("2", alcsomopont);
      idegenEszkoz = await newAsset("3", masikHelyszin);
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
      /**
       * A TAKARITAS EREDMENYET MEG IS MERJUK: minden `deleteMany` nulla sorra
       * is SIKERES, tehat egy elcsuszott elotag pontosan ugy nez ki, mint egy
       * tiszta futas.
       *
       * AZ ESZKOZ KULON SZAMOL: a `ServiceJobAsset.assetId` `Restrict`, tehat
       * egy bent maradt kapcsolatsor epp az eszkoz torleset allitana meg -- ez
       * a szam mondja meg, hogy a jegyek tenyleg elmentek.
       */
      nincsMaradek([
        {
          nev: "a suite hibajegyei bent maradtak a takaritas utan",
          darab: await prisma.serviceJob.count({
            where: { jobNumber: { startsWith: TEST_JOB_PREFIX } },
          }),
        },
        {
          nev: "a suite munkalapjai bent maradtak a takaritas utan",
          darab: await prisma.worksheet.count({
            where: {
              customer: { customerNumber: { startsWith: TEST_PREFIX } },
            },
          }),
        },
        {
          nev: "a suite eszkozei bent maradtak a takaritas utan",
          darab: await prisma.asset.count({
            where: { assetNumber: { startsWith: TEST_PREFIX } },
          }),
        },
        {
          nev: "a suite felhasznaloi bent maradtak a takaritas utan",
          darab: await prisma.user.count({
            where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
          }),
        },
      ]);
    });

    async function newAsset(jel: string, departmentId: string) {
      const asset = await prisma.asset.create({
        data: {
          assetNumber: `${TEST_PREFIX}${suffix}-${jel}`,
          name: `Szivattyú ${jel}`,
          customerId,
          departmentId,
        },
        select: { id: true },
      });
      return asset.id;
    }

    /**
     * EGY JEGY, A PARTNERREL EGYUTT, DE HELYSZIN NELKUL.
     *
     * A helyszin nelkuli kiindulas SZANDEKOS: a felvitelen a mezo elhagyhato,
     * tehat ez a rendes allapota egy mai jegynek -- es a `setPlacement` ezen
     * vegzi az ELSO beallitast.
     */
    async function newJob() {
      sorszam += 1;
      const job = await prisma.serviceJob.create({
        data: {
          jobNumber: `${TEST_JOB_PREFIX}${suffix}-${sorszam}`,
          title: "Nem indul a szivattyú",
          customerId,
        },
        select: { id: true },
      });
      return job.id;
    }

    async function allapot(serviceJobId: string) {
      const [job, rows] = await Promise.all([
        prisma.serviceJob.findUnique({
          where: { id: serviceJobId },
          select: { departmentId: true },
        }),
        prisma.serviceJobAsset.findMany({
          where: { serviceJobId },
          select: { assetId: true, createdAt: true },
        }),
      ]);
      return {
        departmentId: job?.departmentId ?? null,
        assetIds: rows.map((row) => row.assetId).sort(),
        createdAtOf: new Map(
          rows.map((row) => [row.assetId, row.createdAt.getTime()]),
        ),
      };
    }

    /**
     * EGY MUNKALAP A JEGY ALATT, NYERS SORKENT.
     *
     * A szolgaltatason at felvinni tobb elofeltetelt kerne (partner-kod,
     * tartalom, felelosok), es egyik sem arrol szol, amit itt merunk. A
     * `number` a DONTO mezo: ha van, a lap mar lezarult, es a szama a REGI
     * helyszin kodjat viseli.
     */
    async function newSheet(jel: string, over: { number?: string } = {}) {
      const lap = await prisma.worksheet.create({
        data: {
          customerId,
          departmentId: helyszin,
          createdById: actor.id,
          ...(over.number ? { number: over.number } : {}),
          versions: {
            create: {
              version: 1,
              status: "DRAFT",
              subject: `Szivattyu csere ${jel}`,
              // A HELYSZIN NEVE BEFAGYASZTVA: ezt kell a mozgatasnak
              // atvezetnie, kulonben a lap uj helyszinen allna, regi nevvel.
              unitName: "Biodóm",
            },
          },
        },
        select: { id: true },
      });
      return lap.id;
    }

    async function sheetState(worksheetId: string) {
      const row = await prisma.worksheet.findUnique({
        where: { id: worksheetId },
        select: {
          departmentId: true,
          versions: {
            select: { unitName: true },
            orderBy: { version: "desc" },
          },
        },
      });
      return {
        departmentId: row?.departmentId ?? null,
        unitName: row?.versions[0]?.unitName ?? null,
      };
    }

    async function attach(worksheetId: string, serviceJobId: string) {
      await prisma.worksheet.update({
        where: { id: worksheetId },
        data: { serviceJobId },
      });
    }

    /**
     * a) A HELYSZIN ES A SOROK EGYUTT IRODNAK KI -- ES A RESZFABOL IS.
     *
     * Az `assetIds` HALMAZAT vetjuk ossze, nem a darabszamot: egy tarolo, ami
     * ket sort ir, de mindkettot ugyanarra az eszkozre, a darabszamon atmenne.
     */
    it("a helyszín és a részfa két eszköze egy hívásban kerül a jegyre", async () => {
      const jobId = await newJob();

      await service.setPlacement(
        jobId,
        {
          departmentId: helyszin,
          assetIds: [eszkozHelyszinen, eszkozAlcsomoponton],
        },
        actor,
      );

      const utana = await allapot(jobId);
      assert.equal(utana.departmentId, helyszin);
      assert.deepEqual(
        utana.assetIds,
        [eszkozHelyszinen, eszkozAlcsomoponton].sort(),
      );
    });

    /**
     * b) IDEGEN HELYSZIN ESZKOZENEL SEMMI NEM VALTOZIK.
     *
     * KET allitas, es szandekosan kulon: a valaszkod onmagaban akkor is zold
     * lenne, ha az iras MAR megtortent volna, es a hiba csak utana derulne ki.
     * A helyszin ES az eszkoz-lista is a REGI marad.
     */
    it("idegen helyszín eszközénél sem a helyszín, sem az eszközök nem mozdulnak", async () => {
      const jobId = await newJob();
      await service.setPlacement(
        jobId,
        { departmentId: helyszin, assetIds: [eszkozHelyszinen] },
        actor,
      );
      const elotte = await allapot(jobId);

      await assert.rejects(
        () =>
          service.setPlacement(
            jobId,
            { departmentId: masikHelyszin, assetIds: [eszkozHelyszinen] },
            actor,
          ),
        /nem a megadott helyszínen áll/,
      );

      const utana = await allapot(jobId);
      assert.equal(utana.departmentId, elotte.departmentId);
      assert.deepEqual(utana.assetIds, elotte.assetIds);
    });

    /**
     * c) A BEKULDOTT LISTA A TELJES HALMAZ: a kihagyott LEKERUL.
     *
     * Ez az, ami a helyszin-valtast egyaltalan lehetove teszi: a regi helyszin
     * eszkoze nem all az uj reszfajan, tehat a hivonak ki kell hagynia a
     * listabol -- es akkor le is kerul.
     */
    it("a kihagyott eszköz lekerül, a helyszín pedig átáll", async () => {
      const jobId = await newJob();
      await service.setPlacement(
        jobId,
        {
          departmentId: helyszin,
          assetIds: [eszkozHelyszinen, eszkozAlcsomoponton],
        },
        actor,
      );

      await service.setPlacement(
        jobId,
        { departmentId: masikHelyszin, assetIds: [idegenEszkoz] },
        actor,
      );

      const utana = await allapot(jobId);
      assert.equal(utana.departmentId, masikHelyszin);
      assert.deepEqual(utana.assetIds, [idegenEszkoz]);
    });

    /**
     * d) A MARADO SOR IDOPONTJA NEM IRODIK UJRA.
     *
     * A `createdAt` az EGYETLEN jel arrol, mikor kerult egy eszkoz a jegyre, es
     * a felulet ki is irja (`attachedAt`). Ha minden mentes ujrairna az osszes
     * sort, egy honapja rajta allo eszkoz "ma csatoltnak" latszana -- es semmi
     * nem hibazna tole.
     *
     * A HOZZAADOTT SOR KULON ALL: a mero akkor is zold lenne, ha a masodik
     * hivas SEMMIT nem csinalt volna. Igy latszik, hogy tortent iras.
     */
    it("a maradó eszköz csatolási ideje változatlan, az újé friss", async () => {
      const jobId = await newJob();
      await service.setPlacement(
        jobId,
        { departmentId: helyszin, assetIds: [eszkozHelyszinen] },
        actor,
      );
      const elotte = await allapot(jobId);
      const eredetiIdo = elotte.createdAtOf.get(eszkozHelyszinen);
      assert.ok(eredetiIdo, "az első hívás nem írt sort");

      await service.setPlacement(
        jobId,
        {
          departmentId: helyszin,
          assetIds: [eszkozHelyszinen, eszkozAlcsomoponton],
        },
        actor,
      );

      const utana = await allapot(jobId);
      assert.deepEqual(
        utana.assetIds,
        [eszkozHelyszinen, eszkozAlcsomoponton].sort(),
        "a második hívás nem adta hozzá az új eszközt",
      );
      assert.equal(
        utana.createdAtOf.get(eszkozHelyszinen),
        eredetiIdo,
        "a már fent lévő sor csatolási ideje újraíródott",
      );
    });

    /**
     * e) A SZAM NELKULI LAP HELYSZINE ES A PISZKOZAT NEVE IS ATALL.
     *
     * A KETTO EGYUTT MER: a mezo atirasa onmagaban ugy hagyna a lapot, hogy uj
     * helyszinen all, de a lapjan a REGI helyszin neve olvashato -- es az a nev
     * a verzio-elteresben is szerepel ("Egyseg"), tehat a kovetkezo verzio ugy
     * mutatna valtozast, hogy senki nem irt at semmit.
     *
     * ES A TRANZAKCIO: ha a ket iras kulon menetben allna, egy megszakadas
     * pontosan ezt a fel-kesz allapotot hagyna itt -- amin ranezesre semmi nem
     * hibas.
     */
    it("a szám nélküli lap helyszíne és a piszkozat neve is átáll", async () => {
      const jobId = await newJob();
      const lapId = await newSheet("e");
      await attach(lapId, jobId);
      const elotte = await sheetState(lapId);
      assert.equal(elotte.departmentId, helyszin);
      assert.equal(elotte.unitName, "Biodóm");

      await service.setPlacement(
        jobId,
        { departmentId: masikHelyszin, assetIds: [] },
        actor,
      );

      const utana = await sheetState(lapId);
      assert.equal(utana.departmentId, masikHelyszin);
      assert.equal(
        utana.unitName,
        "PP Üzemeltetés",
        "a piszkozat a RÉGI helyszín nevét viszi tovább",
      );
    });

    /**
     * f) A SZAMOZOTT LAP SORA TENYLEGESEN VALTOZATLAN.
     *
     * NEM a szolgaltatas visszateresi erteken all az allitas, hanem az ADATON:
     * egy hivas, ami a valaszban kihagyja a lapot, de a tablaban megis atirja,
     * a visszateresi erteket mero tesztnel zolden atmenne.
     *
     * A PAR MASIK FELE (e) EGYUTT MER VELE: onmagaban ez akkor is zold lenne,
     * ha EGYETLEN lapot sem mozgatnank -- ezert all a vegen a kontroll.
     */
    it("a SZÁMOZOTT lap sora érintetlen marad", async () => {
      const jobId = await newJob();
      const szamozott = await newSheet("f1", {
        number: `${TEST_PREFIX}${suffix}-SZAM`,
      });
      const szamNelkuli = await newSheet("f2");
      await attach(szamozott, jobId);
      await attach(szamNelkuli, jobId);

      await service.setPlacement(
        jobId,
        { departmentId: masikHelyszin, assetIds: [] },
        actor,
      );

      const zart = await sheetState(szamozott);
      assert.equal(zart.departmentId, helyszin, "a számozott lap elmozdult");
      assert.equal(zart.unitName, "Biodóm", "a számozott lap neve átíródott");
      // ES A KONTROLL: a szam nelkuli UGYANEBBEN a hivasban ATALLT, tehat a
      // fenti ket allitas nem attol zold, hogy a muvelet le sem futott.
      const nyitott = await sheetState(szamNelkuli);
      assert.equal(nyitott.departmentId, masikHelyszin);
    });

    async function removeLeftovers() {
      // A LAPOK ELOSZOR: a partner torlese elakadna, amig lap all rajta; a
      // `WorksheetVersion` a lapra `Cascade`, tehat a verziokat a lap viszi.
      await prisma.worksheet.deleteMany({
        where: { customer: { customerNumber: { startsWith: TEST_PREFIX } } },
      });
      // A SORREND KOTOTT: a `ServiceJobAsset.assetId` `Restrict`, tehat az
      // eszkoz torlese elhasalna, amig a jegy (es vele a kapcsolatsor) all.
      await prisma.serviceJob.deleteMany({
        where: { jobNumber: { startsWith: TEST_JOB_PREFIX } },
      });
      await prisma.asset.deleteMany({
        where: { assetNumber: { startsWith: TEST_PREFIX } },
      });
      await prisma.worksheetDepartment.deleteMany({
        where: { customer: { customerNumber: { startsWith: TEST_PREFIX } } },
      });
      await prisma.customer.deleteMany({
        where: { customerNumber: { startsWith: TEST_PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });
    }
  },
);
