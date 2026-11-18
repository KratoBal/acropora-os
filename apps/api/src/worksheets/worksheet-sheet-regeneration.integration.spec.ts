import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";

import { WorksheetsRepository } from "./worksheets.repository.js";

/**
 * A KIADOTT PDF ÚJRAGENERÁLÁSA, ADATBÁZISON (acrobot 56321, kártya 47e07a53).
 *
 * A DÖNTÉSI részt (`sheetToRegenerate`, az archív sor alakja) a `worksheet-sheet-regeneration.spec` méri. Ami csak adatbázissal mérhető: az archív sor és a csere EGY tranzakcióban, a
 * régi bájtok bitre azonos megőrzése, az, hogy a sor azonosítója/verziója/ideje a cserével nem változik, és az idempotencia (a második kattintás nem ír újabb archívumot).
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "REGEN-INT-";
const REGI_IDO = new Date("2026-09-20T10:00:00.000Z");
const REGI_BAJT = Buffer.from("%PDF-1.4 regi elrendezes");
const REGI_SHA = "a".repeat(64);

describe(
  "Kiadott munkalap újragenerálása",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    const repository = new WorksheetsRepository();
    let customerId = "";
    let departmentId = "";
    let sorszam = 0;

    async function lap(
      nev: string,
      status: "DRAFT" | "AWAITING_SIGNATURE" | "SIGNED",
      sorok: ("GENERATED_SHEET" | "SIGNED_SHEET")[],
    ) {
      sorszam += 1;
      const ws = await prisma.worksheet.create({
        data: {
          customerId,
          departmentId,
          number: `${PREFIX}${nev}-${suffix}`,
          numberYear: 2026,
          sequence: sorszam,
          versions: {
            create: {
              version: 1,
              subject: `${PREFIX}${nev}`,
              status,
              issueDate:
                status === "DRAFT"
                  ? null
                  : new Date("2026-09-20T00:00:00.000Z"),
              closedAt: status === "DRAFT" ? null : REGI_IDO,
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
      const versionId = ws.versions[0]!.id;
      for (const type of sorok)
        await prisma.worksheetDocument.create({
          data: {
            worksheetId: ws.id,
            worksheetVersionId: versionId,
            type,
            fileName: `${PREFIX}${nev}-${type}.pdf`,
            contentType: "application/pdf",
            sizeBytes: REGI_BAJT.length,
            sha256: REGI_SHA,
            content: Uint8Array.from(REGI_BAJT),
            createdAt: REGI_IDO,
          },
        });
      return { worksheetId: ws.id, versionId };
    }

    const sor = (worksheetId: string, versionId: string, type: string) =>
      prisma.worksheetDocument.findFirstOrThrow({
        where: {
          worksheetId,
          worksheetVersionId: versionId,
          type: type as "GENERATED_SHEET",
        },
      });
    const archivak = (worksheetId: string) =>
      prisma.worksheetDocument.findMany({
        where: { worksheetId, type: "OTHER", worksheetVersionId: null },
      });

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await takarit();
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}${suffix}`,
          type: "COMPANY",
          displayName: `Újragenerálás teszt ${suffix}`,
        },
      });
      customerId = customer.id;
      departmentId = (
        await prisma.worksheetDepartment.create({
          data: { customerId, code: "RGN", name: "Újragenerálás" },
        })
      ).id;
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
      ]);
    });

    it("az aláírásra váró lap lezáráskori sora új bájtokat kap, a régi archívba kerül, bitre azonosan", async () => {
      const { worksheetId, versionId } = await lap("A", "AWAITING_SIGNATURE", [
        "GENERATED_SHEET",
      ]);
      const elotte = await sor(worksheetId, versionId, "GENERATED_SHEET");

      const result = await repository.regenerateIssuedSheet(worksheetId, {
        actorName: "Teszt Elek",
        at: "2026-11-18 20:40",
      });
      assert.deepEqual(result, { ok: true, changed: true });

      const utana = await sor(worksheetId, versionId, "GENERATED_SHEET");
      assert.equal(utana.id, elotte.id, "ugyanaz a sor marad");
      assert.equal(utana.createdAt.getTime(), REGI_IDO.getTime());
      assert.notEqual(utana.sha256, REGI_SHA);
      assert.equal(utana.content?.subarray(0, 5).toString(), "%PDF-");

      const [archiv, ...tobb] = await archivak(worksheetId);
      assert.equal(tobb.length, 0, "egy archív példány");
      assert.ok(archiv);
      assert.equal(archiv.sha256, REGI_SHA);
      assert.deepEqual(Buffer.from(archiv.content!), REGI_BAJT);
      assert.equal(archiv.createdAt.getTime(), REGI_IDO.getTime());
      assert.match(archiv.caption ?? "", /korábbi elrendezés/);
      assert.match(archiv.caption ?? "", /2026-11-18 20:40/);
      assert.match(archiv.caption ?? "", /Teszt Elek/);
    });

    it("a második kattintás nem ír újabb archívumot (azonos bájt, azonos hash)", async () => {
      const { worksheetId, versionId } = await lap("B", "AWAITING_SIGNATURE", [
        "GENERATED_SHEET",
      ]);
      const input = { actorName: "Teszt Elek", at: "2026-11-18 20:41" };
      assert.deepEqual(
        await repository.regenerateIssuedSheet(worksheetId, input),
        {
          ok: true,
          changed: true,
        },
      );
      const elso = await sor(worksheetId, versionId, "GENERATED_SHEET");

      assert.deepEqual(
        await repository.regenerateIssuedSheet(worksheetId, input),
        {
          ok: true,
          changed: false,
        },
      );
      const masodik = await sor(worksheetId, versionId, "GENERATED_SHEET");
      assert.equal(masodik.sha256, elso.sha256);
      assert.equal((await archivak(worksheetId)).length, 1);
    });

    it("piszkozat lapra nem ír semmit", async () => {
      const { worksheetId } = await lap("C", "DRAFT", []);
      assert.deepEqual(
        await repository.regenerateIssuedSheet(worksheetId, {
          actorName: "Teszt Elek",
          at: "2026-11-18 20:42",
        }),
        { ok: false, reason: "NOT_CLOSED" },
      );
      assert.equal((await archivak(worksheetId)).length, 0);
    });

    it("aláírt lapnál a VÉGLEGES sort írja át, a lezáráskori érintetlen marad", async () => {
      const { worksheetId, versionId } = await lap("D", "SIGNED", [
        "GENERATED_SHEET",
        "SIGNED_SHEET",
      ]);
      const result = await repository.regenerateIssuedSheet(worksheetId, {
        actorName: "Teszt Elek",
        at: "2026-11-18 20:43",
      });
      assert.deepEqual(result, { ok: true, changed: true });
      assert.equal(
        (await sor(worksheetId, versionId, "GENERATED_SHEET")).sha256,
        REGI_SHA,
        "a lezáráskori sor nem változik",
      );
      assert.notEqual(
        (await sor(worksheetId, versionId, "SIGNED_SHEET")).sha256,
        REGI_SHA,
      );
    });

    it("aláírt lap végleges sor nélkül kimondott hiba, és a lezáráskori sor nem változik", async () => {
      const { worksheetId, versionId } = await lap("E", "SIGNED", [
        "GENERATED_SHEET",
      ]);
      assert.deepEqual(
        await repository.regenerateIssuedSheet(worksheetId, {
          actorName: "Teszt Elek",
          at: "2026-11-18 20:44",
        }),
        { ok: false, reason: "SIGNED_SHEET_MISSING" },
      );
      assert.equal(
        (await sor(worksheetId, versionId, "GENERATED_SHEET")).sha256,
        REGI_SHA,
      );
      assert.equal((await archivak(worksheetId)).length, 0);
    });

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
