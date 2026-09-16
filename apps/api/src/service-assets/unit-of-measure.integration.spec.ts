import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";

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

let customerId = "";
let actorUserId = "";
let egysegId = "";

async function removeLeftovers() {
  await prisma.asset.deleteMany({
    where: { assetNumber: { startsWith: PREFIX } },
  });
  await prisma.asset.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
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

/** Egy eszkoz-sor nyers SQL-lel, hogy a CHECK-et az ALKALMAZAS MOGOTT merjuk. */
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
            'EQUIPMENT', 'ACTIVE', 'NORMAL', ${id}, ${customerId},
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
});
