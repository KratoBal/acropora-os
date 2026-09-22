import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { AssetLabelUnavailableError } from "./service-assets.repository.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";
import { AssetListQueryDto } from "./dto/asset.dto.js";
import type { CreateAssetDto, UpdateAssetDto } from "./dto/asset.dto.js";

/**
 * AZ ELŐRE NYOMTATOTT MATRICÁK KÉSZLETE, ADATBÁZISON.
 *
 * MIÉRT NEM ELÉG AZ EGYSÉGTESZT. Amit itt mérünk, azt a TÁBLA őrzi, nem a kód:
 * két `CHECK` megkötés és két egyedi index. Egy egységteszt legfeljebb azt
 * tudná megmutatni, hogy a szolgáltatás nem küld rossz sort -- azt nem, hogy
 * egy migráció, egy háttérmunka vagy egy későbbi végpont sem tud.
 *
 * Ezért minden állítás NYERS SQL-lel kerüli meg az alkalmazást ott, ahol a
 * tábla megkötését méri: ha az alkalmazáson át írnánk, a saját validációnkat
 * mérnénk, és pont az maradna fedezetlen, ami miatt a megkötés a táblán áll.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "ITLBL";
const repository = new ServiceAssetsRepository();

/** Egy szabad tesztkód-tartomány, hogy más suite-tal ne ütközzön. */
const CODE_A = "Z9001";
const CODE_B = "Z9002";
const CODE_C = "Z9003";
/**
 * A HATOKOR-MERES SAJAT KODJA, SZANDEKOSAN A KESZLETEN KIVUL.
 *
 * A `CODE_A`..`CODE_F` kodokra keszlet-allitasok epulnek (mi szabad, mi
 * foglalt). Ha a hatokor-meres is azokbol venne egyet, minden ilyen allitas
 * szamat mozditana -- es a kovetkezo olvaso nem tudna eldonteni, melyik
 * valtozas okozta.
 */
const HATOKOR_KOD = "Z9100";
/**
 * AZ UTOLAGOS FELVITELHEZ KET SAJAT KOD, es ez nem ovatoskodas: a fenti harom
 * allapota a suite-on BELUL valtozik (a `CODE_C` peldaul lefoglaltta valik, es
 * egy kesobbi allitas EPP arra epul, hogy nem szabad). Ha az utolagos felvitel
 * ugyanazokat mozgatna, a ket teszt-csoport egymas merceit irna at.
 */
const CODE_D = "Z9004";
const CODE_E = "Z9005";

/**
 * A KERESO ALLITASANAK SAJAT KODJA, UGYANABBOL AZ OKBOL, amit a fenti jegyzet
 * kimond: a `CODE_D` allapota a suite-on BELUL valtozik (lefoglalttá valik), es
 * ha a kereso-allitas ugyanazt mozgatna, a ket teszt-csoport egymas merceit
 * irna at.
 */
const CODE_F = "Q7431";

let customerId = "";
/**
 * A HATOKOR-MERESEK ESZKOZE SZALLITOI TULAJDONU, A VEVO HELYSZINEN -- ES EZ A
 * VALOS ALAK, nem kenyelem.
 *
 * A `create` es az `update` is NULLARA kenyszeriti a `departmentId` mezot
 * vevo-tulajdonu soron, tehat egy vevo-tulajdonu eszkoznek SOHA nincs
 * helyszine. Eles adaton (2026-09-22, acrobot merese) 83 eszkozbol 0
 * vevo-tulajdonu. Egy vevo-tulajdonu fixtura tehat olyan allapotot merne, ami
 * a valosagban nem fordul elo -- es 2026-09-22 ota lathatatlan is lenne.
 */
let szallitoId = "";
let helyszinId = "";
/**
 * MASODIK HELYSZIN, UGYANANNAL A VEVONEL -- CSAK A HELYSZIN-TENGELYHEZ.
 *
 * A tulajdon-tengelyt egy MASIK vevo meri (lentebb). Ez a sor azert kell,
 * hogy a helyszin-tengelynek legyen olyan bemenete, ahol MINDEN MAS
 * feltetel IGAZ: ugyanaz a vevo, ugyanaz az eszkoz, es KIZAROLAG a kiosztott
 * helyszinek listaja ter el. Eszkoz nem all rajta, es nem is kell: a szuro
 * a KERO listajan dol el, nem azon, mi van a helyszinen.
 */
let masikHelyszinId = "";
let actorUserId = "";

function createInput(over: Partial<CreateAssetDto> = {}): CreateAssetDto {
  return {
    ownerType: "CUSTOMER",
    ownerId: customerId,
    kind: "EQUIPMENT",
    name: `${PREFIX} teszteszköz`,
    ...over,
  } as CreateAssetDto;
}

/**
 * A SUITE ALTAL LETREHOZOTT KOTEGEK, HOGY A TAKARITAS MEG TUDJA NEVEZNI OKET.
 *
 * MIERT KELL NYILVANTARTAS, ES MIERT NEM ELEG EGY ELOTAG: a `AssetLabelBatch`
 * soron nincs semmilyen megkulonbozteto mezo (se kod, se nev) -- csak az
 * idopont es a kert darabszam. Egyedul a hozza tartozo CIMKEK kotik ide, es
 * azok a takaritas elso lepesekent eltunnek.
 */
const letrehozottKotegek: string[] = [];

async function removeLeftovers() {
  /**
   * A KOTEGEK A CIMKEK UTAN, DE AZ AZONOSITOIKAT A CIMKEK ELOTT KELL BESZEDNI.
   *
   * MERVE 2026-09-15 (verify job 104337824776, ket sor-pillanatkep a takaritas
   * elott es utan): ez a suite EGY `AssetLabelBatch` sort hagyott maga utan
   * minden futasban. A ket koteget letrehozo teszt a sajat vegen takarit; a
   * harmadik -- a szabad keszletet mero, `importBatch([CODE_B, CODE_C])` --
   * nem, es nem is tudna: a koteg azonositojat el sem tette.
   *
   * ES AMIERT NEM VESZI ESZRE SENKI: az `AssetLabel.batchId` `SetNull`, tehat
   * a cimkek torlese nem viszi a koteget, hanem ARVAN hagyja. Semmi nem hibazik,
   * a suite zold marad, es a sor orokre ott all.
   */
  const kotegek = await prisma.assetLabel.findMany({
    where: {
      code: {
        in: [CODE_A, CODE_B, CODE_C, CODE_D, CODE_E, CODE_F, HATOKOR_KOD],
      },
    },
    select: { batchId: true },
  });
  const kotegIdk = [
    ...new Set(
      [...kotegek.map((sor) => sor.batchId), ...letrehozottKotegek].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];

  await prisma.assetLabel.deleteMany({
    where: {
      code: {
        in: [CODE_A, CODE_B, CODE_C, CODE_D, CODE_E, CODE_F, HATOKOR_KOD],
      },
    },
  });

  // CSAK AZ ARVAKAT, es ez nem ovatoskodas: ha egy koteghez idegen cimke is
  // tartozna, a torlese azt is elvinne. A `labels: { none: {} }` feltetel a
  // sajat sorainkra szukit anelkul, hogy a kotegrol barmit feltetelezne.
  if (kotegIdk.length > 0)
    await prisma.assetLabelBatch.deleteMany({
      where: { id: { in: kotegIdk }, labels: { none: {} } },
    });
  await prisma.asset.deleteMany({
    where: { assetNumber: { startsWith: PREFIX } },
  });
  await prisma.asset.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  // A SZALLITOI TULAJDONU SOR SEM A VEVOT NEM VISELI: a HELYSZINEN at kell
  // megtalalni, kulonben a helyszin torlese `Asset_departmentId_fkey` hibaval
  // all meg -- es a takaritas bukasa a KOVETKEZO futast viszi el.
  await prisma.asset.deleteMany({
    where: {
      department: { customer: { customerNumber: { startsWith: PREFIX } } },
    },
  });
  // A HELYSZIN AZ ESZKOZOK UTAN ES A VEVO ELOTT (`Asset.departmentId` Restrict),
  // a szallito szinten az eszkozok utan (`Asset.supplierId`).
  await prisma.worksheetDepartment.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  await prisma.supplier.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: PREFIX.toLowerCase() } },
  });
}

describe(
  "előre nyomtatott matricák készlete",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      // A "refuse" ag NEM ugyanaz, mint a "skip": ott a hivo KERTE az
      // integracios futast, es hianyzik hozza valami. Csendben kihagyni azt
      // jelentene, hogy a CI zolden all egy meresre, ami el sem indult.
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}-1`,
          displayName: `${PREFIX} vevő`,
          type: "COMPANY",
        },
        select: { id: true },
      });
      customerId = customer.id;

      /**
       * VALODI FELHASZNALO KELL, NEM URES SZTRING.
       *
       * Az `Asset.createdById` idegen kulcs a `User` tablara. Az ures sztring
       * NEM null: a beszuras `Asset_createdById_fkey` megsertesevel hasal el,
       * es a hibauzenet a `prisma.asset.create()` hivast nevezi meg, nem a
       * fixturat, ami okozta. Merve a CI-ban 2026-09-02: negy allitas bukott
       * el emiatt, MIELOTT barmelyik eljutott volna a mert viselkedeshez.
       */
      const user = await prisma.user.create({
        data: {
          email: `${PREFIX.toLowerCase()}-actor@example.invalid`,
          displayName: `${PREFIX} aktor`,
          role: "SERVICE",
        },
        select: { id: true },
      });
      actorUserId = user.id;

      const szallito = await prisma.supplier.create({
        data: { code: `${PREFIX}S`.slice(0, 12), name: `${PREFIX} szállító` },
        select: { id: true },
      });
      szallitoId = szallito.id;

      const helyszin = await prisma.worksheetDepartment.create({
        data: { customerId, code: "LBL", name: `${PREFIX} helyszín` },
        select: { id: true },
      });
      helyszinId = helyszin.id;

      const masikHelyszin = await prisma.worksheetDepartment.create({
        data: { customerId, code: "LB2", name: `${PREFIX} másik helyszín` },
        select: { id: true },
      });
      masikHelyszinId = masikHelyszin.id;

      /*
        SAJAT SOR A KET HATOKOR-ALLITASHOZ, ES KULON A TOBBI TESZTTOL.

        A hatokor-meresnek SZALLITOI tulajdonu, HELYSZINEN allo eszkoz kell:
        vevo-tulajdonu sornak a kod nem enged helyszint adni, helyszin nelkul
        pedig a partner 2026-09-22 ota nem latja. A tobbi teszt viszont a
        vevo-tulajdonu alakra epul (szabad keszlet, darabszamok, szerkeszto ag),
        ezert AZOKAT nem irom at: ez a sor KULON all, sajat koddal, a
        CODE_A..CODE_F keszleten KIVUL.
      */
      const hatokorEszkoz = await prisma.asset.create({
        data: {
          assetNumber: `${PREFIX}-HATOKOR`,
          name: `${PREFIX} hatókör-eszköz`,
          supplierId: szallitoId,
          departmentId: helyszinId,
        },
        select: { id: true },
      });
      await prisma.assetLabel.create({
        data: {
          code: HATOKOR_KOD,
          assetId: hatokorEszkoz.id,
          assignedAt: new Date(),
        },
      });
    });

    after(async () => {
      await removeLeftovers();
      await prisma.$disconnect();
    });

    it("AssetLabel_code_shape_check: elutasít egy rossz alakú kódot", async () => {
      await assert.rejects(
        () =>
          prisma.$executeRawUnsafe(
            `INSERT INTO "AssetLabel" ("id", "code") VALUES ('${PREFIX}-bad', 'ROSSZ')`,
          ),
        (error: unknown) => {
          // A HIBA A VÁRT MEGKÖTÉST NEVEZZE MEG. Egy tetszőleges elutasítás
          // (például NOT NULL) ugyanígy teljesítené a `rejects` állítást, és
          // közben a shape-check akár hiányozhatna is.
          assert.match(String(error), /AssetLabel_code_shape_check/);
          return true;
        },
      );
    });

    it("AssetLabel_code_shape_check: átengedi a kártyán álló alakot", async () => {
      // ISMERT POZITÍV KONTROLL a fenti elutasításhoz. Enélkül egy megkötés, ami
      // MINDENT elutasít, ugyanúgy zöldre vinné az előző állítást.
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AssetLabel" ("id", "code") VALUES ('${PREFIX}-ok', '${CODE_A}')`,
      );
      const row = await prisma.assetLabel.findUnique({
        where: { code: CODE_A },
      });
      assert.equal(row?.code, CODE_A);
      assert.equal(row?.assetId, null);
    });

    it("AssetLabel_assignment_pairing_check: a fél hozzárendelés nem áll meg", async () => {
      const asset = await repository.create(createInput(), actorUserId);
      await assert.rejects(
        () =>
          prisma.$executeRawUnsafe(
            `INSERT INTO "AssetLabel" ("id", "code", "assetId") VALUES ('${PREFIX}-half', '${CODE_B}', '${asset.id}')`,
          ),
        (error: unknown) => {
          assert.match(String(error), /AssetLabel_assignment_pairing_check/);
          return true;
        },
      );
    });

    it("a szabad készlet AKÁRHÁNY sort megenged, hozzárendeltből eszközönként egyet", async () => {
      // A NULL nem egyenlő önmagával, ezért az `assetId` egyedi indexe a szabad
      // sorokra nem korlátoz -- ez a viselkedés a készlet MŰKÖDÉSI feltétele,
      // nem mellékhatás, ezért áll itt állításként.
      letrehozottKotegek.push(
        (await repository.importBatch([CODE_B, CODE_C])).batchId,
      );
      const free = await repository.listFreeLabels(100);
      const codes = free.map((row) => row.code);
      assert.ok(codes.includes(CODE_B));
      assert.ok(codes.includes(CODE_C));
    });

    it("egy kód nem kerülhet két eszközre", async () => {
      const first = await repository.create(
        createInput({ labelCode: CODE_C }),
        actorUserId,
      );
      // POZITÍV KONTROLL: az elsőre TÉNYLEG rákerült. Enélkül a lenti elutasítás
      // attól is teljesülne, hogy a kód sosem volt lefoglalva.
      const bound = await prisma.assetLabel.findUnique({
        where: { code: CODE_C },
        select: { assetId: true, assignedAt: true },
      });
      assert.equal(bound?.assetId, first.id);
      assert.ok(bound?.assignedAt);

      await assert.rejects(
        () =>
          repository.create(createInput({ labelCode: CODE_C }), actorUserId),
        AssetLabelUnavailableError,
      );
    });

    it("a hozzárendelt matrica kikerül a szabad készletből", async () => {
      const free = await repository.listFreeLabels(100);
      const codes = free.map((row) => row.code);
      assert.ok(!codes.includes(CODE_C), "a lefoglalt kód nem lehet szabad");
      // ISMERT POZITÍV: ugyanaz a lekérdezés MEGTALÁL egy szabadot. Egy üres
      // eredmény önmagában is kielégítené a fenti tagadást.
      assert.ok(codes.includes(CODE_A), "a szabad kód látszik a készletben");
    });

    it("nem létező kódra a felvitel elutasít, és eszköz sem keletkezik", async () => {
      const before = await prisma.asset.count({
        where: { assetNumber: { startsWith: "ESZK" }, customerId },
      });
      await assert.rejects(
        () =>
          repository.create(createInput({ labelCode: "Z9999" }), actorUserId),
        AssetLabelUnavailableError,
      );
      const after = await prisma.asset.count({
        where: { assetNumber: { startsWith: "ESZK" }, customerId },
      });
      // A TRANZAKCIÓ EGYBEN BUKIK: a lényeg nem az elutasítás, hanem hogy nem
      // marad egy matrica nélküli eszköz, amiről a szerelő azt hinné, kész.
      assert.equal(after, before);
    });

    /**
     * A TULAJDON-ELLENORZES, ADATBAZISON.
     *
     * A `label-scan-scope.spec.ts` azt orzi, hogy a szuro OTT ALL a kodban --
     * ez azt meri, hogy HAT is. A ketto nem helyettesiti egymast: az elso
     * fejlesztes kozben sul el, a masodik bizonyit.
     */
    it("a saját partner MEGTALÁLJA az eszközét a matricakódról", async () => {
      // ISMERT POZITIV KONTROLL a lenti tagadashoz. Enelkul egy olyan
      // lekerdezes is atmenne, ami SENKINEK nem ad vissza semmit.
      const found = await repository.detailByLabelCode(
        HATOKOR_KOD,
        { kind: "customer", customerId },
        [helyszinId],
      );
      assert.ok(found, "a saját eszköz látszik a saját hatókörben");
      // A KOD ALAPJAN TALALT ESZKOZ TENYLEG AZ, AMIRE A MATRICA KERULT.
      // Enelkul az allitas beerne barmelyik eszkozzel, amit a lekerdezes ad.
      const label = await prisma.assetLabel.findUnique({
        where: { code: HATOKOR_KOD },
        select: { assetId: true },
      });
      assert.equal(found.id, label?.assetId);
    });

    it("MÁS partner NEM találja meg ugyanazt a kódot", async () => {
      const masik = await prisma.customer.create({
        data: {
          customerNumber: `${PREFIX}-2`,
          displayName: `${PREFIX} másik vevő`,
          type: "COMPANY",
        },
        select: { id: true },
      });
      /*
        UGYANAZ A HELYSZIN-LISTA MEGY AT, MINT A POZITIV ESETBEN, es ez
        szandekos: igy az EGYETLEN dolog, ami kizarhatja a sort, a TULAJDON.
        Ures listaval ez az allitas akkor is zold lenne, ha a tulajdon-tengely
        egyaltalan nem letezne.
      */
      const found = await repository.detailByLabelCode(
        HATOKOR_KOD,
        { kind: "customer", customerId: masik.id },
        [helyszinId],
      );
      assert.equal(found, null, "más partner eszköze nem érhető el a kódról");
    });

    /**
     * A HELYSZIN-TENGELY, KULON ALLITASSAL -- ES MERT RESBOL, NEM ELOVIGYAZATBOL.
     *
     * MERVE 2026-09-22 (meres/matricakod-helyszin-tengely, futas 35749047465):
     * ha a `detailByLabelCode` hivohelyen a vevo-agbol KIVESSZUK a
     * helyszin-tengelyt es a tulajdont meghagyjuk, a teljes integracios
     * keszletbol 362 allitas fut le es NULLA valt pirosra. Vagyis ezt a
     * tengelyt ezen az uton EGYETLEN allitas sem merte.
     *
     * A TUKOR-MERES UGYANAZON A NAPON (futas 35745729290) a masik iranyt
     * mutatta: a TULAJDON-tengely elvetele PONTOSAN EGY pirosat adott, nev
     * szerint a felette allot. Ket azonos alaku rontas, ket ellentetes
     * eredmeny -- a kulonbseg maga a lelet.
     *
     * MIERT NEM VETTE ESZRE A KET FENTI ALLITAS: mindketto UGYANAZT a
     * helyszin-listat adja at, es abban benne van az eszkoz helyszine. A
     * helyszin-tengely tehat mindkettonel IGAZ, akarmit csinal -- egy
     * allitas, ami csak olyan bemenetet lat, ahol a feltetel amugy is
     * teljesul, a feltetel LETEZESET meri, nem a hatasat.
     *
     * EZ A BEMENET AZ, AHOL MINDEN MAS FELTETEL IGAZ: ugyanaz a vevo (tehat a
     * tulajdon-tengely atengedi), ugyanaz az eszkoz es ugyanaz a kod -- es
     * KIZAROLAG a kiosztott helyszinek listaja mas. Ha ez pirosodik, a
     * helyszin volt az egyetlen ok.
     */
    it("a saját partner sem találja meg, ha az eszköz helyszíne NINCS a kiosztott helyszínei között", async () => {
      // ISMERT POZITIV KONTROLL A BEMENETRE: a ket helyszin tenyleg KET
      // kulonbozo sor. Ha egybeesnenek, ez az allitas a felette allo pozitiv
      // esetet ismetelne meg, es zold lenne a tengely nelkul is.
      assert.notEqual(masikHelyszinId, helyszinId);

      const found = await repository.detailByLabelCode(
        HATOKOR_KOD,
        { kind: "customer", customerId },
        [masikHelyszinId],
      );
      assert.equal(
        found,
        null,
        "a kiosztott helyszíneken kívül álló eszköz nem érhető el a kódról",
      );
    });

    /**
     * A MATRICA NELKUL FELVITT ESZKOZ MEGTALALHATO.
     *
     * Balazs dontese szerint a matrica a felvitelnel NEM kotelezo
     * (2026-09-02 19:24). Ebbol kovetkezik, hogy keletkezik egy halmaz, amit
     * valakinek vegig kell jarnia -- es egy szandekosan megengedett allapot
     * CSENDBEN halmozodik, ha semmi nem tudja megkerdezni. Ez az allitas azt
     * meri, hogy meg lehet.
     */
    /**
     * A MATRICAKOD UTOLAG IS FELVIHETO (Balazs kerese, 2026-09-16).
     *
     * MIERT ITT, ES NEM UJ FAJLBAN: ennek a suite-nak a SZANDEKA az, hogy a
     * matrica-keszlet allapotat ADATBAZISON merje, nem a kodon. Az utolagos
     * felvitel ugyanazt a ket sort mozgatja, ugyanazokkal a megkotesekkel --
     * egy kulon fajl ugyanazt allitana, csak masik nevvel, es a ket helyet
     * kesobb kulon kellene karbantartani.
     */
    describe("utólagos felvitel a szerkesztő ágon", () => {
      let eszkozId = "";

      /**
       * A SAJAT KODOK A KESZLETBE -- ES EZ A CI DERITETTE KI, NEM A HELYI FUTAS.
       *
       * Eloszor csak a KONSTANSOKAT vettem fel (`CODE_D`, `CODE_E`), es azt
       * hittem, ettol leteznek. Nem: ebben a suite-ban a kodok MAS TESZTEK
       * MELLEKHATASAKENT kerulnek a keszletbe (a `CODE_A` nyers SQL-lel egy
       * megkotes-allitasban, a `CODE_B`/`CODE_C` egy `importBatch` hivassal).
       * Az enyemek sehogy -- a sor nem letezett, es az elso allitasom
       * `undefined`-ot kapott `null` helyett.
       *
       * Ezert a sajat blokk a SAJAT bemenetet allitja elo, nem egy masik teszt
       * mellekhatasara tamaszkodik.
       */
      before(async () => {
        const { batchId } = await repository.importBatch([CODE_D, CODE_E]);
        letrehozottKotegek.push(batchId);
      });

      /** A friss verzio-belyeg: minden mentes elmozditja. */
      async function frissBelyeg(id: string): Promise<string> {
        const sor = await prisma.asset.findUniqueOrThrow({
          where: { id },
          select: { updatedAt: true },
        });
        return sor.updatedAt.toISOString();
      }

      async function mentes(
        id: string,
        mezok: Omit<UpdateAssetDto, "expectedUpdatedAt">,
      ) {
        return repository.update(
          id,
          { ...mezok, expectedUpdatedAt: await frissBelyeg(id) },
          actorUserId,
        );
      }

      it("matrica NÉLKÜL felvitt eszközre utólag felkerül a kód", async () => {
        const eszkoz = await repository.create(createInput(), actorUserId);
        eszkozId = eszkoz.id;

        // POZITÍV KONTROLL A KIINDULÁSRA: a kód TÉNYLEG szabad volt, és az
        // eszközön TÉNYLEG nem állt matrica. Enélkül a lenti állítás attól is
        // teljesülne, hogy a kód eleve ezen az eszközön állt.
        const elotte = await prisma.assetLabel.findUnique({
          where: { code: CODE_D },
          select: { assetId: true },
        });
        // A KET ALLITAS KULON, ES EZT IS A CI TANITOTTA MEG. Eloszor
        // `elotte?.assetId` allt itt egyetlen sorban -- egy HIANYZO sor
        // (`elotte === null`) ettol `undefined`-ot ad, ami "nincs
        // hozzarendelve"-nek latszik. A ket eset TEENDOJE mas: az egyikben a
        // kodot kell felvenni a keszletbe, a masikban a foglalast megnezni.
        assert.ok(elotte, "a kód létezik a készletben");
        assert.equal(elotte.assetId, null, "a kód induláskor szabad");
        assert.equal(
          await prisma.assetLabel.count({ where: { assetId: eszkozId } }),
          0,
          "az eszközön induláskor nincs matrica",
        );

        await mentes(eszkozId, { labelCode: CODE_D });

        const utana = await prisma.assetLabel.findUnique({
          where: { code: CODE_D },
          select: { assetId: true, assignedAt: true },
        });
        assert.equal(utana?.assetId, eszkozId);
        // AZ IDOPONT IS: a `AssetLabel_assignment_pairing_check` a fel
        // hozzarendelest amugy is elutasitana, de ha a megkotes valaha
        // lekerul, ez az allitas MEG mindig megfogja.
        assert.ok(utana?.assignedAt, "a hozzárendelés ideje is kitöltődik");
      });

      /**
       * AZ ADATLAP MEGMUTATJA, MELYIK MATRICA ALL AZ ESZKOZON.
       *
       * MIERT TARTOZIK EHHEZ A KORHOZ: a kodot eddig csak IRNI lehetett, egy
       * felulet sem mutatta meg. Amig csak felvitelkor lehetett megadni, ez nem
       * latszott hianynak -- az utolagos felvitel viszont CSERET is megenged,
       * es egy csere, amit a szerelo nem lat, egy MUKODO matricat ir felul
       * nemán. A szerkeszto urlap EBBOL tolti elo a mezot.
       */
      it("az adatlap visszaadja a felvitt kódot", async () => {
        const lap = await repository.detail(eszkozId, { kind: "internal" }, []);
        assert.equal(lap?.labelCode, CODE_D);
      });

      it("matrica nélküli eszközön a mező ÜRESEN marad, nem hibázik", async () => {
        // TESTVER-KONTROLL A FENTIHEZ: egy mindig kitoltott mezo ugyanugy
        // atmenne a fenti alliteson. Ez mondja ki, hogy a hianyt is jol adja
        // vissza -- es hogy a lekerdezes nem hasal el matrica nelkul.
        const masik = await repository.create(createInput(), actorUserId);
        const lap = await repository.detail(masik.id, { kind: "internal" }, []);
        assert.equal(lap?.labelCode, undefined);
      });

      /**
       * ES A LISTASOR IS VISSZAADJA, NEM CSAK AZ ADATLAP (2026-09-18).
       *
       * MIERT KULON ALLITAS, HOLOTT UGYANAZ A MEZO: a ket ut KET KULON
       * lekerdezesbol epul (`assetSummaryInclude` es `assetDetailInclude`), es
       * a lista sokaig NEM hozta a `label` relaciot. Egy adatlap-allitas tehat
       * ZOLD MARAD akkor is, ha a listarol eltunik a kod -- a felulet pedig ott
       * csendben elhagyna a sort.
       *
       * ES A KERESESSEL IS OSSZEFUGG: a lista `search` aga MA IS illeszkedik a
       * matricakodra. Ha a sor nem mutatja, a talalat feljon, es semmi nem
       * arulja el, MIRE illeszkedett.
       */
      it("a LISTASOR is visszaadja a felvitt kódot", async () => {
        const lista = await repository.list(
          Object.assign(new AssetListQueryDto(), {
            labelCode: CODE_D,
            status: "ALL" as const,
          }),
          { kind: "internal" },
          // `internal` -> az egyseg-lista nem sul el
          [],
        );

        const sor = lista.items.find((item) => item.id === eszkozId);
        assert.ok(sor, "a kódra szűrt lista tartalmazza az eszközt");
        assert.equal(sor.labelCode, CODE_D);
      });

      it("matrica nélküli eszköz LISTASORÁN a mező üres, nem hibázik", async () => {
        // TESTVER-KONTROLL, ugyanabbol az okbol, mint az adatlapnal: egy mindig
        // kitoltott mezo a fenti allitason ugyanugy atmenne.
        const masik = await repository.create(
          createInput({ name: `${PREFIX} listasor matrica nélkül` }),
          actorUserId,
        );

        const lista = await repository.list(
          Object.assign(new AssetListQueryDto(), {
            ownerId: customerId,
            ownerType: "CUSTOMER" as const,
            label: "without" as const,
            status: "ALL" as const,
          }),
          { kind: "internal" },
          // `internal` -> az egyseg-lista nem sul el
          [],
        );

        const sor = lista.items.find((item) => item.id === masik.id);
        assert.ok(sor, "a matrica nélküli eszköz benne van a listában");
        assert.equal(sor.labelCode, undefined);
      });

      it("másik kódra CSERÉL, és a régi visszakerül a szabad készletbe", async () => {
        await mentes(eszkozId, { labelCode: CODE_E });

        const regi = await prisma.assetLabel.findUnique({
          where: { code: CODE_D },
          select: { assetId: true, assignedAt: true },
        });
        const uj = await prisma.assetLabel.findUnique({
          where: { code: CODE_E },
          select: { assetId: true },
        });
        assert.equal(regi?.assetId, null, "a régi kód újra kiadható");
        assert.equal(
          regi?.assignedAt,
          null,
          "a felszabadításnál az időpont is törlődik, különben fél sor marad",
        );
        assert.equal(uj?.assetId, eszkozId);
        // EGY ESZKOZON EGY MATRICA: ha a felszabaditas elmaradna, ez KETTOT
        // adna -- es az `AssetLabel.assetId` egyedi indexe csak azt orzi, hogy
        // egy KOD ne kerulhessen ket eszkozre, ezt nem.
        assert.equal(
          await prisma.assetLabel.count({ where: { assetId: eszkozId } }),
          1,
        );
      });

      /**
       * A TESTVER-KONTROLL, ES ENELKUL A FENTI KETTO SEMMIT NEM ER.
       *
       * Egy mentes, ami MINDEN alkalommal leszedne a matricat, atmenne a fenti
       * ket alliteson is (ott mindig kuldunk kodot). Ez az egy allitas mondja
       * ki, hogy a HIANYZO mezo nem URES mezo.
       */
      it("a labelCode elhagyása ÉRINTETLENÜL hagyja a meglévő matricát", async () => {
        await mentes(eszkozId, { name: `${PREFIX} átnevezve` });

        const sor = await prisma.assetLabel.findUnique({
          where: { code: CODE_E },
          select: { assetId: true },
        });
        assert.equal(sor?.assetId, eszkozId, "a matrica a mentés után is áll");
      });

      /**
       * ES A LEGFONTOSABB: A FELSZABADITAS VISSZAGORDUL.
       *
       * A csere ket lepes (a regi elengedese, az uj foglalasa). Ha a masodik
       * elbukik es az elso MEGIS bent marad, az eszkoz matrica NELKUL all ugy,
       * hogy a regi kodja mar szabad -- vagyis egy fizikai matrica elveszik ket
       * eszkoz kozott, es errol semmi nem szol. Ezt csak az adatbazis tudja
       * megmutatni: a tranzakcio hatarat nem lehet egysegteszttel merni.
       */
      it("foglalt kódra a csere elbukik, és a régi matrica MARAD az eszközön", async () => {
        const masik = await repository.create(
          createInput({ labelCode: CODE_D }),
          actorUserId,
        );

        await assert.rejects(
          () => mentes(eszkozId, { labelCode: CODE_D }),
          AssetLabelUnavailableError,
        );

        const sajat = await prisma.assetLabel.findUnique({
          where: { code: CODE_E },
          select: { assetId: true },
        });
        assert.equal(
          sajat?.assetId,
          eszkozId,
          "a bukott csere után a régi matrica ott maradt",
        );
        const foglalt = await prisma.assetLabel.findUnique({
          where: { code: CODE_D },
          select: { assetId: true },
        });
        assert.equal(foglalt?.assetId, masik.id, "a másik eszközé érintetlen");
      });

      it("rossz ALAKÚ kódot a szerkesztő ág is elutasít", async () => {
        await assert.rejects(
          () => mentes(eszkozId, { labelCode: "nem-jo-alak" }),
          AssetLabelUnavailableError,
        );
      });
    });

    it("a matrica nélkül felvitt eszköz lekérdezhető", async () => {
      const matrica_nelkul = await repository.create(
        createInput({ name: `${PREFIX} matrica nélkül` }),
        actorUserId,
      );

      const nelkul = await repository.list(
        Object.assign(new AssetListQueryDto(), {
          label: "without" as const,
          ownerId: customerId,
          ownerType: "CUSTOMER" as const,
          status: "ALL" as const,
        }),
        { kind: "internal" },
        // `internal` -> az egyseg-lista nem sul el
        [],
      );
      const nelkuliIdk = nelkul.items.map((item) => item.id);
      assert.ok(
        nelkuliIdk.includes(matrica_nelkul.id),
        "a matrica nélküli eszköz benne van a 'without' listában",
      );

      // ISMERT POZITIV KONTROLL: ugyanaz a lekerdezes a MASIK iranyban megtalalja
      // a matricasat. Enelkul egy szuro, ami MINDENT kiszur, ugyanugy zolden
      // allna a fenti allitas mellett.
      const vannak = await repository.list(
        Object.assign(new AssetListQueryDto(), {
          label: "with" as const,
          ownerId: customerId,
          ownerType: "CUSTOMER" as const,
          status: "ALL" as const,
        }),
        { kind: "internal" },
        // `internal` -> az egyseg-lista nem sul el
        [],
      );
      const vanIdk = vannak.items.map((item) => item.id);
      assert.ok(!vanIdk.includes(matrica_nelkul.id));
      assert.ok(vanIdk.length > 0, "a 'with' lista nem lehet üres");
    });

    /**
     * A KONKRET KODRA SZURO LISTA, ADATBAZISON.
     *
     * EZ AZ A LEKERDEZES, AMIT A HIBAJEGY ESZKOZ-VALASZTOJA HIV, amikor valaki
     * beirja a matricakodot: azt kerdezi, hogy EZ A MATRICA a valasztott
     * halmazban all-e. Egysegtesztbol nem merheto, mert a valasz a kapcsolt
     * `AssetLabel` soron dol el.
     *
     * HAROM ALLITAS KELL HOZZA, ES A MASODIK-HARMADIK NEM DISZ:
     *  - a szurt lista PONTOSAN a matricas eszkozt adja;
     *  - szuro NELKUL ugyanaz a lekerdezes TOBB sort ad (ismert pozitiv
     *    kontroll: enelkul egy amugy is egyelemu lista ugyanigy zold lenne);
     *  - egy SZABAD (eszkozhoz nem rendelt) kodra NULLA sor jon. Ez utobbi a
     *    legfontosabb: ha a szuro valaha "nincs szuro"-re esne vissza, a valasz
     *    a TELJES lista lenne, es a hivo -- aki egyetlen sort var -- egy MASIK
     *    eszkozt adna hozza a jegyhez.
     */
    it("a labelCode szűrő pontosan a matricás eszközt adja", async () => {
      const label = await prisma.assetLabel.findUnique({
        where: { code: CODE_C },
        select: { assetId: true },
      });
      assert.ok(label?.assetId, "a próba előfeltétele: a kód eszközön áll");

      function lekerdezes(over: Record<string, unknown>) {
        return repository.list(
          Object.assign(new AssetListQueryDto(), {
            ownerId: customerId,
            ownerType: "CUSTOMER" as const,
            status: "ALL" as const,
            ...over,
          }),
          { kind: "internal" },
          // `internal` -> az egyseg-lista nem sul el
          [],
        );
      }

      const szurve = await lekerdezes({ labelCode: CODE_C });
      assert.deepEqual(
        szurve.items.map((item) => item.id),
        [label.assetId],
        "a szűrt lista egyetlen sora a matricás eszköz",
      );

      const szuretlen = await lekerdezes({});
      assert.ok(
        szuretlen.items.length > 1,
        "a szűrő nélküli lista több sort ad, tehát a fenti szűkítés mért valamit",
      );

      const szabadra = await lekerdezes({ labelCode: CODE_A });
      assert.equal(
        szabadra.items.length,
        0,
        "szabad kódra nulla sor jön, nem a teljes lista",
      );
    });

    /**
     * A GENERALAS ES A LISTA, ADATBAZISON.
     *
     * Ket dolog merheto csak itt: hogy a generalt kodok TENYLEG uj, nem letezo
     * kodok, es hogy a szabad darabszam SZAMOLVA jon -- vagyis csokken, amint
     * egy kod eszkozhoz kerul.
     */
    it("a generálás új kódokat ad, és a lista számolja a szabadokat", async () => {
      const elotte = await repository.listLabelBatches(50);
      const batch = await repository.issueBatch(5);
      letrehozottKotegek.push(batch.batchId);
      assert.equal(batch.codes.length, 5);
      assert.equal(new Set(batch.codes).size, 5, "a kódok nem ismétlődhetnek");

      const utana = await repository.listLabelBatches(50);
      assert.equal(
        utana.length,
        elotte.length + 1,
        "pontosan egy új tétel keletkezett",
      );
      const ujTetel = utana.find((t) => t.id === batch.batchId);
      assert.ok(ujTetel, "az új tétel szerepel a listában");
      assert.equal(ujTetel.count, 5);
      assert.equal(ujTetel.freeCount, 5, "friss tételben minden kód szabad");

      // A SZAMOLAS AKKOR ER VALAMIT, HA MOZDUL. Egy tarolt szamlalo itt nem
      // valtozna, es a lista tovabbra is otot mutatna -- csendben rosszul.
      await repository.create(
        createInput({ labelCode: batch.codes[0]! }),
        actorUserId,
      );
      const harmadszor = await repository.listLabelBatches(50);
      const frissitett = harmadszor.find((t) => t.id === batch.batchId);
      assert.equal(frissitett?.count, 5, "a tétel mérete nem változik");
      assert.equal(frissitett?.freeCount, 4, "a szabad darabszám csökken");

      await prisma.assetLabel.deleteMany({ where: { batchId: batch.batchId } });
      await prisma.assetLabelBatch.delete({ where: { id: batch.batchId } });
    });

    /**
     * A FELVITEL IDEMPOTENS, ES A KET MEZO KULON MONDJA MEG, MI TORTENT.
     *
     * Ez az allitas 2026-09-03-ig a `issueLabels` agan allt; azt a vegpontot
     * torolte a "ket ajto" javitas, mert kliens-hivoja nem volt es a
     * keletkezo kod KOTEG NELKUL maradt. Az allitas viszont ugyanugy ervenyes
     * az import agra -- csak ott `alreadyExisted` a mezo neve --, tehat NEM
     * veszett el lefedettseg a torlessel.
     */
    it("a felvitel idempotens, és megmondja, mi állt már ott", async () => {
      const result = await repository.importBatch([CODE_A, "Z9010"]);
      letrehozottKotegek.push(result.batchId);
      assert.deepEqual(result.alreadyExisted, [CODE_A]);
      assert.deepEqual(result.imported, ["Z9010"]);
      await prisma.assetLabel.deleteMany({ where: { code: "Z9010" } });
      await prisma.assetLabelBatch.delete({ where: { id: result.batchId } });
    });

    /**
     * A TAKARITAS TENYLEG LEFUT-E. Ugyanaz a par, mint a jegy- es a
     * munkalap-specben: a CI-kapu (`scripts/tap-stream-gate.mjs`) azt fogja
     * meg, ha a takaritas DOB, ez pedig azt, ha CSENDBEN NEM CSINAL SEMMIT.
     *
     * A KOTEG AZERT SZEREPEL KULON, es nem azert, mert "biztos, ami biztos":
     * a 2026-09-15-i sor-pillanatkep (verify job 104337824776) szerint ez a
     * suite EGY `AssetLabelBatch` sort hagyott maga utan minden futasban, es a
     * takaritas addig nem is emlitette ezt a tablat. A tobbi szamlalo a sema
     * FK-grafjabol jon: ami `Restrict` vagy `Cascade` KOTELEZO mezovel mutat
     * egy mar szamolt gyokerre, azt a gyoker nulla szama bizonyitja.
     *
     * EZ AZ UTOLSO TESZT A FAJLBAN, ES ANNAK IS KELL MARADNIA: elviszi a
     * fixtura-sorokat.
     */
    /**
     * A SZABAD SZAVAS KERESO IS MEGTALALJA A MATRICAKODOT.
     *
     * A MERT HIANY (2026-09-17): a kereso `OR`-aga NYOLC oszlopot nezett, es a
     * `label.code` nem volt kozottuk. Balazs ma kezdi a rogzitest matricakkal;
     * ha a kodot a KERESOBE irja, nulla talalatot kapott volna.
     *
     * ES EZ NEM UGYANAZ, MINT A `labelCode` SZURO: az GEPI ut, PONTOS
     * egyezessel. Ez EMBERI kereso, ami RESZLETRE keres -- ezert mer itt a
     * kod egy DARABJA, nem az egesze.
     */
    it("a szabad szavas kereső megtalálja az eszközt a matricakód RÉSZLETÉRŐL", async () => {
      // A KODNAK ELOBB LETEZNIE KELL a keszletben: a felvitel egy NEM LETEZO
      // kodot elutasit (lasd fentebb), tehat enelkul nem a kereso bukna el,
      // hanem a fixture -- es a piros MAST mondana, mint amit merni akarok.
      await repository.importBatch([CODE_F]);
      const matricas = await repository.create(
        createInput({ name: `${PREFIX} keresett`, labelCode: CODE_F }),
        actorUserId,
      );

      // A KOD EGY DARABJA, nem az egesze: a cimken a szerelo a felet is
      // lathatja, es a gepi szuro (`labelCode`) pont ezt nem engedne.
      /**
       * A KERESETT RESZLET BETUT IS TARTALMAZ, ES EZ NEM ONKENY.
       *
       * A kereso KILENC oszlopot nez. Ha csak SZAMJEGYEKRE keresnenk (peldaul
       * "006"), az allitas MAS oszlopon is teljesulhetne: a generalt
       * `assetNumber` alakja `ESZ-0006`, tehat egy harom szamjegyu reszlet
       * BENNE LEHET -- es akkor a teszt zold lenne az UJ ag nelkul is.
       *
       * A `Q74` viszont a fixture EGYETLEN oszlopaban sem fordulhat elo: az
       * `assetNumber` elotagja `ESZ-`, a nev es a vevo neve a suite
       * elotagjabol jon, a gyarto/modell/sorozatszam/leltari szam pedig nincs
       * beallitva. Marad a matricakod.
       */
      const resz = CODE_F.slice(0, 3);
      const talalat = await repository.list(
        Object.assign(new AssetListQueryDto(), {
          search: resz,
          ownerId: customerId,
          ownerType: "CUSTOMER" as const,
          status: "ALL" as const,
        }),
        { kind: "internal" },
        // `internal` -> az egyseg-lista nem sul el
        [],
      );

      assert.ok(
        talalat.items.map((item) => item.id).includes(matricas.id),
        `a ${resz} reszletre meg kell talalnia a ${CODE_F} matricas eszkozt`,
      );
    });

    /**
     * ES A NEGATIV PARJA: EGY NEM LETEZO KOD-RESZLET NEM HOZ BE MINDENT.
     *
     * MI PIROSIT: ha a kilencedik ag ugy kerulne be, hogy a feltetel MINDIG
     * igaz (peldaul ures `contains`). Akkor a fenti allitas ZOLD maradna, es a
     * kereso minden sort visszaadna -- ami kivulrol "sok talalat"-nak latszik,
     * nem hibanak.
     */
    it("nem létező kód-részletre nem ad vissza eszközt", async () => {
      const talalat = await repository.list(
        Object.assign(new AssetListQueryDto(), {
          search: "ZZZ999",
          ownerId: customerId,
          ownerType: "CUSTOMER" as const,
          status: "ALL" as const,
        }),
        { kind: "internal" },
        // `internal` -> az egyseg-lista nem sul el
        [],
      );

      assert.deepEqual(talalat.items, []);
    });

    it("a takarítás tényleg lefut: nem marad sor a teszt előtaggal", async () => {
      await removeLeftovers();

      assert.equal(
        await prisma.assetLabelBatch.count({
          where: { id: { in: letrehozottKotegek } },
        }),
        0,
        "maradt matrica-köteg a suite után",
      );
      assert.equal(
        await prisma.assetLabel.count({
          where: {
            code: { in: [CODE_A, CODE_B, CODE_C, CODE_D, CODE_E, CODE_F] },
          },
        }),
        0,
        "maradt matrica a teszt kódokkal",
      );
      assert.equal(
        await prisma.asset.count({
          where: { assetNumber: { startsWith: PREFIX } },
        }),
        0,
        "maradt eszköz a teszt előtaggal",
      );
      assert.equal(
        await prisma.customer.count({
          where: { customerNumber: { startsWith: PREFIX } },
        }),
        0,
        "maradt vevő a teszt előtaggal",
      );
      assert.equal(
        await prisma.user.count({
          where: { email: { startsWith: PREFIX.toLowerCase() } },
        }),
        0,
        "maradt felhasználó a teszt előtaggal",
      );
    });
  },
);

// A `Prisma` import a nyers SQL hibatípusához tartozik; ha egyszer kiesne, a
// fordító szól, és nem egy néma `any` marad a helyén.
void Prisma;
