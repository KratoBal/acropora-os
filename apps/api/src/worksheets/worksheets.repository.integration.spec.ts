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
    let technicianUserId: string;
    let viewerUserId: string;
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

      // A felelős-kiosztáshoz két további kolléga kell: egy szerelő, aki
      // írhat munkalapot, és egy néző, aki csak látja. A kettő közötti
      // különbség az, amit a kiosztás szabálya őriz.
      const technician = await prisma.user.create({
        data: {
          email: `worksheets-technician-${suffix}@${TEST_EMAIL_DOMAIN}`,
          displayName: "Szerelő Sándor",
          nickname: "Szerelő Sanyi",
          role: "SERVICE",
          isActive: true,
        },
      });
      technicianUserId = technician.id;

      const viewer = await prisma.user.create({
        data: {
          email: `worksheets-viewer-${suffix}@${TEST_EMAIL_DOMAIN}`,
          displayName: "Néző Nóra",
          role: "VIEWER",
          isActive: true,
        },
      });
      viewerUserId = viewer.id;

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

    it("copies the sub-unit name onto the version and keeps it after a rename", async () => {
      const id = await createDraft(bioDepartmentId);
      await repository.close(id, actorUserId, new Date());

      const closed = await prisma.worksheetVersion.findFirstOrThrow({
        where: { worksheetId: id },
        orderBy: { version: "desc" },
        select: { unitName: true },
      });
      assert.equal(closed.unitName, "Biodóm");

      // Az alegység átnevezése nem írhatja át visszamenőleg azt, ami egy
      // lezárt lapon áll: a szám középső tagja és a lapon látható szöveg
      // ugyanabból a sorból jön, de a lezárt verzió a saját pillanatát őrzi.
      await prisma.worksheetDepartment.update({
        where: { id: bioDepartmentId },
        data: { name: "Biodóm II." },
      });
      try {
        const afterRename = await prisma.worksheetVersion.findFirstOrThrow({
          where: { worksheetId: id },
          orderBy: { version: "desc" },
          select: { unitName: true },
        });
        assert.equal(afterRename.unitName, "Biodóm");
      } finally {
        await prisma.worksheetDepartment.update({
          where: { id: bioDepartmentId },
          data: { name: "Biodóm" },
        });
      }
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

      // A lezárt verzió tartalma változatlan marad: az új verzió MELLÉ kerül,
      // nem a régi helyére. A lap itt lezárt, de még aláíratlan - aláírás után
      // ez az út már nem járható, arról a következő eset szól.
      assert.equal(first.status, "AWAITING_SIGNATURE");
      assert.equal(first.subject, "Kompresszorok bevizsgálása");
      assert.equal(first.lines[0]?.quantity.toString(), "2");
      assert.equal(first.signature, null);

      // Az új verzió aláíratlan piszkozat, kötelező indoklással.
      assert.equal(second.status, "DRAFT");
      assert.equal(second.signature, null);
      assert.equal(
        second.changeReason,
        "Az ügyfél kérte a mennyiség javítását.",
      );
      assert.equal(second.lines[0]?.quantity.toString(), "3");
    });

    /**
     * Az aláírt lap végleges: sem szerkesztéssel, sem új verzióval nem
     * módosítható. Korábban itt az állt, hogy egy aláírt lapból KÉSZÜLHET új
     * verzió - a kód azóta a mai szabályt valósítja meg, a teszt viszont a
     * régit írta le, és ezt a CI fogta meg, nem a helyi futás.
     *
     * A folytatás ÚJ munkalap, ami erre hivatkozik; azt a `continueFrom` fedi.
     */
    it("refuses a new version once the worksheet has been signed", async () => {
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
        content: content({ subject: "Javított tárgy" }),
        changeReason: "Elírás javítása.",
        actorUserId,
      });
      assert.deepEqual(amended, { ok: false, reason: "SIGNED" });

      // A visszautasítás nem hagyhat maga után nyomot: se új verzió, se
      // megbolygatott szám. Egy elutasítás, ami közben írt is, rosszabb, mint
      // ha átengedte volna.
      const versions = await prisma.worksheetVersion.findMany({
        where: { worksheetId: id },
        orderBy: { version: "asc" },
        select: { version: true, status: true },
      });
      assert.deepEqual(versions, [{ version: 1, status: "SIGNED" }]);
      assert.equal((await numberOf(id)).number, numberAfterClose);
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

    // A felelős a lap AZONOSSÁGÁHOZ tartozik, és a névsor újramentése nem
    // eseményt, hanem állapotot ír. Amit ez bizonyít: a már fent lévő
    // kolléga `assignedAt`-je nem íródik újra - ez az egyetlen jel arról, ki
    // került ÚJONNAN a lapra, és erre épül majd az értesítés.
    it("keeps the original assignment time when the list is saved again", async () => {
      const id = await createDraft(bioDepartmentId);

      await repository.setAssignees({
        worksheetId: id,
        userIds: [technicianUserId, viewerUserId],
        actorUserId,
      });
      const first = await prisma.worksheetAssignee.findUniqueOrThrow({
        where: {
          worksheetId_userId: { worksheetId: id, userId: technicianUserId },
        },
        select: { assignedAt: true, assignedById: true },
      });
      assert.equal(first.assignedById, actorUserId);

      await repository.setAssignees({
        worksheetId: id,
        userIds: [technicianUserId, actorUserId],
        actorUserId,
      });

      const rows = await prisma.worksheetAssignee.findMany({
        where: { worksheetId: id },
        orderBy: { userId: "asc" },
        select: { userId: true, assignedAt: true },
      });
      assert.deepEqual(
        rows.map((row) => row.userId).sort(),
        [actorUserId, technicianUserId].sort(),
      );

      const kept = rows.find((row) => row.userId === technicianUserId);
      assert.equal(kept?.assignedAt.getTime(), first.assignedAt.getTime());
    });

    it("takes everyone off the worksheet when the list arrives empty", async () => {
      const id = await createDraft(bioDepartmentId);
      await repository.setAssignees({
        worksheetId: id,
        userIds: [technicianUserId],
        actorUserId,
      });
      await repository.setAssignees({
        worksheetId: id,
        userIds: [],
        actorUserId,
      });

      const remaining = await prisma.worksheetAssignee.count({
        where: { worksheetId: id },
      });
      assert.equal(remaining, 0);
    });

    it("offers only colleagues whose role may edit the worksheet", async () => {
      const { items } = await repository.assignableUsers();
      const ids = new Set(items.map((item) => item.id));
      assert.ok(ids.has(technicianUserId));
      // A VIEWER látja a lapot, de nem ír rá, tehát felelősnek sem való.
      assert.equal(ids.has(viewerUserId), false);
    });

    it("lists the worksheets assigned to one person", async () => {
      const mine = await createDraft(bioDepartmentId);
      const other = await createDraft(bioDepartmentId);
      await repository.setAssignees({
        worksheetId: mine,
        userIds: [technicianUserId],
        actorUserId,
      });

      const response = await repository.list({
        page: 1,
        pageSize: 100,
        assigneeId: technicianUserId,
      });
      const ids = response.items.map((item) => item.id);
      assert.ok(ids.includes(mine));
      assert.equal(ids.includes(other), false);
      assert.deepEqual(
        response.items.find((item) => item.id === mine)?.assigneeNames,
        ["Szerelő Sanyi"],
      );
    });
  },
);
