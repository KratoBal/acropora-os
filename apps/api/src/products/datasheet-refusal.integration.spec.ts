import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { findRefusalConflicts } from "./datasheet-refusal-audit.js";

const gate = integrationDatabaseGate(process.env);
const runIntegration = gate.mode !== "skip";

/**
 * A MEGTAGADÁS-ÁLLAPOT AZ ADATBÁZISON MÉRVE.
 *
 * Két külön dolgot bizonyít, és a kettőt nem szabad összekeverni:
 *
 * 1. hogy az ÜRES INDOK-ot a `CHECK` megszorítás tényleg elutasítja - ezt csak
 *    adatbázis tudja megmondani, mert a `NOT NULL` az üres stringet átengedné;
 * 2. hogy az AUDIT megtalálja az ellentmondó párt (kitöltött mező + megtagadás)
 *    egy VALÓDI táblán, nem csak egy kézzel összerakott tömbön.
 *
 * Amit NEM bizonyít: hogy bármelyik éles vagy staging adatbázis tiszta. Ez a
 * suite egy üres, frissen migrált adatbázison fut, tehát ott az audit magától
 * zöld. Egy valódi adatbázisról csak az mond valamit, ha az auditot AZ ELLEN
 * futtatja valaki.
 */

const PREFIX = `datasheet-${Date.now()}`;

async function makeSheet() {
  const product = await prisma.product.create({
    data: { name: `${PREFIX} termék`, isActive: true },
  });
  return prisma.productDatasheet.create({
    data: { productId: product.id },
  });
}

describe(
  "ProductDatasheet megtagadás, adatbázis-szinten",
  { skip: !runIntegration },
  () => {
    before(() => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
    });

    after(async () => {
      const sheets = await prisma.productDatasheet.findMany({
        where: { product: { name: { startsWith: PREFIX } } },
        select: { id: true, productId: true },
      });
      await prisma.productDatasheetFieldRefusal.deleteMany({
        where: { datasheetId: { in: sheets.map((row) => row.id) } },
      });
      await prisma.productDatasheet.deleteMany({
        where: { id: { in: sheets.map((row) => row.id) } },
      });
      await prisma.product.deleteMany({
        where: { id: { in: sheets.map((row) => row.productId) } },
      });
      await prisma.$disconnect();
    });

    it("refuses an empty reason", async () => {
      const sheet = await makeSheet();

      await assert.rejects(
        prisma.productDatasheetFieldRefusal.create({
          data: {
            datasheetId: sheet.id,
            mezo: "TARTASA",
            indok: "",
            oka: "NINCS_FORRAS",
          },
        }),
      );
    });

    /**
     * A CSUPA SZÓKÖZ UGYANÚGY ÜRES. `NOT NULL` és egy naiv „ne legyen üres"
     * ellenőrzés ezt átengedné, és onnantól a megtagadás indoklás nélkül állna -
     * pontosan az az állapot, amit a döntés megszüntet.
     */
    it("refuses a whitespace-only reason", async () => {
      const sheet = await makeSheet();

      await assert.rejects(
        prisma.productDatasheetFieldRefusal.create({
          data: {
            datasheetId: sheet.id,
            mezo: "TARTASA",
            indok: "   ",
            oka: "NINCS_FORRAS",
          },
        }),
      );
    });

    /** KONTROLL: enélkül egy táblába, amibe semmi nem írható, minden tiltás „működne". */
    it("accepts a refusal that names what is missing", async () => {
      const sheet = await makeSheet();

      const refusal = await prisma.productDatasheetFieldRefusal.create({
        data: {
          datasheetId: sheet.id,
          mezo: "TARTASA",
          indok: "sem könnyű, sem nehéz nem írható rá felelősséggel",
          oka: "DONTESRE_VAR",
        },
      });

      assert.equal(refusal.mezo, "TARTASA");
      assert.equal(refusal.oka, "DONTESRE_VAR");
    });

    /** Egy mezőt egyszer lehet megtagadni, nem többször. */
    it("refuses a second refusal for the same field", async () => {
      const sheet = await makeSheet();
      const data = {
        datasheetId: sheet.id,
        mezo: "KULLEME" as const,
        indok: "a források nem írják le",
        oka: "NINCS_FORRAS" as const,
      };

      await prisma.productDatasheetFieldRefusal.create({ data });
      await assert.rejects(
        prisma.productDatasheetFieldRefusal.create({ data }),
      );
    });

    /**
     * AZ ELLENTMONDÓ PÁR, VALÓDI TÁBLÁN.
     *
     * Ezt a séma NEM tudja megakadályozni: a `CHECK` nem hivatkozhat másik
     * táblára, és a mező neve itt adat. A sor tehát LÉTREHOZHATÓ - és épp ezért
     * kell egy audit, ami megtalálja.
     */
    it("lets a contradictory pair exist, and the audit finds it", async () => {
      const sheet = await makeSheet();

      await prisma.productDatasheet.update({
        where: { id: sheet.id },
        data: { tartasa: "Könnyű, kezdőknek is ajánlható" },
      });
      await prisma.productDatasheetFieldRefusal.create({
        data: {
          datasheetId: sheet.id,
          mezo: "TARTASA",
          indok: "fajszintű azonosítás nélkül nem eldönthető",
          oka: "NINCS_FORRAS",
        },
      });

      const rows = await prisma.productDatasheet.findMany({
        where: { id: sheet.id },
        include: { refusals: { select: { mezo: true } } },
      });

      const conflicts = findRefusalConflicts(rows);

      assert.equal(conflicts.length, 1);
      assert.equal(conflicts[0]!.datasheetId, sheet.id);
      assert.equal(conflicts[0]!.mezo, "TARTASA");
      assert.deepEqual(conflicts[0]!.kitoltottOszlopok, ["tartasa"]);
    });

    /** KONTROLL: a jól viselkedő adatlapon az audit NEM talál semmit. */
    it("finds nothing when the refused field is really empty", async () => {
      const sheet = await makeSheet();

      await prisma.productDatasheetFieldRefusal.create({
        data: {
          datasheetId: sheet.id,
          mezo: "ERDEKESSEG",
          indok: "nincs megerősített forrás",
          oka: "NINCS_FORRAS",
        },
      });

      const rows = await prisma.productDatasheet.findMany({
        where: { id: sheet.id },
        include: { refusals: { select: { mezo: true } } },
      });

      assert.deepEqual(findRefusalConflicts(rows), []);
    });
  },
);
