import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { assignedUnitIdsFor } from "../service-jobs/assigned-units.query.js";
import { assetListWheres } from "./service-assets.repository.js";

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
 * === HOL FUTNAK EZEK, ES HOL NEM (2026-09-22) ===
 *
 * CSAK A CI-BEN. A `RUN_DB_INTEGRATION=1` kapu mogott allnak, es a futtatojuk a
 * verify job Postgres szolgaltatasa.
 *
 * HELYBEN NEM VOLTAK KALIBRALVA, es ezt kimondom, mert kulonben a lenti
 * allitasok ugy neznenek ki, mint a szomszed egysegtesztek: ebbol a
 * konteneerbol az EGYETLEN elerheto adatbazis a PRODUKCIOS, oda pedig nem
 * futtatunk semmit. Egy rontas-alapu kalibracio tehat nem volt lehetseges ott,
 * ahol a kodot irtam.
 *
 * AMI HELYETTE BIZONYIT, ES KULSO: ugyanez a szelet elso CI-futasakor
 * TIZENNEGY MAS integracios allitas valt pirosra -- olyanok, amiket nem en
 * irtam, es amik elozo nap zoldek voltak. Mind a tizennegy azert bukott, mert a
 * fixturajuk partner-felhasznaloinak NEM VOLT helyszin-hozzarendelese, tehat az
 * uj szabaly alatt semmit nem lattak. Ez kivulrol mutatja meg, hogy a tengely
 * TENYLEG szukit -- erosebb bizonyitek, mint amit egy sajat rontas adna, mert
 * nem az en kezembol jon.
 *
 * A fixturak javitasa utan ugyanaz a suite 0 pirossal fut (commit 9eaa4a0e).
 *
 * ES A KET SZAM KULONBSEGE A LENYEG: a 14 azt mondja meg, hogy a szukites
 * harap; a 0 azt, hogy a fixturak mostantol a VALOS alakot merik. Egyik sem
 * helyettesiti a masikat, es a masodikbol magaban semmi nem kovetkezne.
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

      /**
       * A KOD HAROM KARAKTER, ES EZT A SEMA SZABJA MEG, NEM IZLES:
       * `WorksheetDepartment.code` tipusa `@db.VarChar(3)`.
       *
       * Az elso valtozatom a PREFIX-et is beleirta (`ITUNITVISKRO`, tizenket
       * karakter), es a CI-ben a `before` horog hasalt el rajta. A harom
       * allitasom NEM bukott el, hanem EL SEM INDULT (`cancelledByParent`,
       * `duration_ms: 0`) -- es a ket eset mast jelent: ha az allitas bukik,
       * a MERT dolog rossz; ha a horog, a meres meg sem tortent.
       *
       * A takaritas emiatt NEM serul: az egysegeket az UGYFEL szama szerint
       * torlom, nem a kod szerint. Az egyediseg pedig osszetett
       * (`[customerId, parentId, code]`), tehat a sajat ugyfelem alatt a
       * valodi helyszin-kodok hasznalhatoak.
       *
       * ES EZZEL A FIXTURA HITELESEBB IS LETT: a valodi helyszinek pontosan
       * ilyen harombetus kodok (AKV, KRO, VAR, MRG).
       */
      kroId = await egyseg("KRO", "Krokodilhaz");
      akvId = await egyseg("AKV", "Akvarium");

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
     * === AMI ERRE VART, ES 2026-09-22-EN MEGERKEZETT ===
     *
     * A fajl eredeti zaro jegyzete azt mondta ki, hogy a ket lathatosagi
     * allitas akkor kerul ide, amikor az `unitIds` kotelezo parameterre atallt
     * alairas bent van. Az alairas ezzel a valtozassal all at
     * (`assetListWheres(scope, assignedUnitIds, ...)`), tehat az allitasok itt
     * vannak -- ugyanazon a fixturan, nem egy masodikon.
     *
     * AMIERT NEM UJ FIXTURAT IRTAM: ket fixtura ugyanarra a tulajdonsagra nem
     * ket meres, hanem egy meres es egy jovobeli elteres. Ha az egyik valtozik,
     * a masik csendben tovabb allitja a regit.
     */
    /**
     * A TERMELESI WHERE-EPITO A KET FELHASZNALORA KULONBOZO HALMAZT AD.
     *
     * Ez az az allitas, amire a fajl fejlece vart: az `assetListWheres` alairasa
     * 2026-09-22 ota KOTELEZO `assignedUnitIds` parametert visel, tehat egy
     * kifelejtett hivohely forditasi hiba, nem csendes tagitas.
     *
     * A KET FELHASZNALO HOZZARENDELESET A TERMELESI LEKERDEZES OLDJA FEL
     * (`assignedUnitIdsFor`), nem a spec irja be kezzel. Igy a meres a FELOLDAST
     * es a SZUROT egyutt jarja be -- a ketto kulon tud elromlani, es egy kezzel
     * beirt egyseg-lista epp a feloldast hagyna meretlenul.
     */
    it("a termelesi szuro: a KRO-felhasznalo csak a KRO eszkozeit latja", async () => {
      const egysegek = await assignedUnitIdsFor(kroFelhasznaloId);
      const { list } = assetListWheres(
        { kind: "customer", customerId: ugyfelId },
        egysegek,
        {},
        {},
      );

      assert.deepEqual(await latottEszkozok(list), [
        `${PREFIX}-KRO-1`,
        `${PREFIX}-KRO-2`,
      ]);
    });

    /**
     * ES A MASODIK POZITIV KONTROLL: UGYANAZ a lekerdezes, MASIK felhasznalo,
     * MASIK halmaz.
     *
     * Enelkul a fenti allitas egy olyan szurotol is zold lenne, ami VELETLENUL
     * epp a KRO-halmazt adja (beegetett azonosito, elso-egyseg-nyer, barmi).
     * Ketto egyutt bizonyit: a kimenet a HIVOTOL fugg, nem a kodban all.
     */
    it("KONTROLL: az AKV-felhasznalo UGYANAZZAL a lekerdezessel MASIK halmazt lat", async () => {
      const egysegek = await assignedUnitIdsFor(akvFelhasznaloId);
      const { list } = assetListWheres(
        { kind: "customer", customerId: ugyfelId },
        egysegek,
        {},
        {},
      );

      assert.deepEqual(await latottEszkozok(list), [
        `${PREFIX}-AKV-1`,
        `${PREFIX}-AKV-2`,
        `${PREFIX}-AKV-3`,
      ]);
    });

    /**
     * A HELYSZIN NELKULI ESZKOZ EGYIK FELHASZNALONAK SEM LATSZIK -- ES EZ DONTES.
     *
     * A sema megengedi a NULL `departmentId` erteket (`Asset.departmentId String?`),
     * es a letrehozo DTO-ban a mezo elhagyhato, tehat ilyen sor MA IS keletkezhet.
     * Egy `departmentId: { in: [...] }` feltetel a NULL-t nem engedi at.
     *
     * A KET TEVEDES ARA NEM EGYFORMA: ha lathato lenne, egy sor, ami semmilyen
     * helyszinhez nem tartozik, atmenne a szuron, es a szabaly kivetelt kapna,
     * amit kesobb senki nem ert. Igy viszont a partner SZOL, hogy hianyzik
     * valami, es kiderul, hogy az adat hianyos -- a tevedes HANGOS, es a javitas
     * a helyes helyen tortenik.
     *
     * HA EZ A DONTES VALAHA MEGFORDUL, EZ AZ ALLITAS PIROSODIK, es akkor a
     * valtozast ki kell mondani, nem csendben atirni.
     */
    it("a helyszin NELKULI eszkoz egyik felhasznalonak sem latszik", async () => {
      for (const userId of [kroFelhasznaloId, akvFelhasznaloId]) {
        const { list } = assetListWheres(
          { kind: "customer", customerId: ugyfelId },
          await assignedUnitIdsFor(userId),
          {},
          {},
        );

        assert.ok(
          !(await latottEszkozok(list)).includes(`${PREFIX}-NINCS-EGYSEG`),
          `a helyszin nelkuli eszkoz atjott ${userId} szamara`,
        );
      }
    });

    /**
     * ES A BELSOS HIVO MINDENT LAT -- ismert pozitiv kontroll a SZUROre magara.
     *
     * Enelkul mind a harom fenti allitas zold lenne egy olyan epitotol is, ami
     * MINDENKINEK ures halmazt ad: a ket "latja" allitas bukna ugyan, de azokat
     * konnyu a fixturara fogni. Ez a sor megmondja, hogy a szuro KEPES mindent
     * atengedni, tehat a szukites tenyleg szukites.
     */
    it("KONTROLL: a belsos hivo mind a hat sort latja", async () => {
      const { list } = assetListWheres({ kind: "internal" }, [], {}, {});

      assert.equal((await latottEszkozok(list)).length, 6);
    });
  },
);
