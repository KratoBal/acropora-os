import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import type { WorksheetContentDto } from "./dto/worksheet.dto.js";
import { normalizeWorksheetContent } from "./worksheet-content.js";
import { worksheetYear } from "./worksheet-number.js";
import { FIRST_LINE_STEP_NOTE } from "./first-line-ticket-step.js";
import { lastServiceJobNumber } from "../service-jobs/service-job-last-number.js";
import {
  nextServiceJobNumber,
  serviceJobNumberPrefix,
} from "../service-jobs/service-job-number.js";
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

/**
 * A SUITE SAJAT HIBAJEGYEINEK ELOTAGJA.
 *
 * NEVET KAPOTT, MERT KET HELYEN KELL: a letrehozasban es a takaritasban. Ket
 * helyen allo szoveg-literal eloszor egyezik, aztan az egyiket valaki
 * atirja -- es a takaritas NEM hibazna tole, csak nem talalna semmit.
 */
const TEST_JOB_PREFIX = "HJ-WS-INT-";

/** Ugyanezert kap nevet a suite sajat eszkozeinek elotagja is. */
const TEST_ASSET_PREFIX = "ESZK-WS-INT-";

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
      await assertNoLeftovers();
    });

    /**
     * ES A TAKARITAS EREDMENYET MEG IS MERJUK -- mert a `deleteMany` nulla
     * sorra is sikeres, es a `removeLeftovers` TELJES belso blokkja kimarad,
     * ha a vevo-lekerdezes nem talal semmit. Az a kihagyas csendes: a hibajegy-
     * es az eszkoz-torles vele egyutt marad el.
     *
     * AZ ESZKOZOKET SAJAT ELOTAG SZAMOLJA, nem a vevo azonositoja: a takaritas
     * `customerId` szerint torol, tehat ugyanarra szamolni a sajat bemenetet
     * ismetelne. A hibajegyeknel es a felhasznaloknal ilyen masodik tengely
     * nincs (a gazdatlan jegyet mar semmi nem koti ide), ott tehat ez a
     * szamlalo a KIMARADT torlest fogja meg, nem az elirt elotagot -- es ezt
     * jobb kimondani, mint tobbet allitani rola.
     *
     * AMI SZANDEKOSAN BENT MARAD, ES NEM SZIVARGAS: a
     * `WorksheetYearSequence` egyetlen sora. Az evenkenti munkalap-szamozas
     * foglaloja, nem adatsor -- egy suite, ami torli, nem takarit, hanem
     * visszaallitja a szamozast mindenki masnak. A CI sor-pillanatkepeiben
     * ezert all rajta tartosan `plusz 1`, es ez VART: a sor-darabszam
     * kulonbsege nem azonos a szemettel. (A partner-kodhoz kotott
     * `WorksheetNumberSequence` MAS: azt a takaritas a sajat kodjaira szurve
     * elviszi, mert az a suite sajat sorozata.)
     *
     * ES AHOL KERESNI KELL, HA VALAKI MEGIS UTANANEZ: a sort NEM a Prisma
     * kliens irja, hanem NYERS SQL (`worksheets.repository.ts`, `INSERT INTO
     * "WorksheetYearSequence" ... ON CONFLICT ... "lastValue" + 1`). Egy
     * `prisma.worksheetYearSequence` alakra keresve NULLA talalat jon, es abbol
     * konnyu arra jutni, hogy a tablat nem hasznalja senki.
     */
    async function assertNoLeftovers() {
      nincsMaradek([
        {
          nev: "a suite vevoi bent maradtak a takaritas utan",
          darab: await prisma.customer.count({
            where: { customerNumber: { startsWith: TEST_CUSTOMER_PREFIX } },
          }),
        },
        {
          nev: "a suite hibajegyei bent maradtak a takaritas utan",
          darab: await prisma.serviceJob.count({
            where: { jobNumber: { startsWith: TEST_JOB_PREFIX } },
          }),
        },
        {
          nev: "a suite automatikus jegyei bent maradtak a takaritas utan",
          darab: await prisma.serviceJob.count({
            where: {
              clientOperationId: { startsWith: "worksheet-auto-ticket:" },
              department: {
                customer: {
                  customerNumber: { startsWith: TEST_CUSTOMER_PREFIX },
                },
              },
            },
          }),
        },
        {
          nev: "a suite eszkozei bent maradtak a takaritas utan",
          darab: await prisma.asset.count({
            where: { assetNumber: { startsWith: TEST_ASSET_PREFIX } },
          }),
        },
        {
          nev: "a suite felhasznaloi bent maradtak a takaritas utan",
          darab: await prisma.user.count({
            where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
          }),
        },
      ]);
    }

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
        // AZ AUTOMATIKUS JEGYEK (worksheet-auto-ticket.ts) valodi HJ-szamot kapnak, tehat az elotag-szuro nem latja oket;
        // a helyszinuk viszont a suite-e, es a helyszin `Restrict`: bent maradva a vevo torleset allitanak meg.
        await prisma.serviceJob.deleteMany({
          where: { department: { customerId: { in: customerIds } } },
        });
        /**
         * A SAJAT HIBAJEGYEK, ELOTAGRA SZURVE -- ES EZ A SOR EDDIG HIANYZOTT.
         *
         * Merve (verify job 104359092423, ket sor-pillanatkep az integracios
         * futas korul): a `ServiceJob` EGY sorral tobb maradt, mint amennyi a
         * futas elott volt, es ez a suite az egyetlen, ami jegyet hoz letre es
         * egyet sem visz el.
         *
         * A VEVO TORLESE NEM VISZI, ES EPP EZ A CSAPDA: a `ServiceJob.customerId`
         * `SetNull`, nem `Cascade` -- a jegy tullel, csak gazdatlanul. Egy
         * `Cascade` mellett ez a sor felesleges lenne, `SetNull` mellett
         * kotelezo, es a ket eset a kodbol semmiben nem kulonbozik.
         *
         * ELOTAGRA SZURUNK, NEM A VEVORE: a gazdatlanna valt jegyet a
         * `customerId` mar nem koti ide, tehat egy vevo-alapu szuro epp azokat
         * hagyna ott, amiket ez a sor takaritani hivatott.
         */
        await prisma.serviceJob.deleteMany({
          where: { jobNumber: { startsWith: TEST_JOB_PREFIX } },
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
        // a vevo portal-felhasznaloi (az automatikus jegy tesztjeinek alairoi): a `User.customer` `Restrict`, tehat a vevo elott
        await prisma.user.deleteMany({
          where: {
            customerId: { in: customerIds },
            email: { endsWith: `@${TEST_EMAIL_DOMAIN}` },
          },
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

    /**
     * A REJTES MERCEJE, ES SZANDEKOSAN KET SORON MER.
     *
     * Egy allitas, ami csak annyit mond, hogy a rejtett lap ELTUNT, egy
     * OSSZEOMLOTT listaval is teljesulne: ha a szuro veletlenul mindent
     * kizarna, ez az egy allitas zold maradna. Ezert all mellette a masodik
     * sor, aminek MARADNIA kell -- ez a pozitiv kontroll, ugyanabban a
     * valaszban.
     */
    it("a rejtett lap eltűnik a listából, a másik marad", async () => {
      const rejtett = await createDraft(bioDepartmentId);
      const latszik = await createDraft(bioDepartmentId);

      await repository.setHidden(rejtett, new Date(), actorUserId);

      const alap = await repository.list(
        { page: 1, pageSize: 100 },
        { kind: "internal" },
        // `internal` -> a helyszin-ag ures, a lista nem sul el
        [],
      );
      const idk = alap.items.map((item) => item.id);
      assert.equal(idk.includes(rejtett), false, "a rejtett lap ott maradt");
      assert.ok(idk.includes(latszik), "a NEM rejtett lap is eltűnt");
    });

    it("a kapcsolóval visszajön, és MEG VAN JELÖLVE", async () => {
      const rejtett = await createDraft(bioDepartmentId);
      await repository.setHidden(rejtett, new Date(), actorUserId);

      const mindet = await repository.list(
        { page: 1, pageSize: 100, includeHidden: true },
        { kind: "internal" },
        // `internal` -> a helyszin-ag ures, a lista nem sul el
        [],
        /*
          A HARMADIK ARGUMENTUM A `SERVICE_HIDE` JOG, TENYKENT (2026-09-18 ota).
          Alapertelmezese `false`, tehat nelkule a kapcsolo hatastalan -- es ez
          a spec pontosan azt merne, hogy a jog hianyaban nem latszik a rejtett
          sor, nem azt, amit a neve mond.
        */
        true,
      );
      const sor = mindet.items.find((item) => item.id === rejtett);
      assert.ok(sor, "a kapcsolóval sem jött vissza");
      /*
        A JELOLO NELKUL a rejtett sor a tobbi kozott allna, es semmi nem
        mondana meg, melyik melyik -- vagyis a kapcsolo hasznalhatatlan lenne.
      */
      assert.equal(sor.hidden, true);
    });

    it("a visszaállítás után a lap újra a listában van", async () => {
      const id = await createDraft(bioDepartmentId);
      await repository.setHidden(id, new Date(), actorUserId);
      await repository.setHidden(id, null, actorUserId);

      const alap = await repository.list(
        { page: 1, pageSize: 100 },
        { kind: "internal" },
        // `internal` -> a helyszin-ag ures, a lista nem sul el
        [],
      );
      assert.ok(alap.items.some((item) => item.id === id));
      /*
        A VISSZAALLITAS A REJTO NEVET IS TORLI. Egy mar nem rejtett soron
        alldogalo regi nev a kovetkezo olvasonak tenynek latszik.
      */
      const row = await prisma.worksheet.findUniqueOrThrow({
        where: { id },
        select: { hiddenAt: true, hiddenById: true },
      });
      assert.deepEqual(row, { hiddenAt: null, hiddenById: null });
    });

    it("PARTNER hatókörön a kapcsoló NEM hozza vissza", async () => {
      /*
        AZ `includeHidden` KERES-PARAMETER, tehat a partner portalja is
        megadhatja. Ha a hivo dontene el, a probasorok pont ott jelennenek meg,
        ahol a legrosszabb.

        A POZITIV KONTROLL ITT IS KELL: a partner-lista amugy is szukebb, tehat
        egy ures valasz semmit nem bizonyitana. A nem rejtett lapnak latszania
        kell ugyanabban a valaszban.
      */
      const rejtett = await createDraft(bioDepartmentId);
      const latszik = await createDraft(bioDepartmentId);
      await repository.setHidden(rejtett, new Date(), actorUserId);

      const partnerLista = await repository.list(
        { page: 1, pageSize: 100, includeHidden: true },
        { kind: "customer", customerId },
        /*
          A HOZZARENDELT HELYSZIN, ES NEM URES LISTA. A ket lap a
          `bioDepartmentId` alatt all; ures listaval MIND A KETTO kiesne, es az
          allitas ("a partner a nem rejtettet LATJA") egy ures listan bukna el --
          vagyis nem a rejtest merne, hanem a helyszin-szurest.
        */
        [bioDepartmentId],
        /*
          JOGGAL EGYUTT, ES EZ A LENYEG. A jog nelkul ez az allitas zold lenne
          akkor is, ha a HATOKOR-feltetel egyaltalan nem letezne -- vagyis a
          neve ("a hatokor miatt") tobbet mondana, mint amit mer. Ugyanaz a
          gyengeseg, amit a `service-hide-scope.spec.ts` partner-esetenel a
          kalibracio talalt meg.
        */
        true,
      );
      const idk = partnerLista.items.map((item) => item.id);
      assert.equal(idk.includes(rejtett), false, "a partner látja a rejtettet");
      assert.ok(idk.includes(latszik), "a partner a nem rejtettet sem látja");
    });

    /**
     * AZ ALAIRASRA HASZNALT NEV A TELJES NEV, SOHA NEM A BECENEV.
     *
     * A `person-name.ts` sajat megjegyzese mondja ki, melyik fuggveny hova
     * valo: "The name for documents and signatures: always the full one, never
     * the nickname." Egy alairt munkalap dokumentum.
     *
     * MIERT ITT, ES NEM UNIT-SZINTEN: a szolgaltatas duplaja FIX szoveget ad
     * vissza, tehat ezt a kulonbseget egyetlen unit-allitas sem latja --
     * lemertem: a `personLegalName` -> `personDisplayName` csere zolden atment
     * a teljes unit-keszleten. Valodi sor kell hozza, becenevvel.
     */
    it("az aláíráshoz a TELJES nevet adja, nem a becenevet", async () => {
      const nev = await repository.userLegalName(technicianUserId);

      /*
        POZITIV KONTROLL: ha a fixture-on nem allna becenev, ez az allitas
        akkor is teljesulne, es semmit nem bizonyitana.
      */
      const sor = await prisma.user.findUniqueOrThrow({
        where: { id: technicianUserId },
        select: { displayName: true, nickname: true },
      });
      assert.ok(sor.nickname, "a fixture-on nincs becenév: az állítás vak");
      assert.notEqual(sor.nickname, sor.displayName);

      assert.equal(nev, sor.displayName);
      assert.notEqual(nev, sor.nickname);
    });

    it("ISMERETLEN felhasználóra `null`-t ad, nem üres nevet", async () => {
      /*
        Ures nevvel alairni rosszabb, mint elhasalni: a lapon egy nevtelen
        "szolgaltato munkatarsa" allna. A szolgaltatas ezert hibaval all meg.
      */
      assert.equal(await repository.userLegalName("nincs-ilyen-user"), null);
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

    it("freezes the creator's name at closing time, so a rename does not reach the sheet (card f450672c)", async () => {
      const id = await createDraft(bioDepartmentId);
      const creator = await prisma.worksheetVersion.findFirstOrThrow({
        where: { worksheetId: id },
        select: { createdBy: { select: { displayName: true } } },
      });
      assert.ok(creator.createdBy?.displayName);
      assert.deepEqual(await repository.close(id, actorUserId, new Date()), {
        ok: true,
      });

      const version = await prisma.worksheetVersion.findFirstOrThrow({
        where: { worksheetId: id },
        select: { createdByNameAtClose: true },
      });
      assert.equal(version.createdByNameAtClose, creator.createdBy.displayName);
    });

    /**
     * A LEZÁRÁS ELŐ IS ÁLLÍTJA A LAPOT -- ÉS EZ AZ ÁLLÍTÁS A `close()`-T
     * INDÍTJA EL, NEM A KÖZÖS TÖRZSET.
     *
     * A lánc három modulja (tartalom, leképezés, dokumentum) külön-külön mérve
     * van, és MIND ZÖLD VOLT ANÉLKÜL, hogy bárki hívta volna őket: a
     * `worksheetSheetInput` és a `worksheetSheetDocument` mai napig egyetlen
     * éles hívóhelyet sem látott. Egy közös-törzs-állítás tehát akkor is zöld
     * marad, ha a bekötés hiányzik -- épp azt a szakadást nem méri, amit ez a
     * szelet bezár.
     *
     * A FÁJLNÉV ITT NEM DÍSZ. Az a mező, amiből a sorrend-hiba KIDERÜL: a
     * sorszám a státusz-váltás UTÁN kerül kiosztásra, tehát egy korábban
     * előállított lap `munkalap-piszkozat.pdf` nevet kapna, és a hiba NÉMA
     * lenne -- a fájl elkészül, a lezárás sikerül.
     */
    it("a lezárás létrehozza a generált lapot, a SZÁM szerinti névvel", async () => {
      const id = await createDraft(bioDepartmentId);
      assert.deepEqual(await repository.close(id, actorUserId, new Date()), {
        ok: true,
      });

      const number = (await numberOf(id)).number ?? "";
      const version = await prisma.worksheetVersion.findFirstOrThrow({
        where: { worksheetId: id },
        orderBy: { version: "desc" },
        select: { id: true },
      });

      const sheets = await prisma.worksheetDocument.findMany({
        where: { worksheetId: id, type: "GENERATED_SHEET" },
      });
      assert.equal(sheets.length, 1, "verziónként pontosan egy hiteles lap");

      const sheet = sheets[0]!;
      assert.equal(sheet.worksheetVersionId, version.id);
      assert.equal(sheet.contentType, "application/pdf");

      // A NÉV A SZÁMOT HORDOZZA. A perjelet a névadó kötőjelre cseréli, ezért
      // a lap száma önmagában a horgony -- a verzió-utótag nem.
      assert.ok(
        sheet.fileName.includes(number),
        `a lap neve nem hordozza a számot: ${sheet.fileName}`,
      );
      assert.notEqual(
        sheet.fileName,
        "munkalap-piszkozat.pdf",
        "számozott lap piszkozat-nevet kapott: a lap a sorszám kiosztása ELŐTT készült",
      );

      // A BÁJTOK TÉNYLEG OTT VANNAK, és a lenyomat rájuk megy. Enélkül egy
      // üres tartalmú sor is kielégítené a fenti állításokat.
      assert.ok(sheet.content && sheet.content.length > 0);
      assert.equal(sheet.sizeBytes, sheet.content.length);
      assert.equal(
        createHash("sha256").update(sheet.content).digest("hex"),
        sheet.sha256,
      );
    });

    /**
     * A MÁSIK ÁG: A LAPNAK MÁR VAN SZÁMA.
     *
     * Az első lezárás OSZTJA a számot, a módosítás utáni MÁR TALÁLJA. A kettő
     * a `close()` két külön ága (`if (!worksheet.number && partnerCode)`), és
     * egy állítás csak az elsőt járja be. Itt az a kérdés, hogy a második
     * verzió is kap-e saját hiteles lapot -- a séma egyedi indexe
     * verziónként EGYET enged, tehát a második lezárás nem írhatja felül az
     * elsőt, és nem is akadhat el rajta.
     */
    it("módosítás után a MÁSODIK verzió is kap lapot, ugyanazzal a számmal", async () => {
      const id = await createDraft(bioDepartmentId);
      await repository.close(id, actorUserId, new Date());
      const number = (await numberOf(id)).number ?? "";

      const amended = await repository.amend({
        worksheetId: id,
        content: content(),
        changeReason: "A vevő kérésére pontosítva.",
        actorUserId,
      });
      assert.equal(amended.ok, true);
      assert.deepEqual(await repository.close(id, actorUserId, new Date()), {
        ok: true,
      });

      // A SZÁM NEM VÁLTOZIK: a második lezárás nem oszt újat.
      assert.equal((await numberOf(id)).number, number);

      const sheets = await prisma.worksheetDocument.findMany({
        where: { worksheetId: id, type: "GENERATED_SHEET" },
        orderBy: { createdAt: "asc" },
      });
      assert.equal(sheets.length, 2, "verziónként egy lap, tehát most kettő");
      assert.notEqual(
        sheets[0]!.worksheetVersionId,
        sheets[1]!.worksheetVersionId,
      );
      for (const sheet of sheets)
        assert.ok(
          sheet.fileName.includes(number),
          `a lap neve nem hordozza a számot: ${sheet.fileName}`,
        );
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
        signerUserId: null,
        signerSource: "TYPED" as const,
        signerName: "Kovács Béla",
        note: null,
        actorUserId,
        /*
          SZEMELYES ALAIRAS: gepelt nev, nincs valasztott munkatars, es NINCS
          kikuldes -- a belso kollega a helyszinen vetette ala. A `requireSent`
          ezert `false`, es ez nem a teszt kenyelme: pontosan ez az az ut, amit
          az elso, tul szeles kapum elzart volna.
        */
        requireSent: false,
        openTicketIfMissing: true,
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
      // BELSOS hatokor, kiirva: ez az allitas a SZEREP szerinti szurest meri,
      // nem a partner-hatokort. Azt kulon suite meri
      // (`auth/partner-scope-endpoint.integration.spec.ts`).
      const { items } = await repository.assignableUsers({ kind: "internal" });
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

      const response = await repository.list(
        {
          page: 1,
          pageSize: 100,
          assigneeId: technicianUserId,
        },
        { kind: "internal" },
        // `internal` -> a helyszin-ag ures, a lista nem sul el
        [],
      );
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
      const awaiting = await repository.list(
        {
          page: 1,
          pageSize: 100,
          status: "AWAITING_SIGNATURE",
        },
        { kind: "internal" },
        // `internal` -> a helyszin-ag ures, a lista nem sul el
        [],
      );
      assert.equal(
        awaiting.items.some((item) => item.id === id),
        true,
      );

      const draftsWhileAwaiting = await repository.list(
        {
          page: 1,
          pageSize: 100,
          status: "DRAFT",
        },
        { kind: "internal" },
        // `internal` -> a helyszin-ag ures, a lista nem sul el
        [],
      );
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

      const draftsAfterAmend = await repository.list(
        {
          page: 1,
          pageSize: 100,
          status: "DRAFT",
        },
        { kind: "internal" },
        // `internal` -> a helyszin-ag ures, a lista nem sul el
        [],
      );
      assert.equal(
        draftsAfterAmend.items.some((item) => item.id === id),
        true,
      );

      const awaitingAfterAmend = await repository.list(
        {
          page: 1,
          pageSize: 100,
          status: "AWAITING_SIGNATURE",
        },
        { kind: "internal" },
        // `internal` -> a helyszin-ag ures, a lista nem sul el
        [],
      );
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
      const drafts = await repository.list(
        {
          page: 1,
          pageSize: 100,
          status: "DRAFT",
        },
        { kind: "internal" },
        // `internal` -> a helyszin-ag ures, a lista nem sul el
        [],
      );

      assert.equal(drafts.pagination.totalItems, drafts.items.length);
      assert.equal(drafts.pagination.totalPages, 1);
    });

    /**
     * A TETELSZAM A JELENLEGI VERZIO SOROIBOL JON, AZ ADATBAZISBOL (acrobot
     * 25724, 2026-10-01): ebbol dol el, hogy egy piszkozat "Új" vagy
     * "Folyamatban". MI PIROSIT: ha a szam nem a sorokbol, vagy nem a
     * jelenlegi verziobol jonne, vagy egy uj sor nem latszana benne.
     */
    it("lists the current version's line count", async () => {
      const ures = await repository.createDraft({
        customerId,
        departmentId: bioDepartmentId,
        content: content({ lines: [] }),
        actorUserId,
      });
      const tetelesId = await repository.createDraft({
        customerId,
        departmentId: bioDepartmentId,
        content: content(),
        actorUserId,
      });
      const version = await prisma.worksheetVersion.findFirstOrThrow({
        where: { worksheetId: tetelesId, status: "DRAFT" },
        select: { id: true },
      });
      await repository.addLine({
        versionId: version.id,
        lineId: randomUUID(),
        line: content().lines[0]!,
        actorUserId,
      });

      const drafts = await repository.list(
        { page: 1, pageSize: 100, status: "DRAFT" },
        { kind: "internal" },
        [],
      );
      const sorbol = (id: string) =>
        drafts.items.find((item) => item.id === id)?.lineCount;
      assert.equal(sorbol(ures), 0);
      assert.equal(sorbol(tetelesId), 2);
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
    /**
     * AZ AUTOMATIKUS HIBAJEGY (Luca es Balazs, 2026-11-20; `worksheet-auto-ticket.ts`). Minden alairasi utat merunk
     * (a vevonek kikuldott, a gepelt nevvel rogzitett, a sajat es a vevo munkatarsanak kivalasztott alairasat; a mobil
     * ugyanezt a vegpontot hivja), es a negy esetet, amikor NEM nyilhat jegy: a partner utja, a KT-hoz kotott lap, a
     * mar meglevo jegy, es az elbukott alairas, ami utan jegy sem maradhat.
     */
    describe("automatikus hibajegy alairaskor", () => {
      async function closedSheet(subject = "Szivattyú csere a Biodómban") {
        const id = await repository.createDraft({
          customerId,
          departmentId: bioDepartmentId,
          content: content({ subject }),
          actorUserId,
        });
        await repository.close(id, actorUserId, new Date());
        return id;
      }
      async function expectedNumber() {
        const y = new Date().getFullYear();
        return nextServiceJobNumber({
          year: y,
          lastNumber: await lastServiceJobNumber(
            prisma,
            serviceJobNumberPrefix(y),
          ),
        });
      }
      async function ticketOf(worksheetId: string) {
        const sheet = await prisma.worksheet.findUniqueOrThrow({
          where: { id: worksheetId },
          select: {
            number: true,
            serviceJob: {
              select: {
                id: true,
                jobNumber: true,
                kind: true,
                status: true,
                title: true,
                customerId: true,
                departmentId: true,
                openedById: true,
                events: {
                  select: {
                    kind: true,
                    fromStatus: true,
                    toStatus: true,
                    worksheetId: true,
                    actorUserId: true,
                    note: true,
                  },
                },
              },
            },
          },
        });
        return sheet;
      }
      const sign = (
        worksheetId: string,
        extra: Partial<Parameters<WorksheetsRepository["sign"]>[0]> = {},
      ) =>
        repository.sign({
          worksheetId,
          decision: "ACCEPTED",
          signerUserId: null,
          signerSource: "TYPED" as const,
          signerName: "Kovács Béla",
          note: null,
          actorUserId,
          requireSent: false,
          openTicketIfMissing: true,
          now: new Date(),
          ...extra,
        });

      it("gépelt névvel aláírva HJ-jegyet nyit: a lap adataival, a lap alatt, Folyamatban, három naplósorral", async () => {
        const id = await closedSheet();
        const expected = await expectedNumber();
        const result = await sign(id);
        const sheet = await ticketOf(id);
        const job = sheet.serviceJob;
        assert.ok(job);
        const note = `Automatikusan a munkalapból (${sheet.number}), aláíráskor.`;
        assert.deepEqual(
          {
            result,
            job: { ...job, id: undefined, events: undefined },
            events: job.events
              .map(
                (e) =>
                  `${e.kind}|${e.fromStatus}|${e.toStatus}|${e.worksheetId === id}|${e.actorUserId === actorUserId}|${e.note}`,
              )
              .sort(),
            version: (
              await prisma.worksheetVersion.findFirstOrThrow({
                where: { worksheetId: id },
                select: { status: true },
              })
            ).status,
          },
          {
            result: {
              ok: true,
              autoTicket: { id: job.id, jobNumber: expected },
            },
            job: {
              id: undefined,
              jobNumber: expected,
              kind: "REPAIR",
              status: "IN_PROGRESS",
              title: "Szivattyú csere a Biodómban",
              customerId,
              departmentId: bioDepartmentId,
              openedById: actorUserId,
              events: undefined,
            },
            events: [
              `STATUS_CHANGE|NEW|IN_PROGRESS|false|true|${note} A lapon már vannak tételsorok.`,
              `STATUS_CHANGE|null|NEW|false|true|${note}`,
              `WORKSHEET_ATTACHED|null|null|true|true|${note}`,
            ],
            version: "SIGNED",
          },
        );
      });

      it("a saját (INTERNAL) és a vevő kiválasztott munkatársának (SELECTED) aláírása is jegyet nyit", async () => {
        const vevoMunkatars = await prisma.user.create({
          data: {
            email: `worksheets-signer-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: "Vevő Vilma",
            role: "PARTNER_SERVICE",
            customerId,
            isActive: true,
          },
          select: { id: true },
        });
        const sajat = await closedSheet();
        const kivalasztott = await closedSheet();
        const a = await sign(sajat, {
          signerSource: "INTERNAL" as const,
          signerUserId: actorUserId,
          signerName: "Worksheets Integration Actor",
        });
        const b = await sign(kivalasztott, {
          signerSource: "SELECTED" as const,
          signerUserId: vevoMunkatars.id,
          signerName: "Vevő Vilma",
        });
        assert.deepEqual(
          [
            a.ok && a.autoTicket !== null,
            b.ok && b.autoTicket !== null,
            (await ticketOf(sajat)).serviceJob?.status,
            (await ticketOf(kivalasztott)).serviceJob?.status,
          ],
          [true, true, "IN_PROGRESS", "IN_PROGRESS"],
        );
      });

      it("aláírásra küldéskor nyit jegyet, és a vevő aláírása utána már nem nyit másodikat", async () => {
        const vevo = await prisma.user.create({
          data: {
            email: `worksheets-recipient-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: "Vevő Viktor",
            role: "PARTNER_SERVICE",
            customerId,
            isActive: true,
          },
          select: { id: true },
        });
        const id = await closedSheet();
        const sent = await repository.sendForSignature({
          worksheetId: id,
          signerUserId: vevo.id,
          actorUserId,
          openTicketIfMissing: true,
          now: new Date(),
        });
        const afterSend = await ticketOf(id);
        // a vevo (partner) utja: kikuldes kell, jegyet nem nyithat
        const signed = await sign(id, {
          requireSent: true,
          openTicketIfMissing: false,
          actorUserId: vevo.id,
          signerSource: "SELECTED" as const,
          signerUserId: vevo.id,
          signerName: "Vevő Viktor",
        });
        const jobs = await prisma.serviceJob.count({
          where: {
            clientOperationId: { startsWith: `worksheet-auto-ticket:${id}:` },
          },
        });
        assert.deepEqual(
          {
            sent:
              sent.ok &&
              sent.autoTicket?.jobNumber === afterSend.serviceJob?.jobNumber,
            sendNote: afterSend.serviceJob?.events.some(
              (e) =>
                e.note ===
                `Automatikusan a munkalapból (${afterSend.number}), aláírásra küldéskor.`,
            ),
            signed,
            jobs,
          },
          {
            sent: true,
            sendNote: true,
            signed: { ok: true, autoTicket: null },
            jobs: 1,
          },
        );
      });

      it("a partner útja (openTicketIfMissing: false) jegy nélkül NO_TICKET, és nem ír semmit", async () => {
        const id = await closedSheet();
        const result = await sign(id, { openTicketIfMissing: false });
        assert.deepEqual(
          {
            result,
            version: (
              await prisma.worksheetVersion.findFirstOrThrow({
                where: { worksheetId: id },
                select: { status: true },
              })
            ).status,
            signatures: await prisma.worksheetVersionSignature.count({
              where: { worksheetVersion: { worksheetId: id } },
            }),
            ticket: (await ticketOf(id)).serviceJob,
          },
          {
            result: { ok: false, reason: "NO_TICKET" },
            version: "AWAITING_SIGNATURE",
            signatures: 0,
            ticket: null,
          },
        );
      });

      it("a karbantartási laphoz kötött lap nem kap jegyet, mégis aláírható (Balázs, 2026-11-24): kiküldésnél és aláírásnál jegy nélkül megy", async () => {
        const kt = await prisma.serviceJob.create({
          data: {
            jobNumber: `${TEST_JOB_PREFIX}KT${suffix}`,
            title: "Havi karbantartás",
            kind: "MAINTENANCE",
            customerId,
            departmentId: bioDepartmentId,
          },
          select: { id: true },
        });
        const id = await closedSheet();
        await prisma.serviceJobLinkedWorksheet.create({
          data: {
            serviceJobId: kt.id,
            worksheetId: id,
            linkedById: actorUserId,
          },
        });
        const vevo = await prisma.user.create({
          data: {
            email: `worksheets-kt-recipient-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: "Vevő Klára",
            role: "PARTNER_SERVICE",
            customerId,
            isActive: true,
          },
          select: { id: true },
        });
        const sent = await repository.sendForSignature({
          worksheetId: id,
          signerUserId: vevo.id,
          actorUserId,
          openTicketIfMissing: true,
          now: new Date(),
        });
        const signed = await sign(id);
        assert.deepEqual(
          {
            signed,
            sentTicket: sent.ok ? sent.autoTicket : "nem ment ki",
            ticket: (await ticketOf(id)).serviceJob,
            signatures: await prisma.worksheetVersionSignature.count({
              where: { worksheetVersion: { worksheetId: id } },
            }),
          },
          {
            signed: { ok: true, autoTicket: null, maintenanceJobId: kt.id },
            sentTicket: null,
            ticket: null,
            signatures: 1,
          },
        );
      });

      it("a jegyéről leválasztott lap újra kiküldve ÚJ automatikus jegyet kap, hiba nélkül (barracuda, #2765)", async () => {
        const vevo = await prisma.user.create({
          data: {
            email: `worksheets-resend-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: "Vevő Vince",
            role: "PARTNER_SERVICE",
            customerId,
            isActive: true,
          },
          select: { id: true },
        });
        const id = await closedSheet();
        const send = () =>
          repository.sendForSignature({
            worksheetId: id,
            signerUserId: vevo.id,
            actorUserId,
            openTicketIfMissing: true,
            now: new Date(),
          });
        const first = await send();
        // a leválasztás útja (`detachWorksheet`): a lap a jegy nélküli állapotba kerül vissza, a jegy megmarad
        await prisma.worksheet.update({
          where: { id },
          data: { serviceJobId: null },
        });
        const second = await send();
        const firstId = first.ok ? first.autoTicket?.id : null;
        const secondId = second.ok ? second.autoTicket?.id : null;
        assert.deepEqual(
          {
            ok: [first.ok, second.ok],
            two: Boolean(firstId && secondId && firstId !== secondId),
            sheetUnder: (await ticketOf(id)).serviceJob?.id === secondId,
            autoJobs: await prisma.serviceJob.count({
              where: {
                clientOperationId: {
                  startsWith: `worksheet-auto-ticket:${id}:`,
                },
              },
            }),
          },
          { ok: [true, true], two: true, sheetUnder: true, autoJobs: 2 },
        );
      });

      it("meglévő jegy alatt nem nyit újat, és elbukott aláírás után jegy sem marad", async () => {
        const job = await prisma.serviceJob.create({
          data: {
            jobNumber: `${TEST_JOB_PREFIX}AT${suffix}`,
            title: "Meglévő jegy",
            customerId,
            departmentId: bioDepartmentId,
          },
          select: { id: true },
        });
        const alatta = await repository.createDraft({
          customerId,
          departmentId: bioDepartmentId,
          content: content(),
          actorUserId,
          serviceJobId: job.id,
        });
        await repository.close(alatta, actorUserId, new Date());
        const meglevo = await sign(alatta);
        // piszkozat: a feltételes írás elbukik, és a jegy-nyitás csak utána jönne
        const piszkozat = await repository.createDraft({
          customerId,
          departmentId: bioDepartmentId,
          content: content(),
          actorUserId,
        });
        const elbukott = await sign(piszkozat);
        assert.deepEqual(
          {
            meglevo,
            jegyAlatt: (await ticketOf(alatta)).serviceJob?.id === job.id,
            elbukott,
            piszkozatJegye: (await ticketOf(piszkozat)).serviceJob,
            autoJegyek: await prisma.serviceJob.count({
              where: {
                OR: [alatta, piszkozat].map((sheet) => ({
                  clientOperationId: {
                    startsWith: `worksheet-auto-ticket:${sheet}:`,
                  },
                })),
              },
            }),
          },
          {
            meglevo: { ok: true, autoTicket: null },
            jegyAlatt: true,
            elbukott: { ok: false, reason: "NOT_AWAITING_SIGNATURE" },
            piszkozatJegye: null,
            autoJegyek: 0,
          },
        );
      });
    });

    /**
     * A JEGY ALA NYITOTT LAP -- ES EZ AZ EGYETLEN HELY, AHOL A BEIRAS MERHETO.
     *
     * A service oldalan a repository DUPLA, tehat ott az allitas annyit mond,
     * hogy a `serviceJobId` eljut a `createDraft` BEMENETEIG. Hogy onnan a SORBA
     * is bekerul, azt csak valodi adatbazis mondja meg -- egy kimaradt mezo ott
     * nem hibazik, csak `null` marad, es a lap jegy nelkul all.
     */
    it("writes the ticket onto the sheet in the same transaction", async () => {
      const job = await prisma.serviceJob.create({
        data: {
          jobNumber: `${TEST_JOB_PREFIX}${suffix}`,
          title: "Cápasuli szivattyú",
          customerId,
          departmentId: bioDepartmentId,
        },
        select: { id: true },
      });

      const worksheetId = await repository.createDraft({
        customerId,
        departmentId: bioDepartmentId,
        content: content(),
        actorUserId,
        serviceJobId: job.id,
      });

      const row = await prisma.worksheet.findUniqueOrThrow({
        where: { id: worksheetId },
        select: { serviceJobId: true },
      });
      assert.equal(row.serviceJobId, job.id);
    });

    /**
     * THE LIST ROW CARRIES THE SHEET'S JOB AND HOURS (service redesign E4,
     * 2026-10-04), and only a real database shows the list query selects
     * them: a missing relation in the include does not fail, it reads as
     * `null` or as zero hours. The hours are compared with the sheet's own
     * detail, so the list and the sheet cannot disagree.
     */
    it("lists the sheet's service job and its labour hours", async () => {
      const job = await prisma.serviceJob.create({
        data: {
          jobNumber: `${TEST_JOB_PREFIX}L${suffix}`,
          title: "Cápasuli szivattyú",
          customerId,
          departmentId: bioDepartmentId,
        },
        select: { id: true, jobNumber: true },
      });
      const worksheetId = await repository.createDraft({
        customerId,
        departmentId: bioDepartmentId,
        content: content({
          lines: [
            {
              description: "Szerelés",
              quantity: 1.5,
              unit: "óra",
              unitNet: 0,
              vatRatePercent: 27,
              kind: "LABOR",
              workerCount: 2,
            },
          ],
        } as Partial<WorksheetContentDto>),
        actorUserId,
        serviceJobId: job.id,
      });

      const { items } = await repository.list(
        { page: 1, pageSize: 100 },
        { kind: "internal" },
        [],
      );
      const item = items.find((row) => row.id === worksheetId);
      assert.ok(item, "the new sheet is not on the list");
      // a jegy fajtája is megy (a karbantartási lap hivatkozása a Karbantartás alá visz; ez a jegy hibajegy, az alapértelmezés)
      assert.deepEqual(item.serviceJob, {
        id: job.id,
        jobNumber: job.jobNumber,
        kind: "REPAIR",
      });
      const detailRow = await repository.detail(worksheetId, {
        kind: "internal",
      });
      assert.ok(detailRow);
      const detail = toWorksheetDetail(detailRow);
      assert.equal(item.laborHours, detail.currentVersion.laborHours);
      assert.equal(Number(item.laborHours), 3);
    });

    /**
     * A LISTA SZURO A KAPCSOLT MUNKA FAJTAJA SZERINT (kartya 8219e7d6, acrobot 56321): a hibajegyes lista csak a hibajegyhez, a karbantartasi csak a karbantartashoz kotott
     * lapokat hozza, az onallo lap (jegy nelkul) csak a szuretlen listaban van, es a csempe-szamlalo kovet. MI PIROSIT: ha a szuro nem hat, vagy keveri a ket fajtat, vagy az
     * onallo lap atcsuszik egy fajtara szurt listaba, vagy a szamlalo a szuretlen halmazt szamolja.
     */
    it("filters the list by the kind of the linked job, and counts what it lists", async () => {
      const mk = (kind: "REPAIR" | "MAINTENANCE", tag: string) =>
        prisma.serviceJob.create({
          data: {
            jobNumber: `${TEST_JOB_PREFIX}K${tag}${suffix}`,
            title: `Fajta ${tag}`,
            kind,
            customerId,
            departmentId: bioDepartmentId,
          },
          select: { id: true },
        });
      const sheet = async (serviceJobId?: string) =>
        repository.createDraft({
          customerId,
          departmentId: bioDepartmentId,
          content: content(),
          actorUserId,
          ...(serviceJobId ? { serviceJobId } : {}),
        });
      const repairSheet = await sheet((await mk("REPAIR", "R")).id);
      const maintenanceSheet = await sheet((await mk("MAINTENANCE", "M")).id);
      const standaloneSheet = await sheet();

      const ids = async (jobKind?: "REPAIR" | "MAINTENANCE") => {
        const result = await repository.list(
          { page: 1, pageSize: 100, ...(jobKind ? { jobKind } : {}) },
          { kind: "internal" },
          [],
        );
        return {
          ids: new Set(result.items.map((row) => row.id)),
          draftCount: result.counts.DRAFT,
          total: result.pagination.totalItems,
        };
      };

      const all = await ids();
      const repair = await ids("REPAIR");
      const maintenance = await ids("MAINTENANCE");

      for (const id of [repairSheet, maintenanceSheet, standaloneSheet])
        assert.ok(all.ids.has(id), "a szuretlen lista mindhármat hozza");

      assert.ok(repair.ids.has(repairSheet));
      assert.ok(!repair.ids.has(maintenanceSheet));
      assert.ok(
        !repair.ids.has(standaloneSheet),
        "az önálló lap nem hibajegyes",
      );

      assert.ok(maintenance.ids.has(maintenanceSheet));
      assert.ok(!maintenance.ids.has(repairSheet));
      assert.ok(!maintenance.ids.has(standaloneSheet));

      // a szamlalo a szurt halmazt szamolja, es a ket fajta egyutt nem tobb a szuretlennel
      assert.equal(repair.total, repair.ids.size);
      assert.equal(maintenance.total, maintenance.ids.size);
      assert.ok(repair.total + maintenance.total <= all.total);
      assert.ok(
        repair.draftCount < all.draftCount,
        "a csempe-szamlalo a szurt halmazt szamolja, nem a szuretlent",
      );
    });

    /**
     * TESTVER-KONTROLL: JEGY NELKUL A MEZO `null` MARAD, es a lap letrejon. Ha
     * egy rontas MINDKETTOT pirosra dontene, akkor nem a jegy beirasat mernenk,
     * hanem a letrehozast magat.
     */
    it("leaves the ticket null when the sheet is opened without one", async () => {
      const worksheetId = await repository.createDraft({
        customerId,
        departmentId: bioDepartmentId,
        content: content(),
        actorUserId,
      });

      const row = await prisma.worksheet.findUniqueOrThrow({
        where: { id: worksheetId },
        select: { serviceJobId: true },
      });
      assert.equal(row.serviceJobId, null);
    });

    it("reads the customer's own code from the asset, even on a signed sheet", async () => {
      const asset = await prisma.asset.create({
        data: {
          customerId,
          departmentId: bioDepartmentId,
          assetNumber: `${TEST_ASSET_PREFIX}${suffix}`,
          name: "Cápasuli kompresszor",
          partnerInternalCode: "LT-4711",
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
        signerUserId: null,
        signerSource: "TYPED" as const,
        signerName: "Gondnok Gábor",
        note: null,
        actorUserId,
        requireSent: false,
        openTicketIfMissing: true,
        now: new Date(),
      });
      assert.equal(signed.ok, true);

      const beforeRow = await repository.detail(worksheetId, {
        kind: "internal",
      });
      assert.ok(beforeRow);
      const before = toWorksheetDetail(beforeRow);
      assert.equal(before.currentVersion.status, "SIGNED");
      assert.equal(
        before.currentVersion.lines[0]?.partnerInternalCode,
        "LT-4711",
      );

      // A JAVÍTÁS AZ ESZKÖZÖN TÖRTÉNIK, a lapot senki nem nyitja meg.
      await prisma.asset.update({
        where: { id: asset.id },
        data: { partnerInternalCode: "LT-4712" },
      });

      const afterRow = await repository.detail(worksheetId, {
        kind: "internal",
      });
      assert.ok(afterRow);
      const after = toWorksheetDetail(afterRow);
      assert.equal(
        after.currentVersion.lines[0]?.partnerInternalCode,
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

    /**
     * A TÖRLÉS UTÁNI ÚJRASZÁMOZÁS ADATBÁZIS-SZINTŰ ÍGÉRET.
     *
     * Két megkötés áll a `WorksheetLine.position` mezőn, és MINDKETTŐ csak
     * valódi adatbázisban sül el: a (verzió, sorszám) páros EGYEDI, és a
     * sorszámra CHECK feltétel áll (`position >= 1`). Egy mockolt Prisma
     * mind a kettőt átengedi, tehát ez a spec nem kényelemből fut
     * adatbázison: mockon ZÖLD lenne az a kód is, ami élesben 500-at ad.
     */
    it("renumbers the remaining lines after a delete", async () => {
      /*
        MI PIROSÍT, ÉS KÉT IRÁNYBAN:
        (1) bármilyen ideiglenes sorszám, ami megsérti a CHECK feltételt.
            A 2026-09-17 előtti kód negatívat írt, és a tranzakció ezen
            hasalt el: a szerelő 500-at kapott a törlésre.
        (2) bármilyen sorrend, ami két sort ugyanarra a sorszámra vinne --
            azt az EGYEDI index vágja el.
      */
      const worksheetId = await repository.createDraft({
        customerId,
        departmentId: bioDepartmentId,
        content: content({
          lines: [
            {
              description: "Első tétel",
              quantity: 1,
              unit: "db",
              unitNet: 1000,
              vatRatePercent: 27,
            },
            {
              description: "Második tétel",
              quantity: 1,
              unit: "db",
              unitNet: 2000,
              vatRatePercent: 27,
            },
            {
              description: "Harmadik tétel",
              quantity: 1,
              unit: "db",
              unitNet: 3000,
              vatRatePercent: 27,
            },
          ],
        }),
        actorUserId,
      });

      const version = await prisma.worksheetVersion.findFirstOrThrow({
        where: { worksheetId, status: "DRAFT" },
        select: { id: true },
      });

      // POZITÍV KONTROLL: a kiindulás maga is állítás. Enélkül egy üresen
      // vagy másképp számozott lapon a záró állítás mást bizonyítana, mint
      // amit ide írtunk.
      const linesBefore = await prisma.worksheetLine.findMany({
        where: { worksheetVersionId: version.id },
        orderBy: { position: "asc" },
        select: { id: true, position: true, description: true },
      });
      assert.deepEqual(
        linesBefore.map((line) => [line.description, line.position]),
        [
          ["Első tétel", 1],
          ["Második tétel", 2],
          ["Harmadik tétel", 3],
        ],
      );

      const removed = await repository.removeLine({
        versionId: version.id,
        lineId: linesBefore[1]!.id,
      });
      assert.deepEqual(removed, { outcome: "ok", alreadyPresent: false });

      const linesAfter = await prisma.worksheetLine.findMany({
        where: { worksheetVersionId: version.id },
        orderBy: { position: "asc" },
        select: { position: true, description: true },
      });
      assert.deepEqual(
        linesAfter.map((line) => [line.description, line.position]),
        [
          ["Első tétel", 1],
          ["Harmadik tétel", 2],
        ],
      );
    });

    /**
     * A HELYSZÍNI RÖGZÍTÉS IDEMPOTENCIÁJA.
     *
     * A telefon térerő nélkül sorba teszi a lapot, és a sor a hálózati hibát
     * SZÁNDÉKOSAN újrapróbálja -- offline az a normális állapot. Épp ott lehet
     * viszont, hogy a kérés MÁR lefutott, és csak a válasz veszett el.
     *
     * MIÉRT ADATBÁZISON: a kód előzetes keresése két PÁRHUZAMOS kérésnél
     * elcsúszhat, és azt az esetet az EGYEDI INDEX vágja el. Mockkal ez a rés
     * láthatatlan marad.
     */
    describe("a kliens művelet-azonosítója", () => {
      const KULCS = "worksheet-create:WS-INT:2026-09-03T10:00:00.000Z";
      const MASIK = "worksheet-create:WS-INT:2026-09-03T10:05:00.000Z";

      it("UGYANAZ a kulcs kétszer EGY lapot ad", async () => {
        /*
          MI PIROSIT: a kulcsra kereses elhagyasa a letrehozas elol. Enelkul
          ket munkalap keletkezne, es a szerelo azt latna, hogy mindent ketszer
          rogzitett -- nem hibauzenetet, hanem ket sort, amirol el kell donteni,
          melyik az igazi.
        */
        const elso = await repository.createDraft({
          customerId,
          departmentId: bioDepartmentId,
          content: content(),
          actorUserId,
          clientOperationId: KULCS,
        });
        const masodik = await repository.createDraft({
          customerId,
          departmentId: bioDepartmentId,
          content: content(),
          actorUserId,
          clientOperationId: KULCS,
        });

        assert.equal(masodik, elso);
        // ES A TABLABAN IS EGY SOR ALL: a ket azonosito egyezese magaban meg
        // jöhetne ket rekordbol is.
        const darab = await prisma.worksheet.count({
          where: { clientOperationId: KULCS },
        });
        assert.equal(darab, 1);
      });

      it("MÁSIK kulcs MÁSIK lapot ad", async () => {
        // TESTVER-KONTROLL: e nelkul egy valtozat, ami MINDIG az elsot adja
        // vissza, atmenne a fenti allitason.
        const masik = await repository.createDraft({
          customerId,
          departmentId: bioDepartmentId,
          content: content(),
          actorUserId,
          clientOperationId: MASIK,
        });
        const elso = await prisma.worksheet.findUnique({
          where: { clientOperationId: KULCS },
          select: { id: true },
        });
        assert.notEqual(masik, elso?.id);
      });

      it("KULCS NÉLKÜL továbbra is minden hívás LÉTREHOZ", async () => {
        /*
          A MASIK IRANY, ES EZ VEDI A WEBES URLAPOT: az nem kuld kulcsot, es ma
          mukodik. Egy javitas, ami a kulcs nelkuli hivasokat osszevonna vagy a
          mezot kotelezove tenne, azt allitana le.
        */
        const egyik = await createDraft(bioDepartmentId);
        const masik = await createDraft(bioDepartmentId);
        assert.notEqual(masik, egyik);
      });
    });

    /**
     * AZ ELSŐ TÉTELSOR A HIBAJEGYET FOLYAMATBAN ÁLLAPOTBA LÉPTETI (Balázs
     * kérése, 2026-09-30). A szabályt a `first-line-ticket-step.spec.ts` méri;
     * ez a három HÍVÁSI HELYET, valódi adatbázison: új lap sorokkal, egy sor
     * felvétele, teljes mentés. Egy kimaradt hívás itt nem hibázna, csak a jegy
     * maradna a régi állapotában.
     */
    describe("az első tételsor léptetése", () => {
      let jobCounter = 0;
      async function job(status: "NEW" | "TRIAGED" | "WAITING_FOR_PARTS") {
        jobCounter += 1;
        return prisma.serviceJob.create({
          data: {
            jobNumber: `${TEST_JOB_PREFIX}${suffix}-EL${jobCounter}`,
            title: "Első tételsor",
            customerId,
            departmentId: bioDepartmentId,
            status,
          },
          select: { id: true },
        });
      }
      async function state(jobId: string) {
        const row = await prisma.serviceJob.findUniqueOrThrow({
          where: { id: jobId },
          select: {
            status: true,
            events: {
              where: { kind: "STATUS_CHANGE" },
              select: {
                fromStatus: true,
                toStatus: true,
                note: true,
                actorUserId: true,
              },
            },
          },
        });
        return row;
      }
      async function draftVersionId(worksheetId: string) {
        const version = await prisma.worksheetVersion.findFirstOrThrow({
          where: { worksheetId, status: "DRAFT" },
          select: { id: true },
        });
        return version.id;
      }
      const oneLine = () => content().lines[0]!;

      it("az új, jegy alá nyitott lap a sorokkal együtt lépteti a jegyet", async () => {
        const ticket = await job("NEW");
        await repository.createDraft({
          customerId,
          departmentId: bioDepartmentId,
          content: content(),
          actorUserId,
          serviceJobId: ticket.id,
        });
        const row = await state(ticket.id);
        assert.equal(row.status, "IN_PROGRESS");
        assert.deepEqual(row.events, [
          {
            fromStatus: "NEW",
            toStatus: "IN_PROGRESS",
            note: FIRST_LINE_STEP_NOTE,
            actorUserId,
          },
        ]);
      });

      it("üres lap nem léptet, az első felvett sor igen, a második már nem", async () => {
        const ticket = await job("NEW");
        const worksheetId = await repository.createDraft({
          customerId,
          departmentId: bioDepartmentId,
          content: content({ lines: [] }),
          actorUserId,
          serviceJobId: ticket.id,
        });
        assert.equal((await state(ticket.id)).status, "NEW");

        const versionId = await draftVersionId(worksheetId);
        await repository.addLine({
          versionId,
          lineId: randomUUID(),
          line: oneLine(),
          actorUserId: technicianUserId,
        });
        await repository.addLine({
          versionId,
          lineId: randomUUID(),
          line: oneLine(),
          actorUserId: technicianUserId,
        });
        const row = await state(ticket.id);
        assert.equal(row.status, "IN_PROGRESS");
        assert.equal(row.events.length, 1);
        assert.equal(row.events[0]!.actorUserId, technicianUserId);

        /*
          NEM "MINDEN SOR", HANEM AZ ELSŐ. Ha a jegy közben visszakerült egy
          korábbi állapotba (a kézi menet engedi: várakozásból ütemezettre), a
          következő sor már nem az első, és a jegyhez nem nyúl. MI PIROSÍT: ha
          a hívás minden sor után futna.
        */
        await prisma.serviceJob.update({
          where: { id: ticket.id },
          data: { status: "SCHEDULED" },
        });
        await repository.addLine({
          versionId,
          lineId: randomUUID(),
          line: oneLine(),
          actorUserId: technicianUserId,
        });
        assert.equal((await state(ticket.id)).status, "SCHEDULED");
      });

      it("a teljes mentés is léptet, ha azzal kerül fel az első sor", async () => {
        const ticket = await job("TRIAGED");
        const worksheetId = await repository.createDraft({
          customerId,
          departmentId: bioDepartmentId,
          content: content({ lines: [] }),
          actorUserId,
          serviceJobId: ticket.id,
        });
        const versionId = await draftVersionId(worksheetId);
        await repository.replaceDraftContent({
          versionId,
          content: content(),
          actorUserId,
        });
        const row = await state(ticket.id);
        assert.equal(row.status, "IN_PROGRESS");
        assert.equal(row.events.length, 1);
        assert.equal(row.events[0]!.fromStatus, "TRIAGED");

        // UGYANAZ, MINT A SOR-FELVÉTELNÉL: a visszaléptetett jegyet egy
        // későbbi mentés (ami már sorokat cserél) nem lépteti újra.
        await prisma.serviceJob.update({
          where: { id: ticket.id },
          data: { status: "SCHEDULED" },
        });
        await repository.replaceDraftContent({
          versionId,
          content: content(),
          actorUserId,
        });
        assert.equal((await state(ticket.id)).status, "SCHEDULED");
      });

      it("KONTROLL: az alkatrészre váró jegyhez nem nyúl", async () => {
        const ticket = await job("WAITING_FOR_PARTS");
        await repository.createDraft({
          customerId,
          departmentId: bioDepartmentId,
          content: content(),
          actorUserId,
          serviceJobId: ticket.id,
        });
        const row = await state(ticket.id);
        assert.equal(row.status, "WAITING_FOR_PARTS");
        assert.deepEqual(row.events, []);
      });
    });
  },
);
