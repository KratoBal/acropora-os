import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { AuthUserResolver } from "../auth/auth-user-resolver.js";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { InMemoryDocumentStore } from "../service-assets/document-store/in-memory-document-store.js";
import { ServiceJobDocumentsRepository } from "./service-job-documents.repository.js";
import { ServiceJobDocumentsService } from "./service-job-documents.service.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";

/**
 * A JEGY-CSATOLMANYOK OT UTJA, VALODI SOROKON.
 *
 * === MIERT KELL: A FEDES ITT NULLA VOLT (e59a0608, merve 2026-09-22) ===
 *
 * A harom szerviz-kontroller harminc partner-jog alatti utvonalabol az
 * `service-assets` es a jegy OT IRO utja mar merve van valodi sorokon
 * (`partner-scope-endpoint`, `service-jobs-write-scope`,
 * `service-job-placement`). A JEGY-DOKUMENTUMOKAT viszont EGYETLEN integracios
 * spec sem peldanyositotta: a `ServiceJobDocumentsService`-re nulla `new`
 * hivas allt a teljes fan.
 *
 * A kapu LETEZIK -- `requireVisibleJob` MINDEN metodus elso soraban --, es
 * olvasasbol meg is van mérve. Amit semmi nem bizonyitott: hogy a SOR szintjen
 * tenyleg szur.
 *
 * ES EGY MERESI CSAPDA, AMI EZT A LYUKAT ELFEDTE: a modulok metodusnevei
 * UTKOZNEK (`documents`, `addDocument`, `setDocumentCaption`, `deleteDocument`
 * az eszkoz-oldalon IS letezik). Egy nev-alapu fedes-terkep ezert azt mutatta,
 * hogy az `asset-documents-list` spec ezt a modult is fedi. Osztaly-importra
 * merve derult ki, hogy nem.
 *
 * === AMIT EZ A SUITE ALLIT, ES AMIT SZANDEKOSAN NEM ===
 *
 * A jegy-dokumentumok kapuja LATHATOSAG, nem belsos-only -- es ez nem
 * mellekes. A `serviceJobVisibilityWhere` szerint egy `customer` hatokoru,
 * egyseg nelkuli partner a SAJAT vevojehez tartozo ES SAJAT NYITOTT jegyet
 * latja:
 *
 *     { AND: [{ customerId: <a partner vevoje> }, { openedById: <a partner> }] }
 *
 * Ezert MINDEN uthoz HAROM allitas tartozik, es a masodik a lenyeg:
 *
 *   1. IDEGEN jegyen a partner 404-et kap, es a tabla VALTOZATLAN
 *   2. A SAJAT jegyen a partner ATMEGY -- ez a read-oldali pozitiv kontroll
 *   3. A belsos hivo mindkettot eleri
 *
 * A masodik allitas nelkul a keszlet akkor is zold lenne, ha valaki
 * BELSOS-ONLY kapura szukitene a modult -- vagyis epp azt a viselkedest nem
 * merne, amirol a modul szol. Egy partner a sajat bejelentesenek fenykepeit
 * JOGOSAN latja, es ezt egy allitasnak ki kell mondania, kulonben a kovetkezo
 * "biztonsagi javitas" elveszi.
 *
 * === A TAKARITAS EREDMENYET KULON `it` MERI, ES EZ MERT OKBOL VAN IGY ===
 *
 * A szomszed suite fejlece szerint (merve 2026-09-15, run 34950778936) egy
 * `after` hookban tortent bukas NEMA: `not ok <n>` megjelenik, de a `# fail`
 * NULLA es a kilepesi kod is nulla -- tehat sem a CI lepes, sem a
 * `kalibracio.sh` nem latja. Ezert a takaritas egy `it`-ben is lefut, ahol a
 * szamlalok LATHATOAN sulnek el.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_EMAIL_DOMAIN = "service-job-documents-scope-integration.invalid";
const TEST_CUSTOMER_PREFIX = "SJDS-INT-";
const TEST_JOB_PREFIX = "HJ-SJDS-";

const TARTALOM = Buffer.from("%PDF-1.4 teszt");

/** A feltoltes valodi PDF-et var: a szolgaltatas a `%PDF-` fejlecet ellenorzi. */
function pdf(fileName: string): Express.Multer.File {
  const buffer = TARTALOM;
  return {
    fieldname: "file",
    originalname: fileName,
    encoding: "7bit",
    mimetype: "application/pdf",
    size: buffer.length,
    buffer,
  } as Express.Multer.File;
}

describe(
  "a jegy csatolmányai valódi sorokon",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`.padStart(6, "0");
    const resolver = new AuthUserResolver();
    const service = new ServiceJobDocumentsService(
      new ServiceJobDocumentsRepository(),
      new ServiceJobsRepository(),
      new InMemoryDocumentStore(),
    );

    let customerA: string;
    let customerB: string;
    let departmentA: string;
    let departmentB: string;
    let belsos: AuthenticatedUser;
    let partner: AuthenticatedUser;

    /** A partner SAJAT jegye: a vevoje ES o nyitotta. */
    let sajatJob: string;
    /** IDEGEN jegy: MAS vevo, es nem o nyitotta. */
    let idegenJob: string;
    let sajatDoc: string;
    let idegenDoc: string;

    let sorszam = 0;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      const [rowA, rowB] = await Promise.all([
        prisma.customer.create({
          data: {
            customerNumber: `${TEST_CUSTOMER_PREFIX}${suffix}-A`,
            type: "COMPANY",
            displayName: "Csatolmány Vevő A",
          },
          select: { id: true },
        }),
        prisma.customer.create({
          data: {
            customerNumber: `${TEST_CUSTOMER_PREFIX}${suffix}-B`,
            type: "COMPANY",
            displayName: "Csatolmány Vevő B",
          },
          select: { id: true },
        }),
      ]);
      customerA = rowA.id;
      customerB = rowB.id;
      // HELYSZIN MINDKET VEVONEK -- a `departmentId` mostantol kotelezo, es
      // egyik itt allo allitas sem a helyszinrol szol.
      const [deptRowA, deptRowB] = await Promise.all([
        prisma.worksheetDepartment.create({
          data: { customerId: customerA, code: "CSA", name: "A helyszín" },
          select: { id: true },
        }),
        prisma.worksheetDepartment.create({
          data: { customerId: customerB, code: "CSB", name: "B helyszín" },
          select: { id: true },
        }),
      ]);
      departmentA = deptRowA.id;
      departmentB = deptRowB.id;

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
        /*
          A PARTNER-HATOKORT A `customerId` ADJA, NEM A SZEREPKOR. A `SERVICE`
          szerep szandekos: ez a fiok a `service.manage` jogot MEGKAPNA, tehat a
          jogosultsagi kapu nem allitana meg -- egyedul a hatokor.
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

      sajatJob = await newJob(customerA, partner.id, departmentA);
      idegenJob = await newJob(customerB, belsos.id, departmentB);

      sajatDoc = await newDocument(sajatJob, "sajat.pdf");
      idegenDoc = await newDocument(idegenJob, "idegen.pdf");
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
    });

    async function newJob(
      customerId: string,
      openedById: string,
      departmentId: string,
    ): Promise<string> {
      sorszam += 1;
      const job = await prisma.serviceJob.create({
        data: {
          jobNumber: `${TEST_JOB_PREFIX}${suffix}-${sorszam}`,
          title: "Nem indul a szivattyú",
          customerId,
          departmentId,
          openedById,
        },
        select: { id: true },
      });
      return job.id;
    }

    async function newDocument(
      serviceJobId: string,
      fileName: string,
    ): Promise<string> {
      const doc = await prisma.serviceJobDocument.create({
        data: {
          serviceJobId,
          fileName,
          contentType: "application/pdf",
          sizeBytes: TARTALOM.length,
          type: "OTHER",
          /*
            A `sha256` KOTELEZO a modellen, es a bajtokbol szamolom, nem
            kitalalom: egy allando literal ket kulonbozo tartalomra ugyanazt
            adna, es a `@@index([sha256])` melletti jovobeli deduplikacio
            csendben osszevonna oket.
          */
          sha256: createHash("sha256").update(TARTALOM).digest("hex"),
          content: TARTALOM,
        },
        select: { id: true },
      });
      return doc.id;
    }

    function darab(serviceJobId: string) {
      return prisma.serviceJobDocument.count({ where: { serviceJobId } });
    }

    /* ====================== 1. LISTA ====================== */

    it("lista: IDEGEN jegyen a partner 404-et kap", async () => {
      await assert.rejects(
        service.documents(idegenJob, partner),
        /nem található/,
      );
    });

    it("lista: a SAJÁT jegyén a partner ÁTMEGY", async () => {
      const valasz = await service.documents(sajatJob, partner);
      assert.deepEqual(
        valasz.items.map((item) => item.fileName),
        ["sajat.pdf"],
      );
    });

    it("lista: a belsős hívó MINDKETTŐT eléri", async () => {
      const [sajat, idegen] = await Promise.all([
        service.documents(sajatJob, belsos),
        service.documents(idegenJob, belsos),
      ]);
      assert.equal(sajat.items.length, 1);
      assert.equal(idegen.items.length, 1);
    });

    /* ====================== 2. LETOLTES ====================== */

    it("letöltés: IDEGEN jegyen a partner 404-et kap", async () => {
      await assert.rejects(
        service.documentBytes(idegenJob, idegenDoc, partner),
        /nem található/,
      );
    });

    it("letöltés: a SAJÁT jegyén a partner ÁTMEGY", async () => {
      const doc = await service.documentBytes(sajatJob, sajatDoc, partner);
      assert.equal(doc.fileName, "sajat.pdf");
    });

    /* ====================== 3. FELTOLTES ====================== */

    it("feltöltés: IDEGEN jegyen a partner 404, és a tábla VÁLTOZATLAN", async () => {
      const elotte = await darab(idegenJob);
      await assert.rejects(
        service.addDocument(idegenJob, "OTHER", pdf("tiltott.pdf"), partner),
        /nem található/,
      );
      assert.equal(
        await darab(idegenJob),
        elotte,
        "a partner feltöltése bekerült az IDEGEN jegy alá",
      );
    });

    it("feltöltés: a SAJÁT jegyén a partner ÁTMEGY, és a tábla VÁLTOZIK", async () => {
      const elotte = await darab(sajatJob);
      const created = await service.addDocument(
        sajatJob,
        "OTHER",
        pdf("sajat-feltoltes.pdf"),
        partner,
      );
      assert.equal(created.fileName, "sajat-feltoltes.pdf");
      assert.equal(await darab(sajatJob), elotte + 1);
    });

    /* ====================== 4. FELIRAT ====================== */

    it("felirat: IDEGEN jegyen a partner 404, és a szöveg VÁLTOZATLAN", async () => {
      const elotte = await prisma.serviceJobDocument.findUnique({
        where: { id: idegenDoc },
        select: { caption: true },
      });
      await assert.rejects(
        service.setDocumentCaption(idegenJob, idegenDoc, "átírva", partner),
        /nem található/,
      );
      const utana = await prisma.serviceJobDocument.findUnique({
        where: { id: idegenDoc },
        select: { caption: true },
      });
      assert.equal(utana?.caption, elotte?.caption ?? null);
    });

    it("felirat: a belsős hívónál a szöveg VÁLTOZIK", async () => {
      await service.setDocumentCaption(
        idegenJob,
        idegenDoc,
        "belsős felirat",
        belsos,
      );
      const utana = await prisma.serviceJobDocument.findUnique({
        where: { id: idegenDoc },
        select: { caption: true },
      });
      assert.equal(utana?.caption, "belsős felirat");
    });

    /* ====================== 5. TORLES ====================== */

    it("törlés: IDEGEN jegyen a partner 404, és a sor MEGMARAD", async () => {
      const elotte = await darab(idegenJob);
      await assert.rejects(
        service.deleteDocument(idegenJob, idegenDoc, partner),
        /nem található/,
      );
      assert.equal(
        await darab(idegenJob),
        elotte,
        "a partner törlése elvitte az IDEGEN jegy csatolmányát",
      );
    });

    it("törlés: a belsős hívónál a sor ELTŰNIK", async () => {
      const sajatUj = await newDocument(idegenJob, "torlendo.pdf");
      const elotte = await darab(idegenJob);
      await service.deleteDocument(idegenJob, sajatUj, belsos);
      assert.equal(await darab(idegenJob), elotte - 1);
    });

    /* ====================== A TAKARITAS ====================== */

    it("a takarítás tényleg lefut: nem marad sor a teszt előtaggal", async () => {
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "a suite jegyei bent maradtak a takarítás után",
          darab: await prisma.serviceJob.count({
            where: { jobNumber: { startsWith: TEST_JOB_PREFIX } },
          }),
        },
        {
          nev: "a suite fiókjai bent maradtak a takarítás után",
          darab: await prisma.user.count({
            where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
          }),
        },
        {
          nev: "a suite vevői bent maradtak a takarítás után",
          darab: await prisma.customer.count({
            where: { customerNumber: { startsWith: TEST_CUSTOMER_PREFIX } },
          }),
        },
      ]);
    });

    async function removeLeftovers() {
      /*
        A JEGY TORLESE VISZI A CSATOLMANYOKAT (`Cascade`), es a jegyeknek a
        VEVO elott kell eltunniuk. A felhasznalok is a vevo ELOTT: a
        partner-fiok `customerId` mezoje idegenkulcs (`Restrict`).
      */
      await prisma.serviceJob.deleteMany({
        where: { jobNumber: { startsWith: TEST_JOB_PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });
      const customers = await prisma.customer.findMany({
        where: { customerNumber: { startsWith: TEST_CUSTOMER_PREFIX } },
        select: { id: true },
      });
      const customerIds = customers.map((customer) => customer.id);
      if (customerIds.length)
        await prisma.worksheetDepartment.deleteMany({
          where: { customerId: { in: customerIds } },
        });
      await prisma.customer.deleteMany({
        where: { customerNumber: { startsWith: TEST_CUSTOMER_PREFIX } },
      });
    }
  },
);
