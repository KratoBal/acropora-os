import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { nincsMaradek } from "../common/takaritas-leltar.js";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { DOCUMENT_DELETED_ACTION } from "./service-job-documents.repository.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";

/**
 * A `documentRemovals` ACTION-SZUROJE BIZTONSAGI HATAR, NEM MEGJELENITESI
 * FINOMSAG.
 *
 * A lekerdezes az `AuditLog`-bol olvas, es harom feltetellel szukit:
 * `entityType`, `entityId` es `action`. Az elso ketto a JEGYET valasztja ki;
 * a HARMADIK azt donti el, hogy ugyanarrol a jegyrol MELYIK naplo-sorok
 * kerulnek a reszletlapra.
 *
 * === MIERT KELL RA ALLITAS, ES MIERT NEM AZ, AMIERT ELOSZOR HITTUK ===
 *
 * AZ INDOK MA ESTE KETSZER VALTOZOTT, ezert all itt a MERT alak, nem az elso
 * ketto:
 *
 *   1. eloszor ugy szolt, hogy a kikuldott ertesito CIMZETTJEI kerulnek
 *      ugyanerre a jegyre, mas action-nel, tehat a szuro cimeket ved.
 *   2. aztan kiderult, hogy a level-nyom KULON TABLAT kapott
 *      (`TicketMailDelivery`, nautilus #933), ahol nincs mit kiszurni.
 *
 * VISSZAMERVE A FO AGON (2026-09-21 este) A VALODI ALLAS EZ:
 *
 *   az `AuditLog.action` SZABAD SZOVEG-oszlop (`String`), nincs ra enum, tehat
 *   SEMMI nem korlatozza, mi kerulhet bele;
 *   `entityType: "ServiceJob"` alatt MA PONTOSAN EGY iro letezik a nem-teszt
 *   kodban (`service-job-documents.repository.ts:330`, a torles);
 *   a reszletlap olvasoja viszont MINDEN sort felvenne, amit a ket masik
 *   feltetel atenged.
 *
 * Vagyis a szuro MA nem valaszt el semmit -- es EPP EZ a veszelye. Aki holnap
 * barmilyen naploz-sort ir egy jegyre, annak a sora a "torolt csatolmanyok"
 * listajaban jelenne meg, `fileName` nelkul, torlesnek almazva. Nem hibazna
 * semmi.
 *
 * "MA NULLA ESET" ES "NEM TORTENHET MEG" KET KULON ALLITAS, es a harom
 * kerdes mind a masodik ellen szol: eljut-e odaig (igen, az olvasonak nincs
 * tovabbi szurese), mi koti ossze (semmi: szabad szoveg-oszlop), nohet-e a
 * halmaz (igen, barmelyik feature irhat).
 *
 * === KET FELET KELL VEDENI, ES A FORDITO CSAK AZ EGYIKET LATJA ===
 *
 * (acrobot pontositasa, 2026-09-21 23:49, a kalibracios kor naplojabol.)
 *
 *   a szuro KIVETELET     ma a FORDITO fogja meg. Ha a sor eltunik, a
 *                         `DOCUMENT_DELETED_ACTION` importja hasznalatlan
 *                         marad, es a build TS6133-mal elhasal.
 *   a szuro KITAGITASAT   SEMMI nem fogja meg ezen az allitason kivul. Egy
 *                         `not` alaku vagy tagabb egyenloseg lefordul, lefut,
 *                         es tobb sort ad vissza.
 *
 * A kalibracio EPPEN A MASODIKAT meri: a rontas nem torli a feltetelt, hanem
 * olyanra csereli, amit minden sor teljesit. Igy a konstans hasznalatban marad
 * (tehat lefordul), es a viselkedes valtozik -- pontosan a fordito VAK FOLTJA.
 *
 * ES AZ ELSO VEDELEM ESETLEGES: csak addig all, amig a konstanst KIZAROLAG ez
 * az egy sor hasznalja. Aki holnap masutt is behivja, ott a kivetel is nemava
 * valik, es onnantol egyedul ez az allitas marad.
 *
 * (Az elso kalibracios probam epp a torlo alakkal ment ki, a build lepesen allt
 * meg, es NULLA teszt futott. A meres-ag kapuja azert fogta meg, mert a VART
 * NYOMOKAT keresi, nem azt, hogy "elbukott valami".)
 *
 * === MIERT NEM ELEG MOCKKAL MERNI ===
 *
 * Merve a fo agon, 2026-09-21: ot spec emliti a `documentRemovals`-t, es MIND
 * AZ OT hamis tarolot ad (`documentRemovals: async () => []`). Egyik sem
 * futtatja a valodi `where` agat, tehat az `action` szuro torlese ma
 * EGYETLEN allitast sem vinne pirosra.
 *
 * (Acrobot hat specet irt; visszamerve ot FAJL stubolja. A hatodik emlites a
 * `service-jobs.detail.spec.ts` tipus-soraban all, nem kulon stub.)
 *
 * === AMIT EZ A SUITE MER ===
 *
 * Ket sor ugyanarra a jegyre, KET KULONBOZO action-nel, es a valasz PONTOSAN
 * egy elemu. A darabszam a lenyeg, nem a jelenlet: egy "benne van a torles-sor"
 * alaku allitas akkor is zold lenne, ha a masik sor IS bekerulne.
 *
 * A HELYI FUTAS ERROL NEM MOND SEMMIT. Ez a fajl a `pnpm test`-ben nem fut le
 * (a szkript nev szerint kizarja, es a kapu `skip` modban all
 * `RUN_DB_INTEGRATION` nelkul), es ebben a konteneben nincs postgres sem.
 * A "megirtam" es a "lefutott" koze tehat egy CI-kor esik.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_JOB_PREFIX = "HJ-DR-";
const TEST_EMAIL_DOMAIN = "service-job-document-removals.invalid";

/**
 * A MASIK action. SZANDEKOSAN NEM LETEZO ERTEK: ma egyetlen iro sincs rajta
 * kivul, es epp azt merjuk, hogy egy JOVOBELI iro sora se szivarogjon at.
 * Egy ma letezo action-t valasztani azt jelentene, hogy az allitas elavul,
 * amint azt a funkciot kivezetik.
 */
const MASIK_ACTION = "service_job.proba.nem_letezo_action";

describe(
  "a documentRemovals action-szuroje",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    let jobId: string;
    let userId: string;

    async function removeLeftovers() {
      await prisma.auditLog.deleteMany({
        where: { entityType: "ServiceJob", entityId: jobId ?? "nincs" },
      });
      await prisma.serviceJob.deleteMany({
        where: { jobNumber: { startsWith: TEST_JOB_PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      const user = await prisma.user.create({
        data: {
          email: `iroda-${suffix}@${TEST_EMAIL_DOMAIN}`,
          displayName: "Iroda Ilona",
          role: "OWNER",
        },
        select: { id: true },
      });
      userId = user.id;

      const job = await prisma.serviceJob.create({
        data: {
          jobNumber: `${TEST_JOB_PREFIX}${suffix}`,
          title: "Naplo-szuro merese",
        },
        select: { id: true },
      });
      jobId = job.id;

      await prisma.auditLog.createMany({
        data: [
          {
            userId,
            action: DOCUMENT_DELETED_ACTION,
            entityType: "ServiceJob",
            entityId: jobId,
            metadata: { fileName: "torolt-csatolmany.pdf" },
          },
          {
            userId,
            action: MASIK_ACTION,
            entityType: "ServiceJob",
            entityId: jobId,
            metadata: { recipients: ["vevo@pelda.invalid"] },
          },
        ],
      });
    });

    after(async () => {
      await removeLeftovers();
      /*
        A TAKARITAS EREDMENYET MEG IS MERJUK: minden `deleteMany` nulla sorra is
        sikeres, tehat egy elcsuszott elotag pontosan ugy nez ki, mint egy tiszta
        futas. Az `AuditLog` KULON szamlalot kap: az `entityId` NEM idegen kulcs,
        tehat a jegy torlese nem viszi el a sorait.
      */
      nincsMaradek([
        {
          nev: "a suite hibajegyei bent maradtak a takaritas utan",
          darab: await prisma.serviceJob.count({
            where: { jobNumber: { startsWith: TEST_JOB_PREFIX } },
          }),
        },
        {
          nev: "a suite felhasznaloi bent maradtak a takaritas utan",
          darab: await prisma.user.count({
            where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
          }),
        },
        {
          nev: "a suite naplo-sorai bent maradtak a takaritas utan",
          darab: await prisma.auditLog.count({
            where: { entityType: "ServiceJob", entityId: jobId },
          }),
        },
      ]);
    });

    /**
     * ISMERT POZITIV KONTROLL. Enelkul az alatta allo darabszam-allitas akkor
     * is teljesulne, ha a lekerdezes SEMMIT nem ad vissza -- es epp az a
     * legvaloszinubb elromlas (elirt `entityType`, rossz `entityId`).
     */
    it("a torles-sor MEGJELENIK", async () => {
      const sorok = await new ServiceJobsRepository().documentRemovals(jobId);
      assert.equal(sorok.length >= 1, true, "a torles-sor nem jott vissza");
      assert.equal(
        (sorok[0]?.metadata as { fileName?: string } | null)?.fileName,
        "torolt-csatolmany.pdf",
      );
    });

    /**
     * ES A HATAR: MAS ACTION UGYANARRA A JEGYRE NEM JON VISSZA.
     *
     * DARABSZAM, nem jelenlet. Egy "benne van a torles-sor" alaku allitas
     * akkor is zold lenne, ha a level-sor IS bekerulne -- vagyis pont azt a
     * hibat engedne at, ami ellen a szuro all.
     */
    it("MAS action-u sor ugyanarra a jegyre NEM jelenik meg", async () => {
      const sorok = await new ServiceJobsRepository().documentRemovals(jobId);
      assert.equal(
        sorok.length,
        1,
        `pontosan a torles-sort vartam, ez jott: ${sorok.length} sor`,
      );
    });
  },
);
