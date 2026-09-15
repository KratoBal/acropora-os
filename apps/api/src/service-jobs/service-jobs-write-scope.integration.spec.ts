import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { AuthUserResolver } from "../auth/auth-user-resolver.js";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/**
 * A HIBAJEGY OT IRASI UTJA, VALODI SOROKON.
 *
 * === MIERT KELL, HOLOTT A SZABALY MAR MERVE VAN ===
 *
 * A `service-jobs.write-scope.spec.ts` HAMIS taroloval mer: azt, hogy a keres
 * el sem jut a repositoryig. Az a DONTEST es a BEKOTEST bizonyitja, es
 * mindkettot jol -- de NEM azt, hogy a TABLA valtozatlan marad.
 *
 * A kulonbseg nem elmeleti. Ha valaki a hatokort visszatenne a valasz oldalara
 * (epp az a res, amit a #646 javitott), a hamis tarolos allitasok TOVABBRA IS
 * zoldek lennenek: a `setAssignees` ott is 404-et adna, csak azutan, hogy az
 * iras a tranzakcioban mar megtortent. Ez a fajl a sor VISSZAOLVASASAT meri,
 * nem a valaszkodot.
 *
 * === AZ ISMERT POZITIV KONTROLL, ES NELKULE AZ EGESZ FAJL DISZLET ===
 *
 * Minden uthoz HAROM allitas tartozik, es a harmadik a legfontosabb: ugyanaz a
 * muvelet a BELSOS hivoval MENJEN AT, es a tabla VALTOZZON, a megnevezett uj
 * ertekre. Enelkul mind az ot tiltas azert is teljesulhetne, mert a fixtura
 * eleve rossz (nem letezo jegyazonosito, mar lepett allapot, mar csatolt lap) --
 * olyankor minden hivo 404-et kapna, es a tabla senkitol nem mozdulna.
 *
 * Ezert olvassuk vissza a KIINDULO allapotot is minden esetben: egy fixtura,
 * ami nem a vart allapotbol indul, itt HANGOSAN bukik el, nem csendben
 * hitelesiti a tiltast.
 *
 * === A VARHATO KALIBRACIO, ELORE LEIRVA, ES NEM EGYFORMA AZ OT UTON ===
 *
 * A `requireWriteScope` hivasanak elhagyasa
 *
 *   move, attachWorksheet, detachWorksheet, setPartner   KET allitast dont
 *                                                        pirosra (a 404-et ES
 *                                                        a visszaolvasast)
 *   setAssignees                                         EGYET: csak a
 *                                                        visszaolvasast
 *
 * A setAssignees kivetel NEM hiba a fajlban, hanem PONTOSAN az a lelet, amiert
 * ez a modul javitva lett: az az ut a res fennallasa mellett IS 404-et adott,
 * mert a valasz osszeallitasa (`this.detail(id, user)`) a partner-hatokoru
 * hivora ures halmazt lat. A valaszkod tehat ott soha nem szolalt meg leletkent
 * -- egyedul a tabla szol.
 *
 * Ha a setAssignees 404-es allitasa MEGIS pirosra valt egy ilyen rontasnal,
 * akkor nem a rontas hatott ugy, ahogy hittuk: valami a LATHATOSAGBAN mozdult
 * el, es azt kell megnezni, nem ezt a fajlt.
 *
 * === ITT NEM FUT ===
 *
 * Ebben a konteneben nincs postgres. A "megirtam" es a "lefutott" koze EGY
 * CI-KOR esik -- ugyanaz a korlat, amit a `service-job-assignees.integration.spec.ts`
 * fejlece reszletesen kimond. A helyi zold errol a suite-rol SEMMIT nem allit:
 * a `pnpm test` NEV SZERINT is kizarja, es a kapu amugy is `skip` modban all.
 *
 * A suite sorokat hoz letre es torol, ezert csak tesztelesre megnevezett
 * adatbazison fut; lasd `integrationDatabaseGate`.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_EMAIL_DOMAIN = "service-jobs-write-scope-integration.invalid";
const TEST_CUSTOMER_PREFIX = "SJWS-INT-";
const TEST_JOB_PREFIX = "HJ-SJWS-";

/**
 * EGY UT EGY ESETE: a muvelet, a tabla mai allapota, es a ket vart ertek.
 *
 * Az `olvas` szandekosan EGYETLEN osszehasonlithato erteket ad vissza. Egy
 * teljes sor osszevetese olyan mezokon is elbukna (`updatedAt`), amikrol ez a
 * fajl nem allit semmit -- es egy allitas, ami idegen okbol is pirosodik,
 * elobb-utobb atlepett pirosat ad.
 */
interface Eset {
  hivas(user: AuthenticatedUser): Promise<unknown>;
  olvas(): Promise<string | number | null>;
  /** Amit a muvelet ELOTT kell latni. */
  elott: string | number | null;
  /** Amit a BELSOS hivas UTAN kell latni. */
  utana: string | number | null;
}

describe(
  "a hibajegy írási útjai valódi sorokon",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`.padStart(6, "0");
    const resolver = new AuthUserResolver();
    const service = new ServiceJobsService(new ServiceJobsRepository());

    let customerA: string;
    let customerB: string;
    let departmentA: string;
    /** A kérő ugyanúgy áll elő, ahogy egy valódi munkamenetben: a User sorból. */
    let belsos: AuthenticatedUser;
    let partner: AuthenticatedUser;

    /** Minden eset SAJÁT jegyet kap, hogy a sorrendjük ne kösse össze őket. */
    let sorszam = 0;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      const [rowA, rowB] = await Promise.all([
        prisma.customer.create({
          data: {
            customerNumber: `${TEST_CUSTOMER_PREFIX}${suffix}-A`,
            type: "COMPANY",
            displayName: "Írásvédelem Vevő A",
          },
          select: { id: true },
        }),
        prisma.customer.create({
          data: {
            customerNumber: `${TEST_CUSTOMER_PREFIX}${suffix}-B`,
            type: "COMPANY",
            displayName: "Írásvédelem Vevő B",
          },
          select: { id: true },
        }),
      ]);
      customerA = rowA.id;
      customerB = rowB.id;

      const unit = await prisma.worksheetDepartment.create({
        data: { customerId: customerA, code: "BIO", name: "Biodóm" },
        select: { id: true },
      });
      departmentA = unit.id;

      const [belsosRow, partnerRow] = await Promise.all([
        prisma.user.create({
          data: {
            email: `internal-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: "Belsős kolléga",
            role: "OWNER",
            isActive: true,
          },
          select: { id: true },
        }),
        /**
         * A PARTNER-HATOKORT A `customerId` ADJA, NEM A SZEREPKOR. A `SERVICE`
         * szerep szandekos: ez a fiok a `service.manage` jogot MEGKAPNA, tehat
         * a jogosultsagi kapu nem allitana meg -- egyedul a hatokor. Igy az
         * allitas arrol szol, amirol a neve.
         */
        prisma.user.create({
          data: {
            email: `partner-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: "Partner kapcsolattartó",
            role: "SERVICE",
            isActive: true,
            customerId: rowA.id,
          },
          select: { id: true },
        }),
      ]);

      [belsos, partner] = await Promise.all([
        resolver.resolveById(belsosRow.id),
        resolver.resolveById(partnerRow.id),
      ]);
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
    });

    async function newJob(customerId: string | null): Promise<string> {
      sorszam += 1;
      const job = await prisma.serviceJob.create({
        data: {
          jobNumber: `${TEST_JOB_PREFIX}${suffix}-${sorszam}`,
          title: "Nem indul a szivattyú",
          customerId,
          openedById: belsos.id,
        },
        select: { id: true },
      });
      return job.id;
    }

    async function newWorksheet(serviceJobId: string | null): Promise<string> {
      sorszam += 1;
      const sheet = await prisma.worksheet.create({
        data: {
          customerId: customerA,
          departmentId: departmentA,
          serviceJobId,
          versions: {
            create: { version: 1, subject: `Írásvédelem munka ${sorszam}` },
          },
        },
        select: { id: true },
      });
      return sheet.id;
    }

    async function statusOf(jobId: string) {
      const row = await prisma.serviceJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { status: true },
      });
      return row.status as string;
    }

    async function ticketOf(worksheetId: string) {
      const row = await prisma.worksheet.findUniqueOrThrow({
        where: { id: worksheetId },
        select: { serviceJobId: true },
      });
      return row.serviceJobId;
    }

    async function partnerOf(jobId: string) {
      const row = await prisma.serviceJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { customerId: true },
      });
      return row.customerId;
    }

    async function assigneeCount(jobId: string) {
      return prisma.serviceJobAssignee.count({
        where: { serviceJobId: jobId },
      });
    }

    /**
     * AZ OT UT, EGY HELYEN -- hogy egy HATODIK irasi ut felvetele latszodjon.
     *
     * Mindegyik SAJAT fixturat epit, es olyat, amivel a muvelet a hatokor
     * ellenorzese NELKUL SIKERULNE. Ez a kalibracio elofeltetele: egy jegy, ami
     * amugy is elutasitana a lepest, a rontas utan sem mozdulna, es a
     * kalibracio nullat mondana ott, ahol ma ved.
     */
    const UTAK: { nev: string; keszit(): Promise<Eset> }[] = [
      {
        nev: "move",
        async keszit() {
          const jobId = await newJob(customerA);
          return {
            hivas: (user) =>
              service.move(jobId, { to: "TRIAGED" }, user.id, user),
            olvas: () => statusOf(jobId),
            elott: "NEW",
            utana: "TRIAGED",
          };
        },
      },
      {
        nev: "attachWorksheet",
        async keszit() {
          const jobId = await newJob(customerA);
          // A LAP PARTNERE EGYEZIK A JEGYEVEL: enelkul a csatolas a sajat
          // partner-ellenorzesen hasalna el, es a kalibracio nem a hatokort
          // merne.
          const worksheetId = await newWorksheet(null);
          return {
            hivas: (user) => service.attachWorksheet(jobId, worksheetId, user),
            olvas: () => ticketOf(worksheetId),
            elott: null,
            utana: jobId,
          };
        },
      },
      {
        nev: "detachWorksheet",
        async keszit() {
          const jobId = await newJob(customerA);
          const worksheetId = await newWorksheet(jobId);
          return {
            hivas: (user) => service.detachWorksheet(jobId, worksheetId, user),
            olvas: () => ticketOf(worksheetId),
            elott: jobId,
            utana: null,
          };
        },
      },
      {
        nev: "setPartner",
        async keszit() {
          // A PARTNER POTLASA csak partner NELKULI jegyen megy: egy meglevo
          // partner atirasa atsorolas lenne, es arra ma nincs ut.
          const jobId = await newJob(null);
          return {
            hivas: (user) => service.setPartner(jobId, customerB, user),
            olvas: () => partnerOf(jobId),
            elott: null,
            utana: customerB,
          };
        },
      },
      {
        nev: "setAssignees",
        async keszit() {
          const jobId = await newJob(customerA);
          await prisma.serviceJobAssignee.create({
            data: { serviceJobId: jobId, userId: belsos.id },
          });
          /**
           * URES LISTA, ES EZ A LEGBESZEDESEBB ESET: a DTO teljes-nevsor
           * szemantikaja miatt az ures lista LESZEDNE mindenkit. A res idejen
           * pontosan ez tortent volna -- a hivo 404-et latott, a nevsor pedig
           * kiurult.
           */
          return {
            hivas: (user) => service.setAssignees(jobId, { userIds: [] }, user),
            olvas: () => assigneeCount(jobId),
            elott: 1,
            utana: 0,
          };
        },
      },
    ];

    for (const ut of UTAK) {
      it(`${ut.nev}: partner-hatókörnél 404`, async () => {
        const eset = await ut.keszit();

        await assert.rejects(
          () => eset.hivas(partner),
          (hiba: { status?: number }) => hiba.status === 404,
        );
      });

      it(`${ut.nev}: partner-hatókör után a tábla VÁLTOZATLAN`, async () => {
        const eset = await ut.keszit();

        assert.equal(
          await eset.olvas(),
          eset.elott,
          "a fixtúra nem a várt állapotból indul",
        );
        // A HIBAT ITT SZANDEKOSAN ELNYELJUK: a valaszkodrol a fenti allitas
        // szol. Ez a sor a TABLAT meri, es akkor is mernie kell, ha a hivas
        // -- a res visszaterese utan -- egyaltalan nem dobna.
        await eset.hivas(partner).catch(() => undefined);

        assert.equal(await eset.olvas(), eset.elott);
      });

      /**
       * AZ ISMERT POZITIV KONTROLL. Enelkul a fenti ket allitas akkor is zold
       * lenne, ha a fixtura eleve olyan allapotban all, amiben a muvelet
       * BARMELYIK hivotol elbukna.
       */
      it(`${ut.nev}: belsős hívónál a tábla VÁLTOZIK`, async () => {
        const eset = await ut.keszit();

        assert.equal(
          await eset.olvas(),
          eset.elott,
          "a fixtúra nem a várt állapotból indul",
        );
        await eset.hivas(belsos);

        assert.equal(await eset.olvas(), eset.utana);
      });
    }

    async function removeLeftovers() {
      const customers = await prisma.customer.findMany({
        where: { customerNumber: { startsWith: TEST_CUSTOMER_PREFIX } },
        select: { id: true },
      });
      const customerIds = customers.map((row) => row.id);

      // A LAPOK A JEGYEK ELOTT: a `Worksheet.serviceJobId` `SetNull`, tehat a
      // sorrend itt nem megkotes-kerdes, de a lapok a helyszinen es a vevon
      // `Restrict`-tel allnak -- azokat mindenkeppen elobb kell vinni.
      if (customerIds.length > 0)
        await prisma.worksheet.deleteMany({
          where: { customerId: { in: customerIds } },
        });

      // A JEGY torlese viszi a naplot es a delegalasokat (mindketto `Cascade`).
      await prisma.serviceJob.deleteMany({
        where: { jobNumber: { startsWith: TEST_JOB_PREFIX } },
      });

      /**
       * A FELHASZNALOK A VEVO ELOTT, ES EZT A CI JAVITOTTA KI RAJTAM
       * (2026-09-15, run 34950778936).
       *
       * A partner-hatokoru fiok `customerId` mezoje IDEGENKULCS
       * (`User_customerId_fkey`), tehat a vevo torlese addig nem megy, amig egy
       * felhasznalo ra mutat. A masik integracios suite (`worksheet-assets`)
       * ugyanezt a sorrendet hasznalja es ATMEGY -- ott egyetlen felhasznalo sem
       * visel `customerId`-t, tehat a megkotes elo sem all. A ket fajl
       * kulonbsege epp az, amirol EZ a suite szol.
       *
       * ES AMIERT KULON BEKEZDEST KAP: a bukas az `after` hookban tortent, es
       * EGYETLEN MAI KAPUNKON SEM AKADT FENN -- a CI lepes ZOLD maradt. Merve
       * (node v22.23.2, ismert pozitiv kontrollal):
       *
       *   after hook bukik    not ok <n> - <suite>, failureType: hookFailed,
       *                       DE `# fail 0` es a kilepesi kod NULLA
       *   valodi teszt bukik  `# fail 1`, kilepesi kod 1
       *   before hook bukik   `# cancelled 1`, kilepesi kod 1
       *
       * Vagyis egyedul az `after` nema: se a CI lepes, se a `kalibracio.sh` nem
       * latja. Aki itt takaritast ir, NE a zold futasbol vezesse le, hogy a
       * takaritas lefutott.
       */
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });

      if (customerIds.length > 0) {
        // A HELYSZINEK FAT ALKOTNAK, es a szulore `Restrict` all: levelrol a
        // gyoker fele haladunk, amig fogy a fa.
        for (;;) {
          const removed = await prisma.worksheetDepartment.deleteMany({
            where: { customerId: { in: customerIds }, children: { none: {} } },
          });
          if (removed.count === 0) break;
        }
        await prisma.customer.deleteMany({
          where: { id: { in: customerIds } },
        });
      }
    }
  },
);
