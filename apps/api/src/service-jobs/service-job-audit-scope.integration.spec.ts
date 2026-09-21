import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { DOCUMENT_DELETED_ACTION } from "./service-job-documents.repository.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";

/**
 * A JEGY AUDIT-SORAINAK HATOKORE -- VALODI SOROKON.
 *
 * === MIERT LETT EZ TEHERHORDO (acrobot kerese, 2026-09-21 23:29) ===
 *
 * A `documentRemovals` ma a jegy audit-soraibol CSAK a dokumentum-torles
 * akciojat adja vissza, es ez eddig megjelenites-optimalizalasnak latszott: a
 * reszletlapon csak a torlesek kellenek.
 *
 * A lezart hibajegy kikuldesenel a CIMZETTEK NEVE ES CIME ugyanebbe a tablaba
 * kerul, MASIK `action` ertekkel. Ettol a pillanattol ez a szuro NEM kenyelmi
 * kerdes: EZ valasztja el a cimeket a partner-portaltol.
 *
 * Egy kesobbi, johiszemu "vegyuk ki a szurot, ugyis egy jegyrol szol"
 * valtoztatas CSENDBEN kivinne a cimeket a reszletlapra.
 *
 * === MIERT NEM FORRAS-OLVASO ALLITAS, HOLOTT AZT IRTAM ELOSZOR ===
 *
 * Megirtam forras-olvasokent (a `where` zaradekban all-e az `action` szures),
 * es KALIBRALTAM. A rontas, ami a szurest `...(kapcsolo ? { action } : {})`
 * alakra cserelte, ZOLD MARADT: a SZOVEG valtozatlan maradt, a VISELKEDES nem.
 *
 * Egy szoveg-illesztes tehat itt nem tud kulonbseget tenni az ELO es a
 * KIKAPCSOLT szuro kozott -- es epp ez a kulonbseg az, amiert az allitas
 * letezik. Ezert all valodi sorokon.
 *
 * (A masik, egyszerubb rontas -- a sor TORLESE -- amugy sem jut el a
 * tesztekig: arvan hagyja az importot, es a fordito megall rajta. Vagyis a
 * torlest MA IS a fordito fogja meg; ez az allitas a KIKAPCSOLAS ellen szol.)
 *
 * === ITT NEM FUT ===
 *
 * Ebben a konteneben nincs postgres. A CI `verify` jobja valodi szolgaltatast
 * indit, es a suite-kapu elbuktatja a jobot, ha ez a fajl nem futott le. A
 * helyi zold errol a suite-rol SEMMIT nem allit.
 *
 * === A VARHATO KALIBRACIO, ELORE LEIRVA ===
 *
 *   az `action` szures elhagyasa a `documentRemovals` where zaradekabol
 *       -> ez az allitas PIROS (ket sort kapna egy helyett)
 *   a torles-sor beirasanak elhagyasa a fixturabol
 *       -> ez az allitas PIROS, de MAS okbol (nulla sor) -- ezert all kulon
 *          allitas a torles-sor MEGLETERE is
 */
const gate = integrationDatabaseGate(process.env);

const TEST_JOB_PREFIX = "HJ-AUDIT-";
const MAIL_ACTION = "service_job.mail.sent";

describe(
  "a jegy audit-sorainak hatóköre valódi sorokon",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new ServiceJobsRepository();
    const suffix = `${Date.now() % 1_000_000}`.padStart(6, "0");
    let serviceJobId: string;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      const job = await prisma.serviceJob.create({
        data: {
          jobNumber: `${TEST_JOB_PREFIX}${suffix}`,
          title: "Audit-hatókör",
          status: "NEW",
        },
        select: { id: true },
      });
      serviceJobId = job.id;

      await prisma.auditLog.createMany({
        data: [
          {
            action: DOCUMENT_DELETED_ACTION,
            entityType: "ServiceJob",
            entityId: serviceJobId,
            metadata: { fileName: "torolt.pdf" },
          },
          /*
            EZ A SOR AZ, AMI NEM JOHET KI. Ugyanaz a jegy, ugyanaz az
            `entityType` -- CSAK az `action` mas. Ha a szures elveszik, ez a sor
            a reszletlapra kerul, es vele a cimzettek cime.
          */
          {
            action: MAIL_ACTION,
            entityType: "ServiceJob",
            entityId: serviceJobId,
            metadata: { recipients: [{ email: "cim@partner.hu" }] },
          },
        ],
      });
    });

    after(async () => {
      await removeLeftovers();
    });

    /**
     * ISMERT POZITIV KONTROLL. Enelkul a lenti allitas ("csak egy sor") egy
     * URES eredmenyen is zold lenne -- vagyis akkor is, ha a lekerdezes
     * egyaltalan nem talal semmit.
     */
    it("a törlés-sort visszaadja", async () => {
      const sorok = await repository.documentRemovals(serviceJobId);
      assert.equal(sorok.length, 1);
      assert.deepEqual(
        (sorok[0]?.metadata as { fileName?: string } | null)?.fileName,
        "torolt.pdf",
      );
    });

    it("a MÁS akciójú sort NEM adja vissza", async () => {
      const sorok = await repository.documentRemovals(serviceJobId);
      const cimek = JSON.stringify(sorok);
      assert.doesNotMatch(cimek, /cim@partner\.hu/);
    });

    async function removeLeftovers() {
      const jegyek = await prisma.serviceJob.findMany({
        where: { jobNumber: { startsWith: TEST_JOB_PREFIX } },
        select: { id: true },
      });
      await prisma.auditLog.deleteMany({
        where: {
          entityType: "ServiceJob",
          entityId: { in: jegyek.map((jegy) => jegy.id) },
        },
      });
      await prisma.serviceJob.deleteMany({
        where: { jobNumber: { startsWith: TEST_JOB_PREFIX } },
      });
    }
  },
);
