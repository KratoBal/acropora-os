import "reflect-metadata";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  AssetPerformancePairError,
  ServiceAssetsRepository,
} from "./service-assets.repository.js";
import type { CreateAssetDto, UpdateAssetDto } from "./dto/asset.dto.js";

/**
 * A MERTEKEGYSEG-TORZSADAT, ADATBAZISON.
 *
 * MIERT NEM ELEG AZ EGYSEGTESZT. Amit itt merunk, azt a TABLA orzi, nem a kod:
 * egy CHECK megkotes, egy egyedi index es egy idegen kulcs torlesi iranya. Egy
 * egysegteszt legfeljebb azt tudna megmutatni, hogy a szolgaltatas nem kuld
 * rossz sort -- azt nem, hogy egy migracio, egy hatteranyag vagy egy kesobbi
 * vegpont sem tud.
 *
 * Ezert minden allitas NYERS SQL-lel kerul az alkalmazas moge ott, ahol a tabla
 * megkoteset meri: ha az alkalmazason at irnank, a sajat validaciónkat mernenk,
 * es pont az maradna fedezetlen, ami miatt a megkotes a tablan all.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "ITUOM";
const repository = new ServiceAssetsRepository();

let customerId = "";
let actorUserId = "";
let egysegId = "";
let masikEgysegId = "";
/**
 * AZ „ALKALMAZASON AT” BLOKK ESZKOZE SZALLITOI TULAJDONU, VALOS HELYSZINNEL.
 *
 * A `felvitel()` korabban `ownerType: "CUSTOMER"`-t hasznalt departmentId
 * nelkul, es `repository.create()`-et KOZVETLENUL hivja -- a
 * `department_required` migracio ota ez `Invalid prisma.asset.create()
 * invocation` hibaval hasal el (a CUSTOMER agon a repository
 * `departmentId: undefined`-t ir, a mezo viszont NOT NULL). Ez a blokk a
 * teljesitmeny-par mezoparjarol szol, nem a tulajdonos-tengelyrol.
 */
let szallitoId = "";
let helyszinId = "";

async function removeLeftovers() {
  await prisma.asset.deleteMany({
    where: { assetNumber: { startsWith: PREFIX } },
  });
  await prisma.asset.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  // A `felvitel()`-lel (repository.create) letrehozott sorok SEM vevot, SEM
  // a teszt-elotagos assetNumber-t nem viselik -- a HELYSZINEN at kell oket
  // megtalalni, a helyszin torlese elott (`Asset.departmentId` Restrict).
  await prisma.asset.deleteMany({
    where: {
      department: { customer: { customerNumber: { startsWith: PREFIX } } },
    },
  });
  await prisma.worksheetDepartment.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  await prisma.supplier.deleteMany({ where: { code: { startsWith: PREFIX } } });
  await prisma.unitOfMeasure.deleteMany({
    where: { code: { startsWith: PREFIX } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: PREFIX.toLowerCase() } },
  });
}

/**
 * Egy eszkoz-sor nyers SQL-lel, hogy a CHECK-et az ALKALMAZAS MOGOTT merjuk.
 *
 * A `qrToken` VALODI UUID-t kap `::uuid` castolassal, NEM a sajat
 * azonositomat: az oszlop `@db.Uuid`, es egy szoveg oda `42804`-gyel hasal el
 * (`column "qrToken" is of type uuid but expression is of type text`). Ezt a
 * CI merte meg, az elso futason -- helyben nincs postgres.
 *
 * ES AMIERT EZ ITT ALL: a hiba a ROGZITOBEN volt, nem a termekben, es pontosan
 * ugy nezett ki, mintha a CHECK nem mukodne. A testver-kontroll ("a ket mezo
 * EGYUTT rendben van") mondta meg a kulonbseget: az is elbukott, tehat nem a
 * megkotes volt a baj, hanem a beszuras.
 *
 * ES AMI A KEZENFEKVO JAVITAS LENNE, DE NEM MUKODIK: kihagyni a `qrToken`
 * oszlopot, mert a semaban `@default(uuid())` all. A `@default(...)` a PRISMA
 * KLIENS oldalan generál, NEM az oszlopon -- a `20260815143000` migracio
 * `"qrToken" UUID NOT NULL`-t ir, default nelkul. Nyers SQL-lel a kihagyas
 * tehat `NOT NULL` sertessel bukna el, es ugyanugy fixture-hibanak latszana.
 *
 * Ezt a valtozatot acrobot javasolta a napló alapjan, jóhiszemuen -- a
 * kulonbseg a semabol NEM latszik, csak a migraciobol. Ezert all itt.
 */
async function eszkozt(
  performance: string | null,
  performanceUnitId: string | null,
) {
  const id = `${PREFIX}-${Math.random().toString(36).slice(2, 10)}`;
  await prisma.$executeRaw`
    INSERT INTO "Asset" ("id", "assetNumber", "name", "kind", "status",
                         "criticality", "qrToken", "customerId", "createdById",
                         "performance", "performanceUnitId", "updatedAt")
    VALUES (${id}, ${`${PREFIX}-${id.slice(-6)}`}, ${`${PREFIX} eszköz`},
            'EQUIPMENT', 'ACTIVE', 'NORMAL', ${randomUUID()}::uuid,
            ${customerId},
            ${actorUserId}, ${performance}::decimal, ${performanceUnitId},
            CURRENT_TIMESTAMP)`;
  return id;
}

describe("mértékegység törzsadat", { skip: gate.mode === "skip" }, () => {
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
    const user = await prisma.user.create({
      data: {
        email: `${PREFIX.toLowerCase()}-actor@example.invalid`,
        displayName: `${PREFIX} aktor`,
        role: "SERVICE",
      },
      select: { id: true },
    });
    actorUserId = user.id;
    const egyseg = await prisma.unitOfMeasure.create({
      data: {
        code: `${PREFIX}-W`,
        name: `${PREFIX} watt`,
        kind: "PERFORMANCE",
      },
      select: { id: true },
    });
    egysegId = egyseg.id;
    const masik = await prisma.unitOfMeasure.create({
      data: {
        code: `${PREFIX}-kW`,
        name: `${PREFIX} kilowatt`,
        kind: "PERFORMANCE",
      },
      select: { id: true },
    });
    masikEgysegId = masik.id;
    const helyszin = await prisma.worksheetDepartment.create({
      data: { customerId, code: "UOM", name: `${PREFIX} helyszín` },
      select: { id: true },
    });
    helyszinId = helyszin.id;
    const szallito = await prisma.supplier.create({
      data: { code: `${PREFIX}-S`, name: `${PREFIX} szállító` },
      select: { id: true },
    });
    szallitoId = szallito.id;
  });

  after(async () => {
    await removeLeftovers();
    await prisma.$disconnect();
  });

  /**
   * A KET MEZO EGYUTT MOZOG -- ES A KET FELALLAPOT KULON ALLITAS.
   *
   * Egy "500" mertekegyseg nelkul nem informacio, hanem talalgatasra hivas
   * (watt? liter per ora?). A forditottja ugyanennyire ertelmetlen: egy
   * mertekegyseg szam nelkul.
   */
  it("Asset_performance_pairing_check: szám mértékegység NÉLKÜL nem áll meg", async () => {
    await assert.rejects(() => eszkozt("500", null), /pairing_check/);
  });

  it("Asset_performance_pairing_check: mértékegység SZÁM nélkül sem áll meg", async () => {
    await assert.rejects(() => eszkozt(null, egysegId), /pairing_check/);
  });

  /**
   * POZITIV KONTROLL A KETTOHOZ. Enelkul mind a ket fenti allitas teljesulne
   * attol is, ha a beszuras BARMILYEN okbol elhasalna (hianyzo oszlop, rossz
   * idegen kulcs) -- es akkor nem a CHECK-et mernenk, hanem a fixture-t.
   */
  it("a két mező EGYÜTT rendben van, és üresen is", async () => {
    await eszkozt("500", egysegId);
    await eszkozt(null, null);
  });

  /**
   * A KOD A FAJTAJAN BELUL EGYEDI, NEM GLOBALISAN.
   *
   * A ket allitas EGYUTT mondja ki a szabalyt: ugyanaz a jel MAS fajtaban
   * megengedett, UGYANABBAN nem. Csak az elso a "nem ismetlodhet"-et merne, es
   * az egy globalis egyediseg mellett is zold lenne.
   */
  it("ugyanaz a kód MÁSIK fajtában megengedett", async () => {
    await prisma.unitOfMeasure.create({
      data: {
        code: `${PREFIX}-W`,
        name: `${PREFIX} watt-mennyiség`,
        kind: "QUANTITY",
      },
    });
  });

  it("ugyanaz a kód UGYANABBAN a fajtában nem ismétlődhet", async () => {
    await assert.rejects(
      () =>
        prisma.unitOfMeasure.create({
          data: {
            code: `${PREFIX}-W`,
            name: `${PREFIX} másodszor`,
            kind: "PERFORMANCE",
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof Prisma.PrismaClientKnownRequestError);
        assert.equal(error.code, "P2002");
        return true;
      },
    );
  });

  /**
   * A HASZNALATBAN LEVO MERTEKEGYSEG NEM TOROLHETO -- ES EZ NEM KENYELMETLENSEG.
   *
   * `SetNull` eseten a torles CSENDBEN kiuritene az eszkozok mezoit, es a
   * `pairing_check` miatt a sorok fele ervenytelenne is valna. A kivezetes
   * utja ezert az `isActive = false`: a valasztobol kiesik, a MEGLEVO ertekek
   * mellett viszont olvashato marad.
   */
  it("használatban lévő mértékegység nem törölhető", async () => {
    await eszkozt("750", egysegId);
    await assert.rejects(
      () => prisma.unitOfMeasure.delete({ where: { id: egysegId } }),
      (error: unknown) => {
        assert.ok(error instanceof Prisma.PrismaClientKnownRequestError);
        assert.equal(error.code, "P2003");
        return true;
      },
    );
  });

  it("a kivezetés viszont megy, és az érték MARAD az eszközön", async () => {
    const eszkoz = await eszkozt("900", egysegId);
    await prisma.unitOfMeasure.update({
      where: { id: egysegId },
      data: { isActive: false },
    });
    const sor = await prisma.asset.findUniqueOrThrow({
      where: { id: eszkoz },
      select: { performanceUnitId: true },
    });
    // A LENYEG: a kivezetes a VALASZTOT szukiti, nem a MULTAT irja at.
    assert.equal(sor.performanceUnitId, egysegId);
    await prisma.unitOfMeasure.update({
      where: { id: egysegId },
      data: { isActive: true },
    });
  });

  /**
   * A MIGRACIO KEZDO KESZLETE TENYLEG BEKERULT.
   *
   * Enelkul a mezo az elso napon hasznalhatatlan lenne: a legordulo ures, es a
   * kezelo nem tud mit valasztani. Ez az allitas a MIGRACIOT meri, nem a
   * sajat fixture-omet -- ezert nem a teszt-eloteggel keres.
   */
  it("a migráció felvitte a teljesítmény-egységeket", async () => {
    const kodok = (
      await prisma.unitOfMeasure.findMany({
        where: { kind: "PERFORMANCE", code: { not: { startsWith: PREFIX } } },
        select: { code: true },
      })
    ).map((sor) => sor.code);
    for (const kod of ["W", "kW", "l/h"])
      assert.ok(kodok.includes(kod), `hiányzik a kezdő készletből: ${kod}`);
    // ES A TESTVER-KONTROLL: a MENNYISEGI fajtaba SZANDEKOSAN nem vittunk be
    // semmit, mert azt ma meg szabad szoveg hordozza tiz helyen. Egy elore
    // feltoltott, de senki altal nem hasznalt lista csak zaj lenne.
    assert.equal(
      await prisma.unitOfMeasure.count({
        where: { kind: "QUANTITY", code: { not: { startsWith: PREFIX } } },
      }),
      0,
    );
  });

  /**
   * ES MOST A MASIK OLDAL: AZ ALKALMAZASON AT, AHOGY A KEZELO HASZNALJA.
   *
   * A fenti allitasok a TABLAT merik, szandekosan az alkalmazas mogott. Ez a
   * blokk pont a forditottja, es NEM ugyanaz a kerdes: a `pairing_check` a
   * VEGEREDMENYT nezi, a szolgaltatas pedig azt dönti el, mit KAP a kezelo --
   * mondatot vagy egy megkotes nevet.
   *
   * ES ITT VAN A KOR VALODI FINOMSAGA: frissiteskor a part az EREDMENY dönti
   * el, nem a bekuldott mezo. Egy "csak a szamot irom at" keres teljesen
   * ervenyes, ha az egyseg mar all az eszkozon -- es ezt EGYETLEN tablan allo
   * megkotes sem tudja megmondani, mert az a kesz sort latja, nem a kerest.
   */
  describe("az alkalmazáson át", () => {
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

    function felvitel(over: Partial<CreateAssetDto> = {}): CreateAssetDto {
      return {
        ownerType: "SUPPLIER",
        ownerId: szallitoId,
        departmentId: helyszinId,
        kind: "EQUIPMENT",
        name: `${PREFIX} teszteszköz`,
        ...over,
      } as CreateAssetDto;
    }

    it("a felvitt pár az ADATLAPON kiírva jön vissza, nem azonosítóként", async () => {
      const eszkoz = await repository.create(
        felvitel({ performance: "500", performanceUnitId: egysegId }),
        actorUserId,
      );
      assert.equal(eszkoz.performance, "500");
      // A LENYEG: az adatlap `500 W`-ot tud mutatni EGY hivasbol. Ha csak az
      // azonosito jonne, a mobil terero nelkul nem tudna kiirni a jelet.
      assert.equal(eszkoz.performanceUnit?.id, egysegId);
      assert.equal(eszkoz.performanceUnit?.code, `${PREFIX}-W`);
    });

    it("felvitelkor a szám EGYEDÜL mondatot kap, nem megkötés-nevet", async () => {
      await assert.rejects(
        () => repository.create(felvitel({ performance: "500" }), actorUserId),
        (error: unknown) => {
          assert.ok(error instanceof AssetPerformancePairError);
          assert.equal(error.hiany, "unit");
          return true;
        },
      );
    });

    /**
     * EZ AZ AZ ALLITAS, AMIERT A `teljesitmenyEredmenye` LETEZIK.
     *
     * A bekuldott mezokbol itelve ez a keres FEL PAR (csak szam jott), tehat
     * elbukna -- holott a vegeredmeny ep, mert az egyseg mar ott all.
     */
    it("meglévő egység mellett a szám EGYEDÜL is átírható", async () => {
      const eszkoz = await repository.create(
        felvitel({ performance: "500", performanceUnitId: egysegId }),
        actorUserId,
      );
      const utana = await mentes(eszkoz.id, { performance: "750" });
      assert.equal(utana.performance, "750");
      assert.equal(utana.performanceUnit?.id, egysegId);
    });

    it("meglévő szám mellett az egység EGYEDÜL is átírható", async () => {
      const eszkoz = await repository.create(
        felvitel({ performance: "500", performanceUnitId: egysegId }),
        actorUserId,
      );
      const utana = await mentes(eszkoz.id, {
        performanceUnitId: masikEgysegId,
      });
      assert.equal(utana.performance, "500");
      assert.equal(utana.performanceUnit?.id, masikEgysegId);
    });

    /**
     * A TORLES CSAK EGYUTT MEGY -- ES A MASODIK ALLITAS A TESTVER-KONTROLL.
     *
     * Az elso onmagaban akkor is zold lenne, ha a tarolo MINDEN felallapotot
     * elutasitana, a teljes torlest is. Akkor viszont a mezot soha nem
     * lehetne leszedni, es azt semmi nem mondana meg.
     */
    it("a két mező EGYÜTT törölhető", async () => {
      const eszkoz = await repository.create(
        felvitel({ performance: "500", performanceUnitId: egysegId }),
        actorUserId,
      );
      const utana = await mentes(eszkoz.id, {
        performance: null,
        performanceUnitId: null,
      });
      assert.equal(utana.performance, undefined);
      assert.equal(utana.performanceUnit, undefined);
    });

    it("CSAK az egyik törlése ELBUKIK, és megnevezi a hiányzó felet", async () => {
      const eszkoz = await repository.create(
        felvitel({ performance: "500", performanceUnitId: egysegId }),
        actorUserId,
      );
      await assert.rejects(
        () => mentes(eszkoz.id, { performanceUnitId: null }),
        (error: unknown) => {
          assert.ok(error instanceof AssetPerformancePairError);
          assert.equal(error.hiany, "unit");
          return true;
        },
      );
      // ES A SOR VALTOZATLAN MARADT. Egy elbukott mentes utan a felallapot
      // nem allhat elo reszben: enelkul az allitas csak azt mondana, hogy a
      // hivo hibat kapott, nem azt, hogy az eszkoz ep maradt.
      const sor = await prisma.asset.findUniqueOrThrow({
        where: { id: eszkoz.id },
        select: { performance: true, performanceUnitId: true },
      });
      assert.equal(sor.performance?.toString(), "500");
      assert.equal(sor.performanceUnitId, egysegId);
    });

    /**
     * A KIVEZETETT EGYSEG AZ ADATLAPON OLVASHATO MARAD.
     *
     * A tabla oldalarol ezt mar merjuk (az `performanceUnitId` megmarad). Ez
     * az allitas MAST mond: hogy a VALASZ is hozza, tehat a kezelo latja, mi
     * all az eszkozon. Ha az `include` valaha `isActive: true`-ra szukulne, a
     * mezo csendben eltunne a lapról, es a tablat mero allitas zold maradna.
     */
    it("a kivezetett egység az adatlapon OLVASHATÓ marad", async () => {
      const eszkoz = await repository.create(
        felvitel({ performance: "500", performanceUnitId: masikEgysegId }),
        actorUserId,
      );
      await prisma.unitOfMeasure.update({
        where: { id: masikEgysegId },
        data: { isActive: false },
      });
      const lap = await repository.detail(eszkoz.id, { kind: "internal" }, []);
      assert.equal(lap?.performanceUnit?.id, masikEgysegId);
      await prisma.unitOfMeasure.update({
        where: { id: masikEgysegId },
        data: { isActive: true },
      });
    });
  });
});
