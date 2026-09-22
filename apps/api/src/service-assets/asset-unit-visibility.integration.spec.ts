import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { assignedUnitIdsFor } from "../service-jobs/assigned-units.query.js";
import {
  assetListWheres,
  ServiceAssetsRepository,
} from "./service-assets.repository.js";

const repository = new ServiceAssetsRepository();

/**
 * A FIXTURA-SOR AZONOSITOJA, LEKERDEZVE -- NEM ELTETT VALTOZOBOL.
 *
 * A `findFirstOrThrow` itt MERES is: ha a fixtura-sor hianyozna, a negy alabbi
 * allitas nem CSENDBEN lenne zold, hanem megallna. Egy eltett azonosito ezt nem
 * adna meg, mert a `before` horog bukasa utan is a regi erteket hordozna.
 */
async function kroEszkozId(): Promise<string> {
  const row = await prisma.asset.findFirstOrThrow({
    where: { assetNumber: `${PREFIX}-KRO-1` },
    select: { id: true },
  });
  return row.id;
}

async function kroEszkozToken(): Promise<string> {
  const row = await prisma.asset.findFirstOrThrow({
    where: { assetNumber: `${PREFIX}-KRO-1` },
    select: { qrToken: true },
  });
  return row.qrToken;
}

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
let dokumentumId = "";

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

/**
 * AZ `egysegId` MAR NEM `string | null` -- 2026-09-22 OTA MINDEN HIVAS VALODI
 * ERTEKKEL HIV. A helyszin nelkuli hivast a fordito ELUTASITANA: az
 * `Asset.departmentId` a sema szigoritasa ota kotelezo, es a Prisma kliens
 * tipusa ezt koveti.
 */
async function eszkoz(utotag: string, egysegId: string) {
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
       * A KOD ITT HAROM KARAKTER, DE EZ MA MAR CSAK A FIXTURE VALASZTASA:
       * `WorksheetDepartment.code` tipusa 2026-09-23 ota `@db.VarChar(5)`,
       * harom karakter csak beleferne, nem hatar.
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
      /*
        A `NINCS-EGYSEG` HELYSZIN NELKULI ESZKOZT 2026-09-22-IG ITT HOZTUK
        LETRE, es lejjebb ket allitas bizonyitotta, hogy egyik egyseg-hatokoru
        felhasznalonak sem latszik. A `20260922210000_department_required`
        migracio ota egy ilyen sor MEG NEM IS JOHET LETRE -- lasd
        `asset-department-required.integration.spec.ts`, ami mostantol az
        ADATBAZISON meri ugyanezt a garanciat. A ket lentebbi, EGYIK MAI SZAM
        (6) a maradek OT eszkozre valtozott.
      */

      /*
        EGY DOKUMENTUM A KRO ESZKOZON -- a harom dokumentum-uthoz.

        A FAJTA `MANUAL`, es ez nem izles: a `scopeMaySeeDocumentType` szerint a
        partner csak a WARRANTY, MANUAL es PHOTO fajtat latja. Egy `OTHER`
        fajtaju sor mellett mind a hat alabbi allitas zold lenne a
        helyszin-tengely NELKUL is -- a fajta-szuro zarna ki, nem a helyszin.

        A `thumbnail` es a `content` azert all rajta, mert a ket olvaso ut a
        HIANYUKRA is `null`-t ad: enelkul a POZITIV kontrollok nem tudnanak
        atmenni, es akkor a tagadasok semmit nem bizonyitananak.
      */
      const kroSor = await prisma.asset.findFirstOrThrow({
        where: { assetNumber: `${PREFIX}-KRO-1` },
        select: { id: true },
      });
      const dok = await prisma.assetDocument.create({
        data: {
          assetId: kroSor.id,
          type: "MANUAL",
          fileName: `${PREFIX}-kezikonyv.pdf`,
          contentType: "application/pdf",
          sizeBytes: 3,
          sha256: "a".repeat(64),
          content: Buffer.from([1, 2, 3]),
          thumbnail: Buffer.from([4, 5, 6]),
        },
        select: { id: true },
      });
      dokumentumId = dok.id;
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

      // OT, nem hat: a `NINCS-EGYSEG` sor 2026-09-22 ota mar nem johet letre
      // (lasd a fixtura fejenel allo jegyzetet).
      assert.equal(csakUgyfel.length, 5, "a puszta ugyfel-szuro MINDENT hoz");
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
     * === AZ INDOK BALAZSE, ES KET MONDATA EGYUTT ADJA KI ===
     *
     *   2026-09-21 14:34:07   "a partner azokat az eszkozoket latja, aminek a
     *                          helyszine HOZZA van rendelve"
     *   2026-09-22 07:46:59   "akkor semmit se lasson"
     *
     * Egy helyszin nelkuli sor helyszine SENKIHEZ nincs hozzarendelve, tehat az
     * elso mondat szerint nem latszik. NEM KIVETELT CSINALUNK, HANEM A SZABALYT
     * ALKALMAZZUK EGY HATARESETRE -- es ez a kulonbseg szamit, mert egy kivetelt
     * a kovetkezo olvaso megkerdojelez, egy hatareset alkalmazasat nem.
     *
     * === A KET TEVEDES ARA NEM EGYFORMA, ES AZ ELSO ALAKOM TOBBET ALLITOTT ===
     *
     * ITT KORABBAN AZ ALLT, hogy a "nem latszik" iranyu tevedes HANGOS, mert a
     * partner szol, hogy hianyzik valami. EZ GYENGEBB, MINT AHOGY HANGZIK, es
     * acrobot szukitette (2026-09-22 11:04): a partner csak akkor szol, ha
     * ESZREVESZI a hianyt -- egy eszkoz, amit sosem latott, nem hianyzik neki.
     *
     * A HELYES ALLITAS TEHAT NEM AZ, HOGY HANGOS, HANEM HOGY A KET TEVEDES KOZUL
     * EZ AZ, AMELYIK NEM SZIVARGAS. Ha a sor lathato lenne, egy olyan eszkoz
     * menne at a szuron, ami semmilyen helyszinhez nem tartozik, es a szabaly
     * kivetelt kapna, amit kesobb senki nem ert.
     *
     * === EZ AZ ALLITAS VOLT AZ ORZO -- ES A GARANCIA MASHOVA KOLTOZOTT ===
     *
     * Az elozo szakaszok azt magyarazzak, MIERT fontos, hogy a helyszin
     * nelkuli eszkoz ne szivarogjon at az egyseg-hatokoru olvasason. Az itt
     * korabban allo allitas ezt EGY VALODI, LEKERDEZHETO sorral bizonyitotta:
     * letrehozott egy helyszin nelkuli eszkozt, es megmerte, hogy egyik
     * egyseg-hatokoru felhasznalonak sem jott vissza.
     *
     * 1. MIT BIZONYITOTT: hogy a `departmentId: { in: [...] }` szures nem
     *    engedi at a `NULL` helyszinu sort -- meg akkor sem, ha az adott
     *    ugyfelhez tartozik.
     * 2. MELYIK MIGRACIO TETTE FOLOSLEGESSE: `20260922210000_department_required`
     *    (Balazs dontese, message_id 1552018256280162385: "1 legyen
     *    kotelezo"). A migracio ota egy helyszin nelkuli `Asset` sor
     *    FIZIKAILAG nem johet letre -- ezt a sort korabban IDE, egy
     *    `prisma.asset.create({..., departmentId: null})` hivassal hoztuk
     *    letre, es az a hivas ma mar `NOT NULL` megsertessel utasitodna el.
     * 3. MELYIK ALLITAS ORZI MOSTANTOL UGYANEZT: nem a lekerdezes, hanem a
     *    tabla -- lasd `asset-department-required.integration.spec.ts`,
     *    "egy helyszín NÉLKÜLI eszközt az adatbázis elutasít". Az a fajl a
     *    garanciat egy szinttel MELYEBBEN meri: nem azt, hogy egy ilyen sor
     *    rejtve marad, hanem hogy egy ilyen sor MEG SEM SZULETIK.
     *
     * A FENTI SZAMOK (108 / 6 / 4, mindharom `departmentId IS NULL: 0`) EZERT
     * NEM VESZTEK ERVENYUKET: azt bizonyitottak, hogy elesben MA sincs olyan
     * sor, amit a regi allitas idezett volna -- es ez az allapot a migracio
     * ota SZERKEZETILEG garantalt, nem csak MEGFIGYELT.
     */

    /**
     * ES A BELSOS HIVO MINDENT LAT -- ismert pozitiv kontroll a SZUROre magara.
     *
     * Enelkul mind a ket fenti allitas zold lenne egy olyan epitotol is, ami
     * MINDENKINEK ures halmazt ad: a fenti "latja" allitasok bukna ugyan, de
     * azokat konnyu a fixturara fogni. Ez a sor megmondja, hogy a szuro KEPES
     * mindent atengedni, tehat a szukites tenyleg szukites.
     *
     * OT, nem hat: a hatodik (helyszin nelkuli) sor 2026-09-22 ota mar nem
     * johet letre -- lasd a fajl elejen allo jegyzetet.
     */
    it("KONTROLL: a belsos hivo mind az öt sort latja", async () => {
      const { list } = assetListWheres({ kind: "internal" }, [], {}, {});

      assert.equal((await latottEszkozok(list)).length, 5);
    });

    /**
     * A KET BEOLVASO UT: ADATLAP AZONOSITO SZERINT, ES QR-KODROL.
     *
     * === MIERT KERULT IDE, ES MERT RESBOL ===
     *
     * Merve 2026-09-22 (meres/helyszin-tengely-terkep, futas 35752281226): ha a
     * KOZOS lathatosagi fuggvenybol kivesszuk a helyszin-tengelyt -- tehat MINDEN
     * vevo-hatokoru olvasast egyszerre erintve --, a teljes integracios
     * keszletbol 362 allitas fut le es PONTOSAN HAROM valt pirosra. Mind a harom
     * EBBEN a fajlban all, es mind a harom a LISTA-utat meri.
     *
     * A terkep tehat ez volt:
     *
     *     list                 MERVE     a fenti harom allitas
     *     detail (id szerint)  NINCS     a meglevo allitasai a TULAJDONT merik
     *     detailByQrToken      NINCS     csak FORRAS-olvaso allitas all rajta
     *     detailByLabelCode    NINCS     -- kulon korben potolva (#990)
     *
     * ES A HAROM "NINCS" NEM A KERDES TULAJDONSAGA: a `detail` utat a
     * partner-scope integracios spec TENYLEG hivja vevo-hatokorrel, csak az az
     * allitas a MASIK VEVO eszkozet keri -- tehat a tulajdon-tengely is kizarja.
     * Ugyanaz az alak, mint a matricakod-uton volt.
     *
     * === MIERT A REPOSITORY, ES NEM A WHERE-EPITO ===
     *
     * A fenti harom allitas a `where` objektumot adja at a Prismanak. Itt a
     * REPOSITORY metodusat hivom, mert a `detailByQrToken` nem visel exportalt
     * where-epitot -- es mert a kerdes az, hogy a HIVO mit kap, nem az, hogy a
     * szuro hogy nez ki.
     *
     * === MIERT NEGY ALLITAS, ES NEM EGY CIKLUS ===
     *
     * Egy ciklusban futtatott keszlet egyetlen NEVET adna, es akkor egy
     * kalibracio nem tudna megmondani, MELYIK olvaso romlott el. A ket ut
     * ugyanazt a fuggvenyt hivja, de ket kulon hivohelyen -- es egy kesobbi
     * szerkesztes az egyiket elviheti a masik nelkul.
     */
    /**
     * NEGY ALLITAS, NEM KETTO -- ES A SZETVALASZTAS NEM RENDSZERETET.
     *
     * Mindegyik KULON rontassal elsuthato: egy olvaso, ami MINDENKINEK nullat
     * ad, a ket POZITIV allitast dontene pirosra es a ket TAGADOT zolden
     * hagyna. Ha a par egy `it`-ben allna, a futtato egyetlen nevet irna ki, es
     * a kalibracio nem tudna megmondani, melyik fele romlott el.
     *
     * A SZOMSZED FAJL UGYANIGY ALL (`asset-label.integration.spec.ts` 8. es 9.
     * allitasa): a pozitiv kontroll sajat nevet kap.
     */
    it("az ADATLAP megnyilik a SAJAT helyszinen allo eszkozre", async () => {
      const eszkozId = await kroEszkozId();

      const lap = await repository.detail(
        eszkozId,
        { kind: "customer", customerId: ugyfelId },
        await assignedUnitIdsFor(kroFelhasznaloId),
      );

      assert.equal(lap?.id, eszkozId);
    });

    it("az ADATLAP NEM nyilik meg a kiosztott helyszineken kivul allo eszkozre", async () => {
      const eszkozId = await kroEszkozId();

      /*
        A VALASZ `null`, NEM DOBAS: a tarolo `AssetDetail | null` tipust ad, es a
        "nem talaltam" meg a "nincs jogod" kulonbseget SZANDEKOSAN nem teszi meg
        -- az a hivo dolga. Egy `assert.rejects` itt akkor is zold lenne, ha a
        metodus barmilyen MAS okbol dobna.
      */
      const lap = await repository.detail(
        eszkozId,
        { kind: "customer", customerId: ugyfelId },
        await assignedUnitIdsFor(akvFelhasznaloId),
      );

      assert.equal(lap, null);
    });

    it("a QR-KOD megnyitja a SAJAT helyszinen allo eszkozt", async () => {
      const token = await kroEszkozToken();

      const lap = await repository.detailByQrToken(
        token,
        { kind: "customer", customerId: ugyfelId },
        await assignedUnitIdsFor(kroFelhasznaloId),
      );

      assert.ok(lap, "a sajat helyszin eszkoze nem nyilt meg a QR-kodrol");
    });

    it("a QR-KOD NEM nyitja meg a kiosztott helyszineken kivul allo eszkozt", async () => {
      const token = await kroEszkozToken();

      const lap = await repository.detailByQrToken(
        token,
        { kind: "customer", customerId: ugyfelId },
        await assignedUnitIdsFor(akvFelhasznaloId),
      );

      assert.equal(lap, null);
    });

    /**
     * A HAROM DOKUMENTUM-UT, ES A HARMADIK IR.
     *
     * Ugyanaz a fuggveny all mogottuk (`assetVisibilityForAndBranch`), ugyanazon
     * a ponton -- de a bekotesuk HAROM KULON hivohely, es egy kesobbi atalakitas
     * egyetlen helyrol veheti le. Ezert kap mindegyik sajat allitast: ha egy
     * kozos allitas allna itt, a hat ut kozul ot csendben elszakadhatna.
     *
     * A `setDocumentCaption` KULON is szamit: az IR. Egy hianyzo szures ott nem
     * csak lathatova tesz valamit, hanem egy MASIK helyszin dokumentumat irja at.
     */
    it("a BELYEGKEP megjon a SAJAT helyszinen allo eszkoz dokumentumarol", async () => {
      const eszkozId = await kroEszkozId();

      const kep = await repository.documentThumbnail(
        eszkozId,
        dokumentumId,
        { kind: "customer", customerId: ugyfelId },
        await assignedUnitIdsFor(kroFelhasznaloId),
      );

      assert.ok(kep, "a sajat helyszin dokumentumanak belyegkepe hianyzik");
    });

    it("a BELYEGKEP NEM jon meg a kiosztott helyszineken kivulrol", async () => {
      const eszkozId = await kroEszkozId();

      const kep = await repository.documentThumbnail(
        eszkozId,
        dokumentumId,
        { kind: "customer", customerId: ugyfelId },
        await assignedUnitIdsFor(akvFelhasznaloId),
      );

      assert.equal(kep, null);
    });

    it("a LETOLTES megy a SAJAT helyszinen allo eszkoz dokumentumara", async () => {
      const eszkozId = await kroEszkozId();

      const sor = await repository.document(
        eszkozId,
        dokumentumId,
        { kind: "customer", customerId: ugyfelId },
        await assignedUnitIdsFor(kroFelhasznaloId),
      );

      assert.ok(sor, "a sajat helyszin dokumentuma nem tolthető le");
    });

    it("a LETOLTES NEM megy a kiosztott helyszineken kivulrol", async () => {
      const eszkozId = await kroEszkozId();

      const sor = await repository.document(
        eszkozId,
        dokumentumId,
        { kind: "customer", customerId: ugyfelId },
        await assignedUnitIdsFor(akvFelhasznaloId),
      );

      assert.equal(sor, null);
    });

    /**
     * AZ IRO UT: A DARABSZAM MONDJA MEG, HOGY TORTENT-E VALAMI.
     *
     * A `setDocumentCaption` a MODOSITOTT SOROK szamat adja vissza, tehat itt a
     * nulla nem "nem talaltam" alakban jelenik meg, hanem merheto ertekkent.
     * Ez erosebb, mint egy `null`: megmondja, hogy az iras EL SEM INDULT.
     */
    it("a MEGJEGYZES-IRAS atmegy a SAJAT helyszinen allo eszkoz dokumentumara", async () => {
      const eszkozId = await kroEszkozId();

      const darab = await repository.setDocumentCaption(
        eszkozId,
        dokumentumId,
        "sajat helyszin",
        { kind: "customer", customerId: ugyfelId },
        await assignedUnitIdsFor(kroFelhasznaloId),
      );

      assert.equal(darab, 1);
    });

    it("a MEGJEGYZES-IRAS NEM megy at a kiosztott helyszineken kivulrol", async () => {
      const eszkozId = await kroEszkozId();

      const darab = await repository.setDocumentCaption(
        eszkozId,
        dokumentumId,
        "idegen helyszin",
        { kind: "customer", customerId: ugyfelId },
        await assignedUnitIdsFor(akvFelhasznaloId),
      );
      assert.equal(darab, 0);

      // ES A SOR TENYLEG ERINTETLEN: a darabszam onmagaban nem bizonyitja, hogy
      // nem irtunk. Egy alak, ami IR es 0-t ad vissza, a fenti sorra zold lenne.
      const sor = await prisma.assetDocument.findUniqueOrThrow({
        where: { id: dokumentumId },
        select: { caption: true },
      });
      assert.notEqual(sor.caption, "idegen helyszin");
    });
  },
);
