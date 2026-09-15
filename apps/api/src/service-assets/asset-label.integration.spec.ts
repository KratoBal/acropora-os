import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { AssetLabelUnavailableError } from "./service-assets.repository.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";
import { AssetListQueryDto } from "./dto/asset.dto.js";
import type { CreateAssetDto } from "./dto/asset.dto.js";

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

let customerId = "";
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
    where: { code: { in: [CODE_A, CODE_B, CODE_C] } },
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
    where: { code: { in: [CODE_A, CODE_B, CODE_C] } },
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
      const found = await repository.detailByLabelCode(CODE_C, {
        kind: "customer",
        customerId,
      });
      assert.ok(found, "a saját eszköz látszik a saját hatókörben");
      // A KOD ALAPJAN TALALT ESZKOZ TENYLEG AZ, AMIRE A MATRICA KERULT.
      // Enelkul az allitas beerne barmelyik eszkozzel, amit a lekerdezes ad.
      const label = await prisma.assetLabel.findUnique({
        where: { code: CODE_C },
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
      const found = await repository.detailByLabelCode(CODE_C, {
        kind: "customer",
        customerId: masik.id,
      });
      assert.equal(found, null, "más partner eszköze nem érhető el a kódról");
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
      );
      const vanIdk = vannak.items.map((item) => item.id);
      assert.ok(!vanIdk.includes(matrica_nelkul.id));
      assert.ok(vanIdk.length > 0, "a 'with' lista nem lehet üres");
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
          where: { code: { in: [CODE_A, CODE_B, CODE_C] } },
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
