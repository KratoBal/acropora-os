import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { readPdfTextLines } from "../documents/pdf/pdf-text-readback.js";

import { main } from "./worksheet-sheet-backfill.cli.js";
import { parseWorksheetSheetCoverage } from "./worksheet-sheet-backfill.js";

/**
 * A MAR LEZART LAPOKHOZ UTOLAG KESZULO KIADOTT MUNKALAP, ADATBAZISON.
 *
 * === MIERT KELL, ES MIT NEM MER A TOBBI SUITE ===
 *
 * A DONTESI resz (mely verziohoz kell lap) tiszta fuggveny, es a
 * `worksheet-sheet-backfill.spec` meri. A LEKERDEZES es az IRAS resze viszont
 * eloszor az ELES negy lapon sulne el, ha ez a suite nem letezne -- es a
 * belyegkep-backfillnel ugyanez mar egyszer megmutatta, hogy az elso futas a
 * legrosszabb helyen mer eloszor.
 *
 * === A NEGY ALLITAS, ES A HARMADIK A KARTYA SAJAT KIKOTESE ===
 *
 *   1. a JELENTES MOD nem ir semmit
 *   2. az iras a LEZART verziohoz koti a lapot, es a szam nelkulit kihagyja
 *   3. a lap DATUMAI a VERZIOBOL jonnek, NEM az orabol -- egy MA legyartott
 *      lap az augusztusi munkalaphoz is a korabbi datumot viseli
 *   4. idempotens
 *
 * A harmadik azert all itt, mert a kartya kulon kimondja: aki ezt kesobb a
 * generalas idejere "javitana", epp a hitelesseget rontana el. Egy komment ezt
 * allitja; ez a suite MERI.
 *
 * === A HATOKOR KIMONDVA ===
 *
 * A `main` a TELJES adatbazison dolgozik, tehat csak eldobhato adatbazison fut
 * (lasd `integrationDatabaseGate`), es az allitasok a SAJAT sorokra allnak, nem
 * a kiirt osszesitokre. A lefedettsegi szamoknal az ALAPVONAL a fixturak ELOTT
 * keszul, igy a kulonbseg pontosan a mienk.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "SHEET-INT-";

/** A fixtura SZANDEKOSAN REGI datuma: a mai naptol tavol, hogy a ketto ne fedje. */
const REGI_NAP = "2026-08-22";

async function futtat(
  argv: string[],
): Promise<{ kod: number; kimenet: string }> {
  let kimenet = "";
  const kod = await main(argv, (szoveg) => {
    kimenet += szoveg;
  });
  return { kod, kimenet };
}

function lefedettseg(kimenet: string) {
  const szamok = parseWorksheetSheetCoverage(kimenet);
  assert.ok(
    szamok,
    `a lefedettsegi sor nem olvashato ki a kimenetbol:\n${kimenet}`,
  );
  return szamok;
}

describe(
  "Kiadott munkalap utolagos generalasa",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    let alapvonal: ReturnType<typeof lefedettseg>;
    let jeloltVerzio = "";
    let szamNelkuliVerzio = "";
    let lefedettVerzio = "";
    let piszkozatVerzio = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await takarit();

      alapvonal = lefedettseg((await futtat([])).kimenet);

      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}${suffix}`,
          type: "COMPANY",
          displayName: `Kiadott lap teszt ${suffix}`,
        },
      });
      const department = await prisma.worksheetDepartment.create({
        data: { customerId: customer.id, code: "SHT", name: "Kiadott lap" },
      });

      const lap = async (nev: string, szam: string | null, lezart: boolean) => {
        const ws = await prisma.worksheet.create({
          data: {
            customerId: customer.id,
            departmentId: department.id,
            number: szam,
            versions: {
              create: {
                version: 1,
                subject: `${PREFIX}${nev}`,
                status: lezart ? "SIGNED" : "DRAFT",
                issueDate: lezart
                  ? new Date(`${REGI_NAP}T00:00:00.000Z`)
                  : null,
                closedAt: lezart ? new Date(`${REGI_NAP}T15:42:19.000Z`) : null,
                lines: {
                  create: {
                    position: 1,
                    description: `${PREFIX}tetel`,
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
          select: { id: true, versions: { select: { id: true } } },
        });
        return { worksheetId: ws.id, versionId: ws.versions[0]!.id };
      };

      jeloltVerzio = (await lap("A", `${PREFIX}A-${suffix}`, true)).versionId;
      szamNelkuliVerzio = (await lap("B", null, true)).versionId;

      const lefedett = await lap("C", `${PREFIX}C-${suffix}`, true);
      lefedettVerzio = lefedett.versionId;
      await prisma.worksheetDocument.create({
        data: {
          worksheetId: lefedett.worksheetId,
          worksheetVersionId: lefedett.versionId,
          type: "GENERATED_SHEET",
          fileName: `${PREFIX}mar-megvan.pdf`,
          contentType: "application/pdf",
          sizeBytes: 8,
          sha256: "0".repeat(64),
          content: Uint8Array.from(Buffer.from("%PDF-1.4")),
        },
      });

      piszkozatVerzio = (await lap("D", `${PREFIX}D-${suffix}`, false))
        .versionId;
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await takarit();
      nincsMaradek([
        {
          nev: "a suite munkalapjai bent maradtak",
          darab: await prisma.worksheet.count({
            where: { versions: { some: { subject: { startsWith: PREFIX } } } },
          }),
        },
        {
          nev: "a suite dokumentumai bent maradtak",
          darab: await prisma.worksheetDocument.count({
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
     * A JELENTES MOD NEM IR. Ez a parancs alapertelmezese, tehat ez az, amit a
     * legtobbszor futtatnak -- es amit a legkonnyebb eszrevetlenul elrontani.
     */
    it("jelentes modban egyetlen lapot sem ir", async () => {
      const { kod, kimenet } = await futtat([]);

      assert.equal(kod, 1, "van teendo, tehat a kilepesi kod 1");
      assert.match(kimenet, /NEM IRT semmit/);
      assert.match(kimenet, /A kilepesi kod 1: VAN teendo/);
      assert.equal(await lapokSzama(jeloltVerzio), 0);
    });

    /**
     * A NEVEZO: a PISZKOZAT verzio NEM lezart, tehat bele sem szamit; a szam
     * nelkuli KULON szamlaloba megy.
     *
     * A KULONBSEGET MERJUK, mert a parancs a teljes adatbazison dolgozik. Es
     * mind a NEGY szamlalo all allitasban: ha a piszkozat is bekerulne, a
     * `lezart` kulonbsege NEGY lenne harom helyett, es egyetlen delta ezt nem
     * valasztana szet.
     */
    it("a nevezobe a harom LEZART verzio kerul, a piszkozat nem", async () => {
      const mostani = lefedettseg((await futtat([])).kimenet);

      assert.equal(mostani.lezart - alapvonal.lezart, 3);
      assert.equal(mostani.lefedve - alapvonal.lefedve, 1);
      assert.equal(mostani.hianyzik - alapvonal.hianyzik, 1);
      assert.equal(mostani.szamNelkul - alapvonal.szamNelkul, 1);
    });

    it("iras utan a jelolt kap lapot, a szam nelkuli nem", async () => {
      const { kimenet } = await futtat(["--ir"]);

      assert.equal(await lapokSzama(jeloltVerzio), 1);
      assert.equal(await lapokSzama(szamNelkuliVerzio), 0);
      assert.equal(await lapokSzama(piszkozatVerzio), 0);
      assert.match(kimenet, /SZAM NELKUL/);
    });

    /**
     * A MAR LEFEDETT VERZIO LAPJA ERINTETLEN MARAD -- NEM CSAK "EGY DARAB".
     *
     * Egy darabszam-allitas (`=== 1`) akkor is zold lenne, ha a parancs
     * LECSERELTE volna a meglevo lapot egy ujra. A FAJLNEV mondja meg, hogy az
     * EREDETI all ott: a fixtura sajat neve, nem a generator altal adott.
     *
     * Ez a kulonbseg elesben szamit: egy mar alairt lap tartalmat ujraírni
     * nem idempotencia, hanem adatvesztes.
     */
    it("a mar lefedett verzio EREDETI lapja marad", async () => {
      const sorok = await prisma.worksheetDocument.findMany({
        where: { worksheetVersionId: lefedettVerzio, type: "GENERATED_SHEET" },
        select: { fileName: true },
      });
      assert.equal(sorok.length, 1);
      assert.equal(sorok[0]!.fileName, `${PREFIX}mar-megvan.pdf`);
    });

    /**
     * A LAP A LEZART VERZIOHOZ KOTODIK, es ez nem formasag: a dokumentum
     * `worksheetVersionId` mezoje az, amire a kesobbi alairas es a
     * `@@unique([worksheetVersionId, type])` epul.
     */
    it("a keletkezett lap a LEZART verzio azonositojan all", async () => {
      const sor = await prisma.worksheetDocument.findFirstOrThrow({
        where: { worksheetVersionId: jeloltVerzio, type: "GENERATED_SHEET" },
        select: { worksheetVersionId: true, contentType: true, content: true },
      });
      assert.equal(sor.worksheetVersionId, jeloltVerzio);
      assert.equal(sor.contentType, "application/pdf");
      assert.ok(sor.content && sor.content.length > 0);
    });

    /**
     * A DATUMOK A VERZIOBOL JONNEK, NEM AZ ORABOL -- ES EZT A KARTYA KULON
     * KIKOTOTTE.
     *
     * Acrobot merese szerint a lekepezes a `version.issueDate` es a
     * `version.closedAt` ertekeket veszi at, es a generatorban nincs
     * `new Date()`. Ez az allitas MERI: a MA legyartott lap az AUGUSZTUSI
     * datumot viseli, es a mai nap NEM all rajta.
     *
     * Aki ezt kesobb a generalas idejere "javitana", epp a hitelesseget
     * rontana el -- a lap arrol a naprol szol, amikor a munka lezarult.
     */
    it("a lap a VERZIO datumat viseli, nem a mai napot", async () => {
      const sor = await prisma.worksheetDocument.findFirstOrThrow({
        where: { worksheetVersionId: jeloltVerzio, type: "GENERATED_SHEET" },
        select: { content: true },
      });
      assert.ok(sor.content);

      const szoveg = (await readPdfTextLines(sor.content))
        .map((sor) => sor.text)
        .join("\n");

      assert.match(szoveg, new RegExp(REGI_NAP));
      const ma = new Date().toISOString().slice(0, 10);
      assert.notEqual(ma, REGI_NAP, "a fixtura napja nem lehet a mai nap");
      assert.doesNotMatch(szoveg, new RegExp(ma));
    });

    /**
     * IDEMPOTENS: a mar lefedett verziot nem veszi ujra elo. Enelkul egy
     * masodik futas az egyedi indexen hasalna el -- es a kimenete ugy nezne
     * ki, mintha a parancs elromlott volna.
     */
    it("masodik futasnal a sajat sorai mar nem jeloltek", async () => {
      const { kimenet } = await futtat([]);
      assert.doesNotMatch(kimenet, new RegExp(jeloltVerzio));
      assert.equal(await lapokSzama(jeloltVerzio), 1);
    });

    async function lapokSzama(versionId: string) {
      return prisma.worksheetDocument.count({
        where: { worksheetVersionId: versionId, type: "GENERATED_SHEET" },
      });
    }

    async function takarit() {
      const customers = await prisma.customer.findMany({
        where: { customerNumber: { startsWith: PREFIX } },
        select: { id: true },
      });
      const ids = customers.map((c) => c.id);
      if (ids.length > 0) {
        await prisma.worksheet.deleteMany({
          where: { customerId: { in: ids } },
        });
        await prisma.worksheetDepartment.deleteMany({
          where: { customerId: { in: ids } },
        });
      }
      await prisma.customer.deleteMany({
        where: { customerNumber: { startsWith: PREFIX } },
      });
    }
  },
);
