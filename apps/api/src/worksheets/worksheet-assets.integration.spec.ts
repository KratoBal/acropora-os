import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import type { CreateWorksheetDto } from "./dto/worksheet.dto.js";
import { WorksheetsRepository } from "./worksheets.repository.js";
import { WorksheetsService } from "./worksheets.service.js";

/**
 * A LAP ALTAL ERINTETT ESZKOZOK -- VALODI SOROKON.
 *
 * === MIERT KELL, HOLOTT A SZABALY MAR MERVE VAN ===
 *
 * A `worksheet-assets.service.spec.ts` a `createDraft` BEMENETET meri: mi
 * jutott el a taroloig. Az a DONTEST bizonyitja (a helyszin-ellenorzes az IRAS
 * ELOTT fut), es jol -- de a TABLA-IRAS ott meretlen marad. A #648 kalibracioja
 * ezt ELORE kimondta: a `worksheetAsset.createMany` elhagyasa NULLA pirosat ad.
 * Ez a fajl nem uj lelet, hanem a megnevezett hatar bezarasa.
 *
 * === A NEGY ALLITAS, ES MELYIK MIT ZAR LE ===
 *
 *   a) a sorok TENYLEG kiirodnak, es a RESZFABOL is       -- a `createMany`
 *   b) idegen helyszin eszkozenel a LAP SEM jon letre     -- a sorrend
 *   c) az ismetlodo azonosito EGY sor                     -- a dedup + `@@unique`
 *   d) a lap torlese viszi a sorokat, az eszkoz MARAD     -- `Cascade` / `Restrict`
 *
 * A d) a sema igerete, es MOCKKAL NEM BIZONYITHATO: a ket iranyt (a kapcsolat
 * eltunik, a torzsadat megmarad) egyedul az adatbazis dont el.
 *
 * === A RESZFA SZANDEKOS AZ a) ESETBEN ===
 *
 * A ket eszkoz kozul az egyik a helyszin ALATTI csomoponton all, nem magan a
 * helyszinen. Ez nem diszites: a `assetsOutsideDepartment` epp azert jar be egy
 * fat, mert a bejelento a "Biodom"-ot nevezi meg, az eszkoz viszont a "Biodom /
 * Nagy medence" alatt all. Egy olyan fixtura, ahol mindket eszkoz kozvetlenul a
 * megnevezett egysegen ul, a fa-bejarasrol SEMMIT nem allitana.
 *
 * === A VARHATO KALIBRACIO, ELORE LEIRVA ===
 *
 *   a `worksheetAsset.createMany` elhagyasa a taroloban
 *       -> a), c) es d) piros; b) MINDKET allitasa zold
 *   a helyszin-ellenorzes (`assetsOutsideDepartment`) elhagyasa a szolgaltatasban
 *       -> b) MINDKET allitasa piros; a), c) es d) zold
 *
 * A ket rontas pirosai NEM fedik egymast, es epp ez a bizonyitek arra, hogy a
 * negy allitas ket KULON dolgot mer (az irast es a sorrendet), nem ugyanazt
 * negyszer.
 *
 * === ITT NEM FUT ===
 *
 * Ebben a konteneben nincs postgres. A "megirtam" es a "lefutott" koze EGY
 * CI-KOR esik; a helyi zold errol a suite-rol SEMMIT nem allit (a `pnpm test`
 * nev szerint is kizarja, es a kapu amugy is `skip` modban all).
 *
 * A suite sorokat hoz letre es torol, ezert csak tesztelesre megnevezett
 * adatbazison fut; lasd `integrationDatabaseGate`.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_EMAIL_DOMAIN = "worksheet-assets-integration.invalid";
const TEST_CUSTOMER_PREFIX = "WSA-INT-";

describe(
  "a munkalap eszközei valódi sorokon",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`.padStart(6, "0");
    const service = new WorksheetsService(new WorksheetsRepository());

    let actorUserId: string;
    let customerId: string;
    /** A lap helyszíne. */
    let helyszin: string;
    /** A helyszín ALATTI csomópont: a részfa-bejárás mércéje. */
    let alcsomopont: string;
    /** Testvér helyszín ugyanannál a partnernél: ami KÍVÜL esik. */
    let masikHelyszin: string;

    /** A helyszín részfájában álló két eszköz. */
    let eszkozHelyszinen: string;
    let eszkozAlcsomoponton: string;
    /** A testvér helyszín eszköze. */
    let idegenEszkoz: string;

    let sorszam = 0;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      const user = await prisma.user.create({
        data: {
          email: `actor-${suffix}@${TEST_EMAIL_DOMAIN}`,
          displayName: "Iroda Ilona",
          role: "OWNER",
          isActive: true,
        },
        select: { id: true },
      });
      actorUserId = user.id;

      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${TEST_CUSTOMER_PREFIX}${suffix}`,
          type: "COMPANY",
          displayName: "Eszközös Partner",
        },
        select: { id: true },
      });
      customerId = customer.id;

      const bio = await prisma.worksheetDepartment.create({
        data: { customerId, code: "BIO", name: "Biodóm" },
        select: { id: true },
      });
      helyszin = bio.id;

      const medence = await prisma.worksheetDepartment.create({
        data: {
          customerId,
          parentId: helyszin,
          code: "NAG",
          name: "Nagy medence",
        },
        select: { id: true },
      });
      alcsomopont = medence.id;

      const ppu = await prisma.worksheetDepartment.create({
        data: { customerId, code: "PPU", name: "PP Üzemeltetés" },
        select: { id: true },
      });
      masikHelyszin = ppu.id;

      const [egy, ketto, idegen] = await Promise.all([
        newAsset("1", helyszin),
        newAsset("2", alcsomopont),
        newAsset("3", masikHelyszin),
      ]);
      eszkozHelyszinen = egy;
      eszkozAlcsomoponton = ketto;
      idegenEszkoz = idegen;
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
    });

    async function newAsset(jel: string, departmentId: string) {
      const asset = await prisma.asset.create({
        data: {
          assetNumber: `${TEST_CUSTOMER_PREFIX}${suffix}-${jel}`,
          name: `Szivattyú ${jel}`,
          customerId,
          departmentId,
        },
        select: { id: true },
      });
      return asset.id;
    }

    function input(assetIds: string[]): CreateWorksheetDto {
      sorszam += 1;
      return {
        customerId,
        departmentId: helyszin,
        subject: `Szivattyú csere ${sorszam}`,
        lines: [],
        assetIds,
      };
    }

    async function assetIdsOf(worksheetId: string) {
      const rows = await prisma.worksheetAsset.findMany({
        where: { worksheetId },
        select: { assetId: true },
      });
      return rows.map((row) => row.assetId).sort();
    }

    function lapokSzama() {
      return prisma.worksheet.count({ where: { customerId } });
    }

    /**
     * a) A SOROK TENYLEG KIIRODNAK -- ES A RESZFABOL IS.
     *
     * Az `assetIds` halmazat vetjuk ossze, nem csak a darabszamot: egy olyan
     * tarolo, ami KET sort ir, de mindkettot ugyanarra az eszkozre, a
     * darabszamon atmenne.
     */
    it("a helyszín részfájában álló két eszköz felkerül a lapra", async () => {
      const detail = await service.create(
        input([eszkozHelyszinen, eszkozAlcsomoponton]),
        actorUserId,
      );

      assert.deepEqual(
        await assetIdsOf(detail.id),
        [eszkozHelyszinen, eszkozAlcsomoponton].sort(),
      );
    });

    /**
     * b) AZ ELLENORZES AZ IRAS ELOTT FUT -- KET ALLITASBAN.
     *
     * A ketto SZANDEKOSAN kulon all. A valaszkod onmagaban akkor is zold lenne,
     * ha az ellenorzes a letrehozas UTAN futna: a hivo 400-at latna, a lap
     * pedig MAR LETEZNE. A masodik allitas az, ami a sorrendrol szol.
     */
    it("idegen helyszín eszközénél 400 a válasz", async () => {
      await assert.rejects(
        () => service.create(input([idegenEszkoz]), actorUserId),
        (hiba: { status?: number; message?: string }) =>
          hiba.status === 400 &&
          /nem ezen a helyszínen/.test(hiba.message ?? ""),
      );
    });

    it("idegen helyszín eszközénél a LAP SEM jön létre", async () => {
      const elotte = await lapokSzama();

      // A HIBAT ITT SZANDEKOSAN ELNYELJUK: a valaszkodrol a fenti allitas szol.
      // Ez a sor a TABLAT meri, es akkor is mernie kell, ha a hivas egyaltalan
      // nem dobna.
      await service
        .create(input([idegenEszkoz]), actorUserId)
        .catch(() => undefined);

      assert.equal(await lapokSzama(), elotte);
    });

    /**
     * c) AZ ISMETLODES EGY SORT AD.
     *
     * A szolgaltatas-oldali dedup es a `@@unique([worksheetId, assetId])`
     * ugyanazt az esetet fedi, ket kulonbozo modon -- es itt egyszerre all
     * mind a ketto, mert a hivas VALODI taroloba megy. Ha a dedup kiesne, ez az
     * allitas nem "ket sort" latna, hanem a lap letrehozasa hasalna el egy
     * megkotes-hibaval: a piros akkor is jon, csak mas alakban.
     */
    it("ugyanaz az azonosító kétszer beküldve egy sort ad", async () => {
      const detail = await service.create(
        input([eszkozHelyszinen, eszkozHelyszinen]),
        actorUserId,
      );

      assert.deepEqual(await assetIdsOf(detail.id), [eszkozHelyszinen]);
    });

    /**
     * d) A SEMA KET IGERETE, EGY MERESBEN.
     *
     * `Cascade` a lap fele: egy torolt lap nem hagy maga utan arva
     * kapcsolatsorokat. `Restrict` az eszkoz fele: ami megtortent, megtortent --
     * egy lap torlese nem viheti magaval a torzsadatot.
     *
     * A TORLES ELOTTI ALLITAS NEM DISZITES: enelkul az egesz eset zold lenne
     * akkor is, ha a sor SOHA nem jott letre -- vagyis ha a `createMany`
     * hianyzik. Igy viszont epp az a rontas dont pirosra itt is.
     */
    it("a lap törlése viszi a kapcsolatsorokat, az eszközt nem", async () => {
      const detail = await service.create(
        input([eszkozHelyszinen]),
        actorUserId,
      );
      assert.deepEqual(await assetIdsOf(detail.id), [eszkozHelyszinen]);

      await prisma.worksheet.delete({ where: { id: detail.id } });

      assert.deepEqual(await assetIdsOf(detail.id), []);
      assert.ok(
        await prisma.asset.findUnique({
          where: { id: eszkozHelyszinen },
          select: { id: true },
        }),
        "a lap törlése elvitte az eszköz törzsadatát is",
      );
    });

    /**
     * A TAKARITAS TENYLEG LEFUTOTT-E. A teljes indoklas a parjaban all
     * (`service-jobs-write-scope.integration.spec.ts`); roviden: a CI-kapu
     * (`scripts/tap-stream-gate.mjs`) azt fogja meg, ha a takaritas DOB, ez
     * pedig azt, ha CSENDBEN NEM CSINAL SEMMIT -- egy elirt elotag mellett a
     * `deleteMany` nulla sorra illeszkedik, nem dob, es a kapunak nincs mit
     * megfognia.
     *
     * EZ AZ UTOLSO TESZT A FAJLBAN, ES ANNAK IS KELL MARADNIA: elviszi a
     * fixtura-sorokat, tehat egy utana felvett eset a hivatkozott
     * azonositoknal hasalna el.
     *
     * AZ ESZKOZ KULON SZAMOL, ES NEM REDUNDANCIA: a `WorksheetAsset.assetId`
     * `Restrict`, tehat egy bent maradt kapcsolatsor epp az eszkoz torleset
     * allitana meg -- ez a szam mondja meg, hogy a lapok tenyleg elmentek.
     */
    it("a takarítás tényleg lefut: nem marad sor a teszt előtaggal", async () => {
      await removeLeftovers();

      assert.equal(
        await prisma.asset.count({
          where: { assetNumber: { startsWith: TEST_CUSTOMER_PREFIX } },
        }),
        0,
        "maradt eszköz a teszt előtaggal",
      );
      assert.equal(
        await prisma.customer.count({
          where: { customerNumber: { startsWith: TEST_CUSTOMER_PREFIX } },
        }),
        0,
        "maradt vevő a teszt előtaggal",
      );
      assert.equal(
        await prisma.user.count({
          where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
        }),
        0,
        "maradt felhasználó a teszt e-mail tartománnyal",
      );
    });

    async function removeLeftovers() {
      const customers = await prisma.customer.findMany({
        where: { customerNumber: { startsWith: TEST_CUSTOMER_PREFIX } },
        select: { id: true },
      });
      const customerIds = customers.map((row) => row.id);

      if (customerIds.length > 0) {
        // A LAPOK ELOSZOR: a `WorksheetAsset.assetId` `Restrict`, tehat egy
        // bent maradt kapcsolatsor az eszkoz torleset allitana meg.
        await prisma.worksheet.deleteMany({
          where: { customerId: { in: customerIds } },
        });
        // AZ ESZKOZOK A LAPOK UTAN, DE A HELYSZINEK ES A VEVO ELOTT: az
        // `Asset.customerId` es az `Asset.departmentId` is `Restrict`.
        await prisma.asset.deleteMany({
          where: { customerId: { in: customerIds } },
        });
        // A HELYSZINEK FAT ALKOTNAK, es a szulore `Restrict` all: levelrol a
        // gyoker fele haladunk, amig fogy a fa.
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
  },
);
