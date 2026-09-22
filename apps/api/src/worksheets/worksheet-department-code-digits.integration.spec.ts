import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";

/**
 * A SZAMJEGYES KOD AZ ADATBAZISIG ELJUT.
 *
 * A szabaly KET helyen all: a `WORKSHEET_DEPARTMENT_CODE_PATTERN` mintaban es
 * a `WorksheetDepartment_code_check` megkotesben. A unit tesztek az elsot
 * merik -- a masodikat SEMMI nem meri, pedig ha a migracio kimarad, a felulet
 * elfogadja a "12" kodot, es a mentes az adatbazison hasal el. Pontosan az a
 * hiba, ami a felhasznalonal jelentkezik eloszor, nalunk zold mellett.
 *
 * A KONTROLLOK A LENYEG: egy HAROM karakteres, de ervenytelen kod ("A-1",
 * "bio") tovabbra is BUKIK. Enelkul ez a spec zold lenne akkor is, ha a
 * migracio a megkotest nem tagitja, hanem ELDOBJA.
 */

const gate = integrationDatabaseGate(process.env);
const PREFIX = "ITDEPTCODE";

let ugyfelId = "";

async function takarit() {
  await prisma.worksheetDepartment.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

async function felvisz(kod: string) {
  await prisma.worksheetDepartment.create({
    data: { customerId: ugyfelId, code: kod, name: `Teszt ${kod}` },
    select: { id: true },
  });
}

describe(
  "a helyszín kódja az adatbázisban",
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
    });

    after(takarit);

    it("elfogad betűt, számot és a kettő keverékét", async () => {
      for (const kod of ["BIO", "A1", "12", "1A2"]) await felvisz(kod);

      const sorok = await prisma.worksheetDepartment.findMany({
        where: { customerId: ugyfelId },
        select: { code: true },
      });

      assert.deepEqual(sorok.map((sor) => sor.code).sort(), [
        "12",
        "1A2",
        "A1",
        "BIO",
      ]);
    });

    /**
     * KONTROLL: MAGA A CHECK MEGMARADT.
     *
     * ES A KONTROLL ALAKJA ITT NEM MINDEGY. Az elso valtozatom egy NEGY
     * karakteres kodot ("ABCD") probalt felvinni -- az viszont a `VarChar(3)`
     * HOSSZAN hasal el, nem a megkotesen, tehat akkor is elutasitas jonne, ha
     * a migracio a CHECK-et ELDOBTA volna. Egy kontroll, ami mas okbol bukik,
     * mint amit bizonyitani akar, nem kontroll.
     *
     * Ezert mind a ketto HAROM karakteres: a hosszba belefernek, es kizarolag
     * a CHECK utasithatja el oket.
     */
    it("KONTROLL: a kötőjeles kódot az adatbázis elutasítja (3 karakter, a hossz belefér)", async () => {
      await assert.rejects(() => felvisz("A-1"));
    });

    it("KONTROLL: a kisbetűs kódot az adatbázis elutasítja (3 karakter, a hossz belefér)", async () => {
      await assert.rejects(() => felvisz("bio"));
    });

    /**
     * ES A HOSSZ IS ALL, kulon allitaskent -- Balazs a hosszt nem kerte, es a
     * `code` oszlop valtozatlanul `VarChar(3)`.
     */
    it("a hossz változatlanul három karakter", async () => {
      await assert.rejects(() => felvisz("ABCD"));
      await assert.rejects(() => felvisz("1234"));
    });
  },
);
