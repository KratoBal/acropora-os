import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import type { WorksheetContentDto } from "./dto/worksheet.dto.js";
import { normalizeWorksheetContent } from "./worksheet-content.js";
import { worksheetYear } from "./worksheet-number.js";
import { WorksheetsRepository } from "./worksheets.repository.js";

// A számozás két ígérete adatbázis-szintű, és mockkal nem bizonyítható:
// (1) a sorszám a LEZÁRÁSKOR keletkezik, tehát az eldobott piszkozat nem
// lyukasztja ki a sorozatot; (2) a számláló partner + részleg + év
// hármasonként külön fut. Ugyanez áll a verziózásra: a lezárt verziónak
// akkor is változatlanul kell maradnia, amikor egy újabb verzió készül.
//
// A suite sorokat hoz létre és töröl, ezért csak tesztelésre megnevezett
// adatbázison fut; lásd integrationDatabaseGate.
const gate = integrationDatabaseGate(process.env);

const TEST_EMAIL_DOMAIN = "worksheets-integration.invalid";
const TEST_CUSTOMER_PREFIX = "WS-INT-";

describe(
  "WorksheetsRepository integration",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const partnerCode = `T${suffix.toString().padStart(6, "0")}`;
    const repository = new WorksheetsRepository();
    const year = worksheetYear(new Date());

    let actorUserId: string;
    let customerId: string;
    let bioDepartmentId: string;
    let ppuDepartmentId: string;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      const user = await prisma.user.create({
        data: {
          email: `worksheets-${suffix}@${TEST_EMAIL_DOMAIN}`,
          displayName: "Worksheets Integration Actor",
          role: "OWNER",
          isActive: true,
        },
      });
      actorUserId = user.id;

      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${TEST_CUSTOMER_PREFIX}${suffix}`,
          type: "COMPANY",
          displayName: "Worksheets Integration Partner",
          worksheetPartnerCode: partnerCode,
        },
      });
      customerId = customer.id;

      const bio = await repository.createDepartment(customerId, {
        code: "BIO",
        name: "Biodóm",
      });
      const ppu = await repository.createDepartment(customerId, {
        code: "PPU",
        name: "PP Üzemeltetés",
      });
      bioDepartmentId = bio.id;
      ppuDepartmentId = ppu.id;
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
    });

    async function removeLeftovers() {
      const customers = await prisma.customer.findMany({
        where: { customerNumber: { startsWith: TEST_CUSTOMER_PREFIX } },
        select: { id: true, worksheetPartnerCode: true },
      });
      const customerIds = customers.map((customer) => customer.id);
      if (customerIds.length > 0) {
        // A számláló-sorokat a teszt-vevők SAJÁT partner-kódja alapján
        // töröljük, nem előtag-találattal: egy `startsWith` idegen sorozatot
        // is eltalálhatna, és egy számláló visszaállítása duplikált
        // munkalapszámot okozna.
        const codes = customers
          .map((customer) => customer.worksheetPartnerCode)
          .filter((code): code is string => Boolean(code));
        if (codes.length > 0) {
          await prisma.worksheetNumberSequence.deleteMany({
            where: { partnerCode: { in: codes } },
          });
        }
        await prisma.worksheet.deleteMany({
          where: { customerId: { in: customerIds } },
        });
        await prisma.worksheetDepartment.deleteMany({
          where: { customerId: { in: customerIds } },
        });
        await prisma.customer.deleteMany({
          where: { id: { in: customerIds } },
        });
      }
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });
    }

    function content(overrides: Partial<WorksheetContentDto> = {}) {
      return normalizeWorksheetContent({
        subject: "Kompresszorok bevizsgálása",
        lines: [
          {
            description: "Kompresszor bevizsgálás",
            quantity: 2,
            unit: "óra",
            unitNet: 15000,
            vatRatePercent: 27,
          },
        ],
        ...overrides,
      } as WorksheetContentDto);
    }

    async function createDraft(departmentId: string) {
      return repository.createDraft({
        customerId,
        departmentId,
        content: content(),
        actorUserId,
      });
    }

    async function numberOf(worksheetId: string) {
      const row = await prisma.worksheet.findUniqueOrThrow({
        where: { id: worksheetId },
        select: { number: true, numberYear: true, sequence: true },
      });
      return row;
    }

    it("leaves a draft without a number", async () => {
      const id = await createDraft(bioDepartmentId);
      const row = await numberOf(id);
      assert.equal(row.number, null);
      assert.equal(row.numberYear, null);
      assert.equal(row.sequence, null);
    });

    it("allocates the number at closing time, in the agreed shape", async () => {
      const id = await createDraft(bioDepartmentId);
      const result = await repository.close(id, actorUserId, new Date());
      assert.deepEqual(result, { ok: true });

      const row = await numberOf(id);
      assert.equal(row.number, `${partnerCode}-BIO-${year}-001`);
      assert.equal(row.sequence, 1);

      const version = await prisma.worksheetVersion.findFirstOrThrow({
        where: { worksheetId: id },
        orderBy: { version: "desc" },
      });
      assert.equal(version.status, "AWAITING_SIGNATURE");
      assert.notEqual(version.closedAt, null);
    });

    it("does not spend a sequence number on a draft that is never closed", async () => {
      // A korábbi teszt piszkozata (szám nélkül) nem foglalhatta le a 002-t.
      const abandoned = await createDraft(bioDepartmentId);
      const closed = await createDraft(bioDepartmentId);
      await repository.close(closed, actorUserId, new Date());

      assert.equal((await numberOf(abandoned)).number, null);
      assert.equal(
        (await numberOf(closed)).number,
        `${partnerCode}-BIO-${year}-002`,
      );
    });

    it("runs a separate counter per partner, department and year", async () => {
      const id = await createDraft(ppuDepartmentId);
      await repository.close(id, actorUserId, new Date());
      assert.equal(
        (await numberOf(id)).number,
        `${partnerCode}-PPU-${year}-001`,
      );
    });

    it("refuses to close a partner that has no abbreviation", async () => {
      const otherCustomer = await prisma.customer.create({
        data: {
          customerNumber: `${TEST_CUSTOMER_PREFIX}${suffix}-nocode`,
          type: "COMPANY",
          displayName: "Worksheets Integration Partner Without Code",
        },
      });
      const department = await repository.createDepartment(otherCustomer.id, {
        code: "BIO",
        name: "Biodóm",
      });
      const id = await repository.createDraft({
        customerId: otherCustomer.id,
        departmentId: department.id,
        content: content(),
        actorUserId,
      });

      const result = await repository.close(id, actorUserId, new Date());
      assert.deepEqual(result, { ok: false, reason: "PARTNER_CODE_MISSING" });
      assert.equal((await numberOf(id)).number, null);
    });

    it("refuses to close a worksheet without lines", async () => {
      const id = await repository.createDraft({
        customerId,
        departmentId: bioDepartmentId,
        content: content({ lines: [] }),
        actorUserId,
      });
      const result = await repository.close(id, actorUserId, new Date());
      assert.deepEqual(result, { ok: false, reason: "NO_LINES" });
    });

    it("closes a worksheet exactly once", async () => {
      const id = await createDraft(bioDepartmentId);
      assert.deepEqual(await repository.close(id, actorUserId, new Date()), {
        ok: true,
      });
      assert.deepEqual(await repository.close(id, actorUserId, new Date()), {
        ok: false,
        reason: "NOT_DRAFT",
      });
    });

    it("keeps the closed version and the number intact when a new version is made", async () => {
      const id = await createDraft(bioDepartmentId);
      await repository.close(id, actorUserId, new Date());
      const numberAfterClose = (await numberOf(id)).number;

      await repository.sign({
        worksheetId: id,
        decision: "ACCEPTED",
        signerName: "Kovács Béla",
        note: null,
        actorUserId,
        now: new Date(),
      });

      const amended = await repository.amend({
        worksheetId: id,
        content: content({
          subject: "Kompresszorok bevizsgálása (javított)",
          lines: [
            {
              description: "Kompresszor bevizsgálás",
              quantity: 3,
              unit: "óra",
              unitNet: 15000,
              vatRatePercent: 27,
            },
          ],
        }),
        changeReason: "Az ügyfél kérte a mennyiség javítását.",
        actorUserId,
      });
      assert.deepEqual(amended, { ok: true, version: 2 });

      // A szám nem változik, a verzió külön tag.
      assert.equal((await numberOf(id)).number, numberAfterClose);

      const versions = await prisma.worksheetVersion.findMany({
        where: { worksheetId: id },
        orderBy: { version: "asc" },
        include: { lines: true, signature: true },
      });
      assert.equal(versions.length, 2);

      const first = versions[0]!;
      const second = versions[1]!;

      // Az első verzió tartalma és aláírása változatlan: az aláírás ahhoz a
      // szöveghez tartozik, amit aláírtak.
      assert.equal(first.status, "SIGNED");
      assert.equal(first.subject, "Kompresszorok bevizsgálása");
      assert.equal(first.lines[0]?.quantity.toString(), "2");
      assert.equal(first.signature?.signerName, "Kovács Béla");

      // Az új verzió aláíratlan piszkozat, kötelező indoklással.
      assert.equal(second.status, "DRAFT");
      assert.equal(second.signature, null);
      assert.equal(
        second.changeReason,
        "Az ügyfél kérte a mennyiség javítását.",
      );
      assert.equal(second.lines[0]?.quantity.toString(), "3");
    });

    it("puts a re-closed version back into awaiting signature, not into signed", async () => {
      const id = await createDraft(bioDepartmentId);
      await repository.close(id, actorUserId, new Date());
      await repository.sign({
        worksheetId: id,
        decision: "ACCEPTED",
        signerName: "Kovács Béla",
        note: null,
        actorUserId,
        now: new Date(),
      });
      await repository.amend({
        worksheetId: id,
        content: content({ subject: "Javított tárgy" }),
        changeReason: "Elírás javítása.",
        actorUserId,
      });
      await repository.close(id, actorUserId, new Date());

      const versions = await prisma.worksheetVersion.findMany({
        where: { worksheetId: id },
        orderBy: { version: "asc" },
        select: { version: true, status: true },
      });
      assert.deepEqual(versions, [
        { version: 1, status: "SIGNED" },
        { version: 2, status: "AWAITING_SIGNATURE" },
      ]);
    });

    it("refuses a new version while the worksheet is still a draft", async () => {
      const id = await createDraft(bioDepartmentId);
      const result = await repository.amend({
        worksheetId: id,
        content: content(),
        changeReason: "Nincs mit módosítani, a lap még piszkozat.",
        actorUserId,
      });
      assert.deepEqual(result, { ok: false, reason: "NOT_CLOSED" });
    });

    it("refuses an empty change reason at the database level", async () => {
      const id = await createDraft(bioDepartmentId);
      await repository.close(id, actorUserId, new Date());
      await assert.rejects(
        prisma.worksheetVersion.create({
          data: {
            worksheetId: id,
            version: 2,
            status: "DRAFT",
            subject: "Indoklás nélküli verzió",
            changeReason: "   ",
          },
        }),
      );

      // A lényeg nem az, hogy hibát kaptunk, hanem hogy a sor nem ment be:
      // az indoklás nélküli verzió az adatbázisban sem létezhet.
      const versionCount = await prisma.worksheetVersion.count({
        where: { worksheetId: id },
      });
      assert.equal(versionCount, 1);
    });
  },
);
