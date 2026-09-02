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

async function removeLeftovers() {
  await prisma.assetLabel.deleteMany({
    where: { code: { in: [CODE_A, CODE_B, CODE_C] } },
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
      await repository.issueLabels([CODE_B, CODE_C]);
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

    it("a kiadás idempotens, és megmondja, mi állt már ott", async () => {
      const result = await repository.issueLabels([CODE_A, "Z9010"]);
      assert.deepEqual(result.alreadyIssued, [CODE_A]);
      assert.deepEqual(result.issued, ["Z9010"]);
      await prisma.assetLabel.deleteMany({ where: { code: "Z9010" } });
    });
  },
);

// A `Prisma` import a nyers SQL hibatípusához tartozik; ha egyszer kiesne, a
// fordító szól, és nem egy néma `any` marad a helyén.
void Prisma;
