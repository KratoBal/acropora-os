import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import type { WorksheetContentDto } from "./dto/worksheet.dto.js";
import { normalizeWorksheetContent } from "./worksheet-content.js";
import { worksheetYear } from "./worksheet-number.js";
import { WorksheetsRepository } from "./worksheets.repository.js";
import { toWorksheetDetail } from "./worksheets.types.js";

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
        // AZ ESZKÖZÖK A MUNKALAPOK UTÁN, DE A HELYSZÍNEK ÉS A VEVŐ ELŐTT: az
        // `Asset.customerId` és az `Asset.departmentId` is `Restrict`, tehát
        // egy bent maradt eszköz a vevő törlését állítaná meg, és a suite a
        // következő futáson a takarítatlan maradékon indulna.
        await prisma.asset.deleteMany({
          where: { customerId: { in: customerIds } },
        });
        // A HELYSZINEK FAT ALKOTNAK, ES A SZULORE `Restrict` all, tehat egy
        // egyetlen deleteMany a SORRENDTOL fuggoen elhasalhat: ha a szulo sora
        // elobb kerul sorra, mint a gyerekeje, a megkotes megallitja. Ezert
        // levelrol gyoker fele haladunk, amig fogy a fa.
        for (;;) {
          const removed = await prisma.worksheetDepartment.deleteMany({
            where: { customerId: { in: customerIds }, children: { none: {} } },
          });
          if (removed.count === 0) break;
        }
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

    /**
     * A HELYSZINEK FAT ALKOTNAK, es a fa ket szabalya ADATBAZIS-SZINTU:
     * mockkal egyik sem bizonyithato, mert mindketto index.
     *
     * Az elso a testver-szabaly. A masodik az, ami CSENDBEN elveszett volna a
     * fa bevezetesekor: a Postgresben a NULL nem egyenlo onmagaval, tehat a
     * (customerId, parentId, code) megkotes a LEGFELSO szinten nem er semmit
     * -- pont azon a szinten, ahol ma az OSSZES sor all. Ezt egy reszleges
     * egyedi index tartja meg (WHERE "parentId" IS NULL), amit a Prisma sema
     * nem tud kifejezni, ezert a migracioban all nyers SQL-kent.
     */
    describe("a helyszin-fa megkotesei", () => {
      it("refuses two roots with the same code under one partner", async () => {
        await repository.createDepartment(customerId, {
          code: "ROT",
          name: "Gyoker",
        });

        await assert.rejects(() =>
          repository.createDepartment(customerId, {
            code: "ROT",
            name: "Masik gyoker",
          }),
        );
      });

      it("refuses two siblings with the same code, and allows it under another branch", async () => {
        const left = await repository.createDepartment(customerId, {
          code: "LFT",
          name: "Bal ag",
        });
        const right = await repository.createDepartment(customerId, {
          code: "RGT",
          name: "Jobb ag",
        });

        await repository.createDepartment(customerId, {
          parentId: left.id,
          code: "MED",
          name: "Medence",
        });

        // Ugyanaz a kod, ugyanaz a szulo: nem mehet.
        await assert.rejects(() =>
          repository.createDepartment(customerId, {
            parentId: left.id,
            code: "MED",
            name: "Masik medence",
          }),
        );

        // Ugyanaz a kod, MASIK ag alatt: mehet, es ez a fa lenyege.
        const other = await repository.createDepartment(customerId, {
          parentId: right.id,
          code: "MED",
          name: "Medence a masik agon",
        });
        assert.equal(other.parentId, right.id);
      });

      /**
       * A SZULO TULAJDONOSA. Az idegen kulcs csak azt nezi, hogy a sor
       * letezik-e; hogy KIE, azt nem. Egy masik partner helyszine ala
       * akasztott alegyseg a munkalapszamot vinne rossz helyre, es a
       * feluleten nem is latszana, mert az a sajat fajat mutatja.
       */
      it("refuses a parent that belongs to another partner", async () => {
        const stranger = await prisma.customer.create({
          data: {
            customerNumber: `${TEST_CUSTOMER_PREFIX}STRANGER-${suffix}`,
            type: "COMPANY",
            displayName: "Idegen partner",
          },
          select: { id: true },
        });
        const strangerRoot = await repository.createDepartment(stranger.id, {
          code: "STR",
          name: "Idegen helyszin",
        });

        await assert.rejects(
          () =>
            repository.createDepartment(customerId, {
              parentId: strangerRoot.id,
              code: "SUB",
              name: "Alegyseg",
            }),
          /WORKSHEET_DEPARTMENT_PARENT_NOT_FOUND/,
        );
      });
    });

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

      // A SORSZÁM MÁR NEM ABSZOLÚT. A számláló évenként EGY, az egész cégre,
      // tehát nem indul újra minden futásnál: az alak mérhető, a konkrét
      // érték nem. Egy `-001`-re kötött állítás a MÁSODIK futáson bukna el,
      // és nem a kód miatt.
      assert.match(row.number ?? "", new RegExp(`^BIO-${year}-\\d{3,}$`));
      assert.ok((row.sequence ?? 0) >= 1);

      const version = await prisma.worksheetVersion.findFirstOrThrow({
        where: { worksheetId: id },
        orderBy: { version: "desc" },
      });
      assert.equal(version.status, "AWAITING_SIGNATURE");
      assert.notEqual(version.closedAt, null);
    });

    it("does not spend a sequence number on a draft that is never closed", async () => {
      // A HIÁNYTALANSÁG ÁLLÍTÁSA RELATÍV, nem abszolút: az eldobott piszkozat
      // nem használhat el sorszámot, tehát a KÖVETKEZŐ lezárás pontosan
      // EGGYEL nagyobb számot kap az előzőnél. Ez akkor is igaz, ha a
      // sorozat egy korábbi futásból már előrébb jár.
      const before = await createDraft(bioDepartmentId);
      await repository.close(before, actorUserId, new Date());
      const previous = (await numberOf(before)).sequence ?? 0;

      const abandoned = await createDraft(bioDepartmentId);
      const closed = await createDraft(bioDepartmentId);
      await repository.close(closed, actorUserId, new Date());

      assert.equal((await numberOf(abandoned)).number, null);
      assert.equal((await numberOf(closed)).sequence, previous + 1);
    });

    /**
     * EZ AZ ÁLLÍTÁS ÚJRA LETT FOGALMAZVA, NEM JAVÍTVA (2026-08-27).
     *
     * Korábban azt mérte, hogy a számláló partner/részleg/év hármasonként
     * KÜLÖN fut. Az a szerkezet megszűnt: a szám nem hordozza a partner
     * rövidítését, tehát az egyediségét a SOROZAT adja, és egy számláló fut
     * évenként, az egész cégre. A régi állítás tehát nem hibás lett, hanem
     * TÁRGYTALAN -- egy megváltozott szabály alatt "javítva" a RÉGI szabályt
     * fagyasztotta volna vissza.
     *
     * Amit helyette mér, és ami az új szerkezetben a lényeg: két KÜLÖNBÖZŐ
     * egység lapja NEM kap azonos sorszámot. Ez az a hiba, ami a partneres
     * számlálóval a lezáráskor jelentkezett volna, a felhasználó előtt.
     */
    it("runs ONE counter for the whole year, across units", async () => {
      const first = await createDraft(ppuDepartmentId);
      await repository.close(first, actorUserId, new Date());
      const second = await createDraft(bioDepartmentId);
      await repository.close(second, actorUserId, new Date());

      const firstNumber = (await numberOf(first)).number;
      const secondNumber = (await numberOf(second)).number;

      // Más egység, más sorszám -- a sorozat közös.
      assert.match(firstNumber ?? "", new RegExp(`^PPU-${year}-\\d{3,}$`));
      assert.match(secondNumber ?? "", new RegExp(`^BIO-${year}-\\d{3,}$`));

      const sequenceOf = (value: string | null) =>
        Number(value?.split("-").at(-1));
      assert.notEqual(sequenceOf(firstNumber), sequenceOf(secondNumber));
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
      // lezárt lapon áll: a szám első tagja és a lapon látható szöveg
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

    /**
     * AZ ÁLLAPOT A LEGUTOLSÓ VERZIÓÉ, ÉS EZT CSAK ADATBÁZISON LEHET BIZONYÍTANI.
     *
     * A lap három verziót jár be: piszkozat, majd lezárás után aláírásra váró,
     * majd egy javított piszkozat. A kézenfekvő Prisma-feltétel
     * (`versions: { some: { status } }`) MINDHÁROM állapotra hozná ezt az egy
     * lapot, hiszen mindegyik előfordult a történetében. A szűrő attól helyes,
     * hogy csak a LEGUTOLSÓ számít.
     */
    it("filters on the status of the latest version, not on any earlier one", async () => {
      const id = await createDraft(bioDepartmentId);
      await repository.close(id, actorUserId, new Date());

      // A lap most aláírásra vár. Piszkozatra NEM szabad feljönnie, pedig az
      // első verziója az volt.
      const awaiting = await repository.list({
        page: 1,
        pageSize: 100,
        status: "AWAITING_SIGNATURE",
      });
      assert.equal(
        awaiting.items.some((item) => item.id === id),
        true,
      );

      const draftsWhileAwaiting = await repository.list({
        page: 1,
        pageSize: 100,
        status: "DRAFT",
      });
      assert.equal(
        draftsWhileAwaiting.items.some((item) => item.id === id),
        false,
        "a korábbi piszkozat-verzió nem hozhatja fel a lapot",
      );

      // Javítás után a legutolsó verzió megint piszkozat: a lap átkerül.
      await repository.amend({
        worksheetId: id,
        content: content({ subject: "Javított tárgy" }),
        changeReason: "Az ügyfél kérte a javítást.",
        actorUserId,
      });

      const draftsAfterAmend = await repository.list({
        page: 1,
        pageSize: 100,
        status: "DRAFT",
      });
      assert.equal(
        draftsAfterAmend.items.some((item) => item.id === id),
        true,
      );

      const awaitingAfterAmend = await repository.list({
        page: 1,
        pageSize: 100,
        status: "AWAITING_SIGNATURE",
      });
      assert.equal(
        awaitingAfterAmend.items.some((item) => item.id === id),
        false,
        "a lezárt korábbi verzió nem tarthatja bent a lapot",
      );
    });

    /**
     * A DARABSZÁM UGYANABBÓL A FELTÉTELBŐL SZÁRMAZZON, mint a sorok. Egy szűrő,
     * ami a sorokat jól válogatja, de a darabszámot a szűretlen halmazból adja,
     * ugyanaz a néma hiba a másik végén: a lapozó több oldalt ígérne, mint
     * amennyi van, és az utolsó oldal üresen jönne vissza.
     */
    it("counts what it lists", async () => {
      const drafts = await repository.list({
        page: 1,
        pageSize: 100,
        status: "DRAFT",
      });

      assert.equal(drafts.pagination.totalItems, drafts.items.length);
      assert.equal(drafts.pagination.totalPages, 1);
    });

    /**
     * AZ ÜGYFÉL SAJÁT KÓDJA ÉLŐ HIVATKOZÁS, ÉS EZT CSAK ADATBÁZISON LEHET
     * BIZONYÍTANI.
     *
     * Balázs döntése (2026-08-27): a kód a funkciót azonosítja, nem a darabot,
     * tehát nem változik -- ezért nem másoljuk a sorra, hanem olvasáskor
     * hivatkozunk rá. A döntésnek van egy következménye, ami csak akkor
     * derülne ki, amikor először megtörténik: ha valaki JAVÍT egy elgépelt
     * kódot, a javítás a MÁR ALÁÍRT lapon is megjelenik. Ez a teszt épp azt
     * rögzíti, mert ha egyszer valaki pillanatképre váltana, itt kell
     * elbuknia, nem élesben.
     *
     * A lap szándékosan aláírt állapotban van: az aláírt lap a legerősebb
     * eset, mert azt egyébként semmi nem írhatja át.
     */
    it("reads the customer's own code from the asset, even on a signed sheet", async () => {
      const asset = await prisma.asset.create({
        data: {
          customerId,
          assetNumber: `ESZK-WS-INT-${suffix}`,
          name: "Cápasuli kompresszor",
          inventoryNumber: "LT-4711",
        },
      });

      const worksheetId = await repository.createDraft({
        customerId,
        departmentId: bioDepartmentId,
        content: content({
          lines: [
            {
              description: "Kompresszor bevizsgálás",
              assetId: asset.id,
              quantity: 2,
              unit: "óra",
              unitNet: 15000,
              vatRatePercent: 27,
            },
          ],
        } as Partial<WorksheetContentDto>),
        actorUserId,
      });
      await repository.close(worksheetId, actorUserId, new Date());
      const signed = await repository.sign({
        worksheetId,
        decision: "ACCEPTED",
        signerName: "Gondnok Gábor",
        note: null,
        actorUserId,
        now: new Date(),
      });
      assert.equal(signed.ok, true);

      const beforeRow = await repository.detail(worksheetId);
      assert.ok(beforeRow);
      const before = toWorksheetDetail(beforeRow);
      assert.equal(before.currentVersion.status, "SIGNED");
      assert.equal(before.currentVersion.lines[0]?.inventoryNumber, "LT-4711");

      // A JAVÍTÁS AZ ESZKÖZÖN TÖRTÉNIK, a lapot senki nem nyitja meg.
      await prisma.asset.update({
        where: { id: asset.id },
        data: { inventoryNumber: "LT-4712" },
      });

      const afterRow = await repository.detail(worksheetId);
      assert.ok(afterRow);
      const after = toWorksheetDetail(afterRow);
      assert.equal(
        after.currentVersion.lines[0]?.inventoryNumber,
        "LT-4712",
        "élő hivatkozás: a javított kód az aláírt lapon is meglátszik",
      );

      // ÉS AMI NEM MOZDUL: az eszközszám és az alegység neve. Az előbbi azért,
      // mert sosem változik, az utóbbi azért, mert MÁSOLAT a verzió saját
      // oszlopában. A kettő különbsége a mező változékonysága, nem a lap
      // állapota, és ez a sor azt a határvonalat őrzi.
      assert.equal(
        after.currentVersion.lines[0]?.assetNumber,
        before.currentVersion.lines[0]?.assetNumber,
      );
      assert.equal(
        after.currentVersion.unitName,
        before.currentVersion.unitName,
      );
    });
  },
);
