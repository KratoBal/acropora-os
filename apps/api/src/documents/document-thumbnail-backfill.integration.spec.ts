import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";

import { main } from "./document-thumbnail-backfill.cli.js";
import { THUMBNAIL_MAX_EDGE } from "./document-thumbnail.js";

/**
 * A VISSZAMENOLEGES BELYEGKEP-GENERALAS, ADATBAZISON.
 *
 * === MIERT KELL, ES MIT NEM MER A TOBBI SUITE ===
 *
 * A parancs DONTESI resze (mely sorokhoz kell belyegkep, mi a lefedettseg
 * nevezoje) tiszta fuggveny, es a `document-thumbnail-backfill.spec` meri. A
 * LEKERDEZES es az IRAS resze viszont eddig SEHOL nem sult el: eloszor az eles
 * futason futott volna le, huszonkilenc eles soron.
 *
 * Acrobot mondata errol (2026-09-18): egy olyan iras, ami eloszor eles adaton
 * sul el, a legrosszabb helyen mer eloszor.
 *
 * === AMIT MER, ES A MASODIK A FONTOSABB ===
 *
 *   1. az IRAS  a harom tabla MINDEGYIKEN a helyes oszlopba ir, kep eseten
 *   2. a JELENTES MOD NEM IR SEMMIT -- ez a biztonsagi allitas, es a parancs
 *      teljes alapertelmezese ezen all
 *   3. a PDF-hez nem keszul belyegkep, es a parancs nem is akad el rajta
 *   4. IDEMPOTENS: a masodik futas a mar lefedett sorokat nem veszi ujra elo
 *
 * === A HATOKOR KIMONDVA ===
 *
 * A `main` a TELJES adatbazison dolgozik, nem csak a sajat fixturain -- ezert
 * futtathato csak eldobhato adatbazison (lasd `integrationDatabaseGate`), es
 * ezert allnak az allitasok a SAJAT sorokra, nem a kiirt osszesitokre. Egy
 * osszesitore epulo allitas a szomszed suite maradekatol is elbukhatna.
 *
 * AMIT NEM MER: a taroloban allo (storageKey-s) sorok agat. Ehhez csatolt
 * kotet kellene, es a CI-ben nincs. A `bytesFor` tarolo-aga tehat itt sem sul
 * el -- ezt kimondom, mert kulonben a zold ugy nezne ki, mintha mindket
 * forrast lefedne.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "THUMB-INT-";

/**
 * A PARANCS KIMENETE GYUJTOBE MEGY, NEM A GLOBALIS `process.stdout`-BA.
 *
 * AZ ELSO ALAKOM A `process.stdout.write` FUGGVENYT CSERELTE LE, ES AZ
 * ELNYELTE A TESZT-FUTTATO SAJAT TAP-SORAIT. Merve a CI elso futasan: NEGY
 * teszt futott le (`1..4`), es csak KETTONEK jelent meg az `ok` sora a
 * naploban -- a masik ketto az en gyujtomben kotott ki.
 *
 * A suite ettol ZOLD volt, tehat semmi nem szolt. A baj a TAP-FOLYAMBAN allt:
 * a repo naplot OLVASO kapui (`tap-stream-gate.mjs`,
 * `integration-suite-gate.mjs`) ebbol dolgoznak, es egy elnyelt `not ok` sor
 * LATHATATLAN bukast jelentene.
 *
 * A javitas nem itt van, hanem a parancsban: a `main` mostantol kapott nyelobe
 * ir. Egy teszt, aminek GLOBALIS allapotot kell atirnia ahhoz, hogy merjen, azt
 * mondja meg, hogy a MERT KOD felulete hianyzik -- nem azt, hogy a teszt ugyes.
 */
async function futtat(
  argv: string[],
): Promise<{ kod: number; kimenet: string }> {
  let kimenet = "";
  const kod = await main(argv, (szoveg) => {
    kimenet += szoveg;
  });
  return { kod, kimenet };
}

/**
 * VALODI KEP, NEM ATTRAPP.
 *
 * Egy kitalalt bajtsoron az atmeretezes elhasalna, es a `null` ag futna le --
 * vagyis a suite ZOLD lenne ugy, hogy semmit nem irt. A meret szandekosan
 * NAGYOBB a hatarnal, hogy a kicsinyites tenylegesen megtortenjen.
 */
async function kepBajtok(): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const el = THUMBNAIL_MAX_EDGE * 2;
  const nyers = Buffer.alloc(el * el * 3);
  for (let i = 0; i < nyers.length; i += 1) nyers[i] = (i * 31) % 251;
  return sharp(nyers, { raw: { width: el, height: el, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

describe(
  "Belyegkep utolagos generalasa",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    let assetKep = "";
    let assetPdf = "";
    let worksheetKep = "";
    let jobKep = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await takarit();

      const kep = await kepBajtok();
      const pdf = Buffer.from("%PDF-1.4\n% proba\n");

      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}${suffix}`,
          type: "COMPANY",
          displayName: `Belyegkep teszt ${suffix}`,
        },
      });
      const asset = await prisma.asset.create({
        data: {
          assetNumber: `${PREFIX}${suffix}`,
          name: "Belyegkep teszt eszkoz",
          customerId: customer.id,
        },
      });
      const department = await prisma.worksheetDepartment.create({
        data: { customerId: customer.id, code: "THB", name: "Belyegkep teszt" },
      });
      const worksheet = await prisma.worksheet.create({
        data: { customerId: customer.id, departmentId: department.id },
      });
      const job = await prisma.serviceJob.create({
        data: {
          jobNumber: `${PREFIX}${suffix}`,
          title: "Belyegkep teszt hibajegy",
          customerId: customer.id,
        },
      });

      const kozos = (nev: string, bajtok: Buffer, tipus: string) => ({
        fileName: `${PREFIX}${nev}`,
        contentType: tipus,
        sizeBytes: bajtok.length,
        sha256: "0".repeat(64),
        content: Uint8Array.from(bajtok),
        caption: null,
      });

      assetKep = (
        await prisma.assetDocument.create({
          data: {
            assetId: asset.id,
            type: "OTHER",
            ...kozos("eszkoz.jpg", kep, "image/jpeg"),
          },
          select: { id: true },
        })
      ).id;
      assetPdf = (
        await prisma.assetDocument.create({
          data: {
            assetId: asset.id,
            type: "OTHER",
            ...kozos("eszkoz.pdf", pdf, "application/pdf"),
          },
          select: { id: true },
        })
      ).id;
      worksheetKep = (
        await prisma.worksheetDocument.create({
          data: {
            worksheetId: worksheet.id,
            type: "PHOTO",
            ...kozos("munkalap.jpg", kep, "image/jpeg"),
          },
          select: { id: true },
        })
      ).id;
      jobKep = (
        await prisma.serviceJobDocument.create({
          data: {
            serviceJobId: job.id,
            type: "PHOTO",
            ...kozos("hibajegy.jpg", kep, "image/jpeg"),
          },
          select: { id: true },
        })
      ).id;
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await takarit();
      nincsMaradek([
        {
          nev: "a suite eszkoz-dokumentumai bent maradtak",
          darab: await prisma.assetDocument.count({
            where: { fileName: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite munkalap-dokumentumai bent maradtak",
          darab: await prisma.worksheetDocument.count({
            where: { fileName: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite hibajegy-dokumentumai bent maradtak",
          darab: await prisma.serviceJobDocument.count({
            where: { fileName: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite vevoi bent maradtak",
          darab: await prisma.customer.count({
            where: { customerNumber: { startsWith: PREFIX } },
          }),
        },
      ]);
    });

    /**
     * A JELENTES MOD NEM IR. Ez a parancs alapertelmezese, tehat ez az a
     * viselkedes, amit a legtobbszor futtatnak -- es amit a legkonnyebb
     * eszrevetlenul elrontani.
     */
    it("jelentes modban egyetlen belyegkepet sem ir", async () => {
      const { kod, kimenet } = await futtat([]);

      assert.equal(kod, 1, "van teendo, tehat a kilepesi kod 1");
      assert.match(kimenet, /NEM IRT semmit/);
      assert.deepEqual(await belyegHosszak(), {
        assetKep: null,
        assetPdf: null,
        worksheetKep: null,
        jobKep: null,
      });
    });

    it("iras modban mind a harom tabla kepet kap, a PDF nem", async () => {
      const { kimenet } = await futtat(["--ir"]);

      const hosszak = await belyegHosszak();
      assert.equal(hosszak.assetPdf, null, "a PDF-hez nem keszulhet belyegkep");
      for (const kulcs of ["assetKep", "worksheetKep", "jobKep"] as const) {
        const hossz = hosszak[kulcs];
        assert.ok(
          hossz !== null && hossz > 0,
          `${kulcs}: nem keletkezett belyegkep`,
        );
      }

      /**
       * A MERT NYERESEG A KIMENETBEN IS MEGJELENIK. A parancs azert irja ki,
       * hogy az eles futas utan ne kelljen elhinni a becslest -- ha ez a sor
       * elmarad, a szam sehol nem all elo.
       */
      assert.match(kimenet, /eredeti: \d+ bajt, belyegkep: \d+ bajt/);
    });

    it("a belyegkep KISEBB az eredetinel", async () => {
      const sor = await prisma.assetDocument.findUniqueOrThrow({
        where: { id: assetKep },
        select: { sizeBytes: true, thumbnail: true },
      });
      assert.ok(sor.thumbnail);
      assert.ok(
        sor.thumbnail.length < sor.sizeBytes,
        `a belyegkep (${sor.thumbnail.length}) nem kisebb az eredetinel (${sor.sizeBytes})`,
      );
    });

    /**
     * IDEMPOTENS: a mar lefedett sorokat nem veszi ujra elo. Enelkul egy masodik
     * futas ujra dekodolna mind a huszonkilenc eles kepet -- es a bajt-szamai
     * ujra megjelennenek a nyereseg-sorban, mintha ujra megtakaritottunk volna.
     */
    it("masodik futasnal a sajat sorai mar nem jeloltek", async () => {
      const { kimenet } = await futtat([]);
      for (const azonosito of [assetKep, worksheetKep, jobKep])
        assert.doesNotMatch(kimenet, new RegExp(azonosito));
    });

    async function belyegHosszak() {
      const hossz = (b: Uint8Array | null) => (b === null ? null : b.length);
      const [a, p, w, j] = await Promise.all([
        prisma.assetDocument.findUniqueOrThrow({
          where: { id: assetKep },
          select: { thumbnail: true },
        }),
        prisma.assetDocument.findUniqueOrThrow({
          where: { id: assetPdf },
          select: { thumbnail: true },
        }),
        prisma.worksheetDocument.findUniqueOrThrow({
          where: { id: worksheetKep },
          select: { thumbnail: true },
        }),
        prisma.serviceJobDocument.findUniqueOrThrow({
          where: { id: jobKep },
          select: { thumbnail: true },
        }),
      ]);
      return {
        assetKep: hossz(a.thumbnail),
        assetPdf: hossz(p.thumbnail),
        worksheetKep: hossz(w.thumbnail),
        jobKep: hossz(j.thumbnail),
      };
    }

    async function takarit() {
      for (const tabla of [
        prisma.assetDocument,
        prisma.worksheetDocument,
        prisma.serviceJobDocument,
      ] as const)
        await (
          tabla as { deleteMany: (a: unknown) => Promise<unknown> }
        ).deleteMany({ where: { fileName: { startsWith: PREFIX } } });

      const customers = await prisma.customer.findMany({
        where: { customerNumber: { startsWith: PREFIX } },
        select: { id: true },
      });
      const ids = customers.map((customer) => customer.id);
      if (ids.length > 0) {
        await prisma.worksheet.deleteMany({
          where: { customerId: { in: ids } },
        });
        await prisma.worksheetDepartment.deleteMany({
          where: { customerId: { in: ids } },
        });
        await prisma.asset.deleteMany({ where: { customerId: { in: ids } } });
      }
      await prisma.serviceJob.deleteMany({
        where: { jobNumber: { startsWith: PREFIX } },
      });
      await prisma.customer.deleteMany({
        where: { customerNumber: { startsWith: PREFIX } },
      });
    }
  },
);
