import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";

/**
 * KET FELHASZNALO, UGYANAZ AZ UGYFEL, KULONBOZO EGYSEG -- FIXTURA ES KERET.
 *
 * MIERT LETEZIK EZ A FAJL. 2026-09-22-en egy portal-felhasznalo az ugyfele
 * OSSZES hibajegyet latta a sajat negy helyszine helyett, es HAROM ZOLD SPEC
 * allt folotte. Egyik sem volt hianyos: mindharom a szuro ALAKJAT merte (ket
 * tengely OR-ban, a szukito elol), es egy alak-allitas SZERKEZETILEG nem tudja
 * megkulonboztetni a szukito tengelyt attol, amelyik mindent atenged.
 *
 * ES ITT A SZERKEZETI OK, MERVE: a `userWorksheetDepartment` tablat -- ami a
 * felhasznalo-egyseg parositast tartja -- 2026-09-22-ig EGYETLEN spec sem hozta
 * letre. (Kontroll: ugyanez a kereses a nem-teszt kodban ot helyen talal, tehat
 * a minta mukodik.) Vagyis a rendszer soha nem futott le olyan felhasznaloval,
 * akinek TENYLEG van egyseg-hozzarendelese -- a specek az `unitIds` tombot
 * atadott parameterkent kaptak.
 *
 * AMIT EZ A FAJL MA TARTALMAZ: a fixturat es a keretet. A lathatosagi
 * allitasok KESOBB kerulnek ra, amikor a where-epitok alairasa veglegesedett
 * (az `unitIds` kotelezo parameter lesz). Ezert a mai allitasok a FIXTURAT es a
 * KERETET meriK -- nem a termeles viselkedeset.
 *
 * ES A KERET SAJAT CSAPDAJA, KIMONDVA: ha a keret SAJAT where-ertelmezot kapna
 * (kezzel megirva, hogy mit jelent egy `in` vagy egy `OR`), akkor ez a spec a
 * SAJAT ertelmezomet merne, nem a Prismat -- lefordulna, zold lenne, es pont
 * attol a hibatol nem vedene, ami miatt keszult. Ezert a keret NEM ertelmez:
 * atadja a `where` objektumot a Prismanak, es a sorokat adja vissza.
 */

const gate = integrationDatabaseGate(process.env);

const PREFIX = "ITUNITVIS";

let ugyfelId = "";
let kroId = "";
let akvId = "";
let kroFelhasznaloId = "";
let akvFelhasznaloId = "";

/**
 * A KERET. Egyetlen dolgot csinal: atadja a kapott szurot a Prismanak, es
 * rendezve visszaadja az eszkozszamokat. Szandekosan nincs benne semmilyen
 * ertelmezes.
 */
async function latottEszkozok(
  where: Parameters<typeof prisma.asset.findMany>[0] extends
    { where?: infer W } | undefined
    ? W
    : never,
): Promise<string[]> {
  const rows = await prisma.asset.findMany({
    where: { AND: [{ assetNumber: { startsWith: PREFIX } }, where ?? {}] },
    select: { assetNumber: true },
  });
  return rows.map((row) => row.assetNumber).sort();
}

/**
 * A takaritas levelrol gyoker fele halad, ugyanazzal az indokkal, mint a
 * `unit-subtree.integration.spec.ts` fajlban: az `Asset.departmentId` es a
 * `WorksheetDepartment.parentId` kapcsolatan `Restrict` all.
 *
 * A hozzarendelesek NEM kapnak sajat torlest: a `UserWorksheetDepartment` ket
 * idegen kulcsan `Cascade` all, tehat a felhasznalo vagy az egyseg torlese
 * elviszi oket. Ezt a sema mondja ki, nem feltetelezes.
 */
async function takarit() {
  await prisma.asset.deleteMany({
    where: { assetNumber: { startsWith: PREFIX } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await prisma.worksheetDepartment.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

async function egyseg(kod: string, nev: string) {
  const row = await prisma.worksheetDepartment.create({
    data: { customerId: ugyfelId, code: kod, name: nev, parentId: null },
    select: { id: true },
  });
  return row.id;
}

async function felhasznalo(utotag: string, egysegId: string) {
  const row = await prisma.user.create({
    data: {
      email: `${PREFIX}-${utotag}@példa.invalid`,
      displayName: `${PREFIX} ${utotag}`,
      role: "PARTNER_SERVICE",
      customerId: ugyfelId,
      unitAssignments: { create: [{ departmentId: egysegId }] },
    },
    select: { id: true },
  });
  return row.id;
}

async function eszkoz(utotag: string, egysegId: string | null) {
  await prisma.asset.create({
    data: {
      assetNumber: `${PREFIX}-${utotag}`,
      name: `${PREFIX} ${utotag}`,
      customerId: ugyfelId,
      departmentId: egysegId,
    },
  });
}

describe(
  "asset visibility by unit: fixture and harness",
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

      kroId = await egyseg(`${PREFIX}KRO`, "Krokodilhaz");
      akvId = await egyseg(`${PREFIX}AKV`, "Akvarium");

      kroFelhasznaloId = await felhasznalo("kro", kroId);
      akvFelhasznaloId = await felhasznalo("akv", akvId);

      // A KET HALMAZ METSZETE URES, es ez a fixtura lenyege: e nelkul egy
      // "mindent atengedo" es egy "helyesen szukito" szuro UGYANAZT adna.
      await eszkoz("KRO-1", kroId);
      await eszkoz("KRO-2", kroId);
      await eszkoz("AKV-1", akvId);
      await eszkoz("AKV-2", akvId);
      await eszkoz("AKV-3", akvId);
      // Es egy eszkoz, ami az UGYFELE, de EGYSEG NELKUL all. Ez a hatareset:
      // egyik egyseg-szukites sem hozza vissza, viszont egy puszta
      // ugyfel-szurore megjelenik.
      await eszkoz("NINCS-EGYSEG", null);
    });

    after(takarit);

    it("KONTROLL: a fixtura ket egysege KULONBOZO, es mindketto az ugyfele", async () => {
      const egysegek = await prisma.worksheetDepartment.findMany({
        where: { customer: { customerNumber: { startsWith: PREFIX } } },
        select: { id: true },
      });

      assert.equal(egysegek.length, 2);
      assert.notEqual(kroId, akvId);
    });

    it("KONTROLL: mindket felhasznalonak PONTOSAN EGY hozzarendelese van, es azok kulonboznek", async () => {
      const kro = await prisma.userWorksheetDepartment.findMany({
        where: { userId: kroFelhasznaloId },
        select: { departmentId: true },
      });
      const akv = await prisma.userWorksheetDepartment.findMany({
        where: { userId: akvFelhasznaloId },
        select: { departmentId: true },
      });

      assert.deepEqual(
        kro.map((sor) => sor.departmentId),
        [kroId],
      );
      assert.deepEqual(
        akv.map((sor) => sor.departmentId),
        [akvId],
      );
    });

    /**
     * A KERET KALIBRACIOJA, ES EZ A FAJL LEGFONTOSABB ALLITASA.
     *
     * A ket szurot ITT irom le, nem a termeles epitojebol veszem -- igy az
     * allitas nem fugg attol, hogy az alairas epp valtozik. Amit mer: hogy a
     * keret KEPES megkulonboztetni a ket esetet.
     *
     * Ha a ket eredmeny EGYFORMA lenne, a keret hasznalhatatlan: pontosan azt a
     * kulonbseget nem latna, ami miatt keszult.
     */
    it("a keret MEGKULONBOZTET: az ugyfel-szuro mindent hoz, az egyseg-szuro csak a sajatot", async () => {
      const csakUgyfel = await latottEszkozok({ customerId: ugyfelId });
      const kroEgyseg = await latottEszkozok({
        AND: [{ customerId: ugyfelId }, { departmentId: { in: [kroId] } }],
      });
      const akvEgyseg = await latottEszkozok({
        AND: [{ customerId: ugyfelId }, { departmentId: { in: [akvId] } }],
      });

      assert.equal(csakUgyfel.length, 6, "a puszta ugyfel-szuro MINDENT hoz");
      assert.deepEqual(kroEgyseg, [`${PREFIX}-KRO-1`, `${PREFIX}-KRO-2`]);
      assert.deepEqual(akvEgyseg, [
        `${PREFIX}-AKV-1`,
        `${PREFIX}-AKV-2`,
        `${PREFIX}-AKV-3`,
      ]);

      // A KET HALMAZ METSZETE URES -- ezt kulon kimondjuk, mert e nelkul a fenti
      // ket allitas egy olyan fixturan is zold lenne, ahol atfednek.
      const metszet = kroEgyseg.filter((szam) => akvEgyseg.includes(szam));
      assert.deepEqual(metszet, []);
    });

    /**
     * AMI MEG NINCS ITT, ES SZANDEKOSAN NINCS.
     *
     * A ket lathatosagi allitas -- hogy a TERMELESI where-epito a ket
     * felhasznalora KULONBOZO halmazt ad -- akkor kerul ide, amikor az
     * `unitIds` kotelezo parameterre atallt alairas bent van a fo agon. Addig
     * egy ilyen allitas vagy nem fordulna le, vagy a mai (hibas) viselkedest
     * rogzitene helyesnek -- es epp ez utobbi az a hiba, ami miatt ez a fajl
     * letezik.
     *
     * A fixtura es a keret viszont az alairastol FUGGETLEN, ezert all itt mar ma.
     */
  },
);
