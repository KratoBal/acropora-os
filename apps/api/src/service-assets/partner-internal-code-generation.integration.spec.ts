import "reflect-metadata";
import { InMemoryDocumentStore } from "./document-store/in-memory-document-store.js";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ServiceAssetsController } from "./service-assets.controller.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";
import { ServiceAssetsService } from "./service-assets.service.js";

/**
 * A PARTNER BELSŐ KÓDJÁNAK AUTOMATIKUS KÉPZÉSE, ADATBÁZISON.
 *
 * Balázs kérése (2026-09-24, Szerviz és eszköznyilvántartás szál): "amiket mi
 * viszünk fel eszközöket azoknál nem generálódik le automatikusan a partner
 * belső kódja". acrobot élő mérése
 * (`exchange/partner-kod-auto-meres-2026-09-24.md`, 2026-09-24) adta a
 * kategória/helyszín/sorszám tengelyt, a gyökér-alakot pedig Balázs
 * 2026-09-24 11:33-i jóváhagyása pontosította: gyökér eszköz
 * `<legfelső helyszín kódja>-<saját helyszín kódja>-<kategória kódja>-<NN>`
 * (a közbülső szintek kimaradnak), vagy ha az eszköz KÖZVETLENÜL a legfelső
 * szinten áll, `<legfelső helyszín kódja>-<kategória kódja>-<NN>`; beépített
 * eszköz `<szülő partnerInternalCode>-<kategória kódja>-<NN>`.
 *
 * MIÉRT NEM ELÉG A `partner-internal-code.spec.ts` (egységteszt). A tiszta
 * függvények (`partnerInternalCodePrefix`, `nextFreePartnerInternalCodeSerial`)
 * adatbázis nélkül mérhetők, de a KAPU maga -- van-e a kategóriának kódja, van-e
 * a szülőnek/helyszínnek kódja, milyen kódok állnak MÁR a partneren -- csak
 * adatbázisból dönthető el. Ez a spec a `service-assets.service.ts`
 * `create()`-jétől a `service-assets.repository.ts` tranzakciójáig terjedő
 * BEKÖTÉST méri, nem az egyes lépéseket külön-külön.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "PARTCODEGEN";

let internalUser: AuthenticatedUser;

/**
 * A GENERÁLÁS NÉLKÜLI ESETBEN A VÁLASZ `undefined`-ET AD, NEM `null`-T --
 * ez a `service-assets.repository.ts` MÁR MEGLÉVŐ, szándékos mintája
 * (`partnerInternalCode: row.partnerInternalCode ?? undefined`, a
 * `manufacturer`/`model`/`labelCode` mezőkkel egyező módon: "ha nincs,
 * `undefined`, nem üres szöveg"). A TÁROLT érték viszont ténylegesen
 * `null` -- ezt a válasz helyett innen olvassuk vissza, hogy azt mérjük,
 * amit a `create()` valójában ÍRT, ne a DTO-réteg kozmetikai alakját.
 */
async function storedPartnerInternalCode(id: string): Promise<string | null> {
  const row = await prisma.asset.findUnique({
    where: { id },
    select: { partnerInternalCode: true },
  });
  return row?.partnerInternalCode ?? null;
}

async function removeLeftovers() {
  await prisma.asset.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.assetCategory.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  await prisma.worksheetDepartment.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  // A SZÁLLÍTÓ ELŐBB, MINT A VEVŐ -- a `Supplier.customerId` megszorítás nem
  // `SetNull` (lásd `asset-name-check.integration.spec.ts` jegyzetét).
  await prisma.supplier.deleteMany({
    where: { name: { startsWith: PREFIX } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: PREFIX.toLowerCase() } },
  });
}

describe(
  "a partner belső kódjának automatikus generálása, létrehozáskor",
  { skip: gate.mode === "skip" },
  () => {
    const assets = new ServiceAssetsController(
      new ServiceAssetsService(
        new ServiceAssetsRepository(),
        new InMemoryDocumentStore(),
      ),
    );

    let supplierId = "";
    /** A LEVÉL, a PCR (gyökér) / PCI (közbülső) / PCL (levél) fában. */
    let departmentId = "";
    /** ÖNÁLLÓ, GYÖKÉR-SZINTŰ helyszín, gyermek nélkül -- a "közvetlenül a
     * legfelső szinten áll" esethez. */
    let rootOnlyDepartmentId = "";
    let categoryId = "";
    let secondCategoryId = "";
    let codelessCategoryId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      const user = await prisma.user.create({
        data: {
          email: `${PREFIX.toLowerCase()}-actor@example.invalid`,
          displayName: `${PREFIX} aktor`,
          role: "SERVICE",
        },
        select: { id: true },
      });
      internalUser = {
        id: user.id,
        email: `${PREFIX.toLowerCase()}-actor@example.invalid`,
        displayName: `${PREFIX} aktor`,
        role: "OWNER",
        customerId: null,
        supplierId: null,
      } as AuthenticatedUser;

      const supplier = await prisma.supplier.create({
        data: { code: PREFIX, name: `${PREFIX} szállító` },
        select: { id: true },
      });
      supplierId = supplier.id;

      const mirrorCustomer = await prisma.customer.create({
        data: {
          customerNumber: PREFIX,
          type: "COMPANY",
          displayName: `${PREFIX} tükör`,
          partner: { connect: { id: supplierId } },
        },
        select: { id: true },
      });
      /**
       * A HÁROMSZINTES FA: PCR (gyökér) / PCI (közbülső) / PCL (levél) --
       * Balázs 2026-09-24 11:33-i jóváhagyása szerint a gyökér kódja
       * (PCR) plusz a SAJÁT (PCL) kódja adja az előtagot, a közbülső (PCI)
       * szint KIMARAD.
       */
      const root = await prisma.worksheetDepartment.create({
        data: {
          customerId: mirrorCustomer.id,
          code: "PCR",
          name: `${PREFIX} gyökér helyszín`,
        },
        select: { id: true },
      });
      const intermediate = await prisma.worksheetDepartment.create({
        data: {
          customerId: mirrorCustomer.id,
          parentId: root.id,
          code: "PCI",
          name: `${PREFIX} közbülső helyszín`,
        },
        select: { id: true },
      });
      const leaf = await prisma.worksheetDepartment.create({
        data: {
          customerId: mirrorCustomer.id,
          parentId: intermediate.id,
          code: "PCL",
          name: `${PREFIX} levél helyszín`,
        },
        select: { id: true },
      });
      departmentId = leaf.id;

      const rootOnly = await prisma.worksheetDepartment.create({
        data: {
          customerId: mirrorCustomer.id,
          code: "PCS",
          name: `${PREFIX} önálló gyökér helyszín`,
        },
        select: { id: true },
      });
      rootOnlyDepartmentId = rootOnly.id;

      const category = await prisma.assetCategory.create({
        data: { name: `${PREFIX} kategória`, code: `${PREFIX}CAT` },
        select: { id: true },
      });
      categoryId = category.id;

      const secondCategory = await prisma.assetCategory.create({
        data: { name: `${PREFIX} kategória 2`, code: `${PREFIX}CAT2` },
        select: { id: true },
      });
      secondCategoryId = secondCategory.id;

      /**
       * A KIVEZETÉS/KÓD-HIÁNY KONTROLLJÁHOZ: MA IS ELŐFORDUL KATEGÓRIA KÓD
       * NÉLKÜL (acrobot mérése: 35/35 aktívnak van kódja, de ez nem sémaszintű
       * garancia -- az `AssetCategory.code` nullázható).
       */
      const codelessCategory = await prisma.assetCategory.create({
        data: { name: `${PREFIX} kód nélküli kategória` },
        select: { id: true },
      });
      codelessCategoryId = codelessCategory.id;
    });

    after(async () => {
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "a suite eszközei bent maradtak a takarítás után",
          darab: await prisma.asset.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite kategóriái bent maradtak a takarítás után",
          darab: await prisma.assetCategory.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite helyszíne bent maradt a takarítás után",
          darab: await prisma.worksheetDepartment.count({
            where: { customer: { customerNumber: { startsWith: PREFIX } } },
          }),
        },
        {
          nev: "a suite szállítója bent maradt a takarítás után",
          darab: await prisma.supplier.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "a suite vevő-tükre bent maradt a takarítás után",
          darab: await prisma.customer.count({
            where: { customerNumber: { startsWith: PREFIX } },
          }),
        },
      ]);
      await prisma.$disconnect();
    });

    it("gyökér eszköznél, mély fán, a LEGFELSŐ és a SAJÁT helyszín kódjából generál -- a közbülső szint kimarad", async () => {
      const created = (await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          departmentId,
          kind: "EQUIPMENT",
          name: `${PREFIX} gyökér`,
          categoryId,
        } as never,
        internalUser,
      )) as { id: string; partnerInternalCode: string | null };

      assert.equal(created.partnerInternalCode, `PCR-PCL-${PREFIX}CAT-01`);
    });

    it("egy MEGLÉVŐ, azonos előtagú kód mellett a KÖVETKEZŐ sorszámot adja", async () => {
      // TESTVÉR-KONTROLL a fenti mellett: ha a generátor mindig "-01"-et adna
      // (nem nézné a meglévő kódokat), ez az állítás pirosra váltana.
      const created = (await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          departmentId,
          kind: "EQUIPMENT",
          name: `${PREFIX} gyökér második`,
          categoryId,
        } as never,
        internalUser,
      )) as { id: string; partnerInternalCode: string | null };

      assert.equal(created.partnerInternalCode, `PCR-PCL-${PREFIX}CAT-02`);
    });

    it("gyökér eszköznél, ha KÖZVETLENÜL a legfelső szinten áll, a gyökér kódja nem ismétlődik", async () => {
      const category = await prisma.assetCategory.create({
        data: {
          name: `${PREFIX} önálló gyökér kategória`,
          code: `${PREFIX}ROOT`,
        },
        select: { id: true },
      });

      const created = (await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          departmentId: rootOnlyDepartmentId,
          kind: "EQUIPMENT",
          name: `${PREFIX} önálló gyökéren álló eszköz`,
          categoryId: category.id,
        } as never,
        internalUser,
      )) as { id: string; partnerInternalCode: string | null };

      // NEM "PCS-PCS-..." -- a gyökér kódja csak egyszer szerepel.
      assert.equal(created.partnerInternalCode, `PCS-${PREFIX}ROOT-01`);

      /**
       * A TEMP KATEGÓRIÁT NEM TÖRÖLJÜK ITT: az imént létrehozott eszköz
       * MÉG hivatkozik rá (`Asset.categoryId`), és a `removeLeftovers()`
       * a szuit végén ELŐBB törli az eszközöket, csak UTÁNA a
       * kategóriákat -- ha itt, a teszten belül törölnénk, az idegen
       * kulcs megszorítás elbukna. A kategória neve `${PREFIX}`-fel kezdődik,
       * tehát a végső söprés úgyis megtalálja.
       */
    });

    it("beépített eszköznél a SZÜLŐ TELJES kódjából generál, nem a helyszínből", async () => {
      const parent = (await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          departmentId,
          kind: "EQUIPMENT",
          name: `${PREFIX} beépített szülő`,
          categoryId,
        } as never,
        internalUser,
      )) as { id: string; partnerInternalCode: string | null };
      assert.ok(parent.partnerInternalCode);

      const child = (await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          departmentId,
          parentAssetId: parent.id,
          kind: "EQUIPMENT",
          name: `${PREFIX} beépített gyermek`,
          categoryId: secondCategoryId,
        } as never,
        internalUser,
      )) as { id: string; partnerInternalCode: string | null };

      assert.equal(
        child.partnerInternalCode,
        `${parent.partnerInternalCode}-${PREFIX}CAT2-01`,
      );
    });

    it("BALÁZS KIFEJEZETT KÉRÉSE: ha a szülőnek nincs kódja, NEM generál", async () => {
      // A szülő SZÁNDÉKOSAN kód nélkül jön létre: nincs kategóriája, tehát a
      // saját létrehozásakor sem generálódott neki kód.
      const codelessParent = (await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          departmentId,
          kind: "EQUIPMENT",
          name: `${PREFIX} kód nélküli szülő`,
        } as never,
        internalUser,
      )) as { id: string; partnerInternalCode: string | null };
      assert.equal(await storedPartnerInternalCode(codelessParent.id), null);

      const child = (await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          departmentId,
          parentAssetId: codelessParent.id,
          kind: "EQUIPMENT",
          name: `${PREFIX} kód nélküli szülő gyermeke`,
          categoryId,
        } as never,
        internalUser,
      )) as { id: string; partnerInternalCode: string | null };

      assert.equal(await storedPartnerInternalCode(child.id), null);
    });

    it("kategória nélkül NEM generál", async () => {
      const created = (await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          departmentId,
          kind: "EQUIPMENT",
          name: `${PREFIX} kategória nélkül`,
        } as never,
        internalUser,
      )) as { id: string; partnerInternalCode: string | null };

      assert.equal(await storedPartnerInternalCode(created.id), null);
    });

    it("kód nélküli kategóriával NEM generál", async () => {
      // A DB-FÜGGŐ ÁG, AMIT AZ EGYSÉGTESZT NEM ÉR EL: a kapu bemenetből
      // (`shouldGeneratePartnerInternalCode`) csak azt látja, hogy VAN
      // kategória -- azt, hogy a kategóriának van-e KÓDJA, csak a
      // tranzakción belüli lekérdezés dönti el.
      const created = (await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          departmentId,
          kind: "EQUIPMENT",
          name: `${PREFIX} kód nélküli kategóriával`,
          categoryId: codelessCategoryId,
        } as never,
        internalUser,
      )) as { id: string; partnerInternalCode: string | null };

      assert.equal(await storedPartnerInternalCode(created.id), null);
    });

    it("egy LYUKAT a helyén tölt ki, nem a legmagasabb szám mögé ragaszt", async () => {
      // Kézzel beírt kódok, lyukkal: -01 és -03 megvan, a -02 szabad.
      const manualPrefix = `PCR-PCL-${PREFIX}LYUK`;
      const category = await prisma.assetCategory.create({
        data: { name: `${PREFIX} lyuk kategória`, code: `${PREFIX}LYUK` },
        select: { id: true },
      });
      await prisma.asset.createMany({
        data: [
          {
            assetNumber: `${PREFIX}-LYUK-1`,
            supplierId,
            departmentId,
            kind: "EQUIPMENT",
            name: `${PREFIX} lyuk kézi 1`,
            partnerInternalCode: `${manualPrefix}-01`,
          },
          {
            assetNumber: `${PREFIX}-LYUK-3`,
            supplierId,
            departmentId,
            kind: "EQUIPMENT",
            name: `${PREFIX} lyuk kézi 3`,
            partnerInternalCode: `${manualPrefix}-03`,
          },
        ],
      });

      const created = (await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          departmentId,
          kind: "EQUIPMENT",
          name: `${PREFIX} lyuk kitöltő`,
          categoryId: category.id,
        } as never,
        internalUser,
      )) as { id: string; partnerInternalCode: string | null };

      assert.equal(created.partnerInternalCode, `${manualPrefix}-02`);

      // A temp kategóriát nem töröljük itt -- lásd a fenti jegyzetet.
    });

    /**
     * BALÁZS SZABÁLYA (2026-09-24 11:42), SZÓ SZERINT: "ha a név római
     * szammal vegzodik (Lampa VI.) és az a sorszám szabad, azt kapja
     * (LIG-06), különben a legkisebb szabadot." A saját 131 eszközös
     * visszatöltésén alkalmazta ugyanígy.
     */
    it("ha a NÉV VÉGE szabad sorszámú római szám, azt kapja -- nem a legkisebb szabadot", async () => {
      const category = await prisma.assetCategory.create({
        data: { name: `${PREFIX} római kategória`, code: `${PREFIX}ROM` },
        select: { id: true },
      });

      const created = (await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          departmentId,
          kind: "EQUIPMENT",
          name: `${PREFIX} Lámpa VI.`,
          categoryId: category.id,
        } as never,
        internalUser,
      )) as { id: string; partnerInternalCode: string | null };

      assert.equal(created.partnerInternalCode, `PCR-PCL-${PREFIX}ROM-06`);

      // A temp kategóriát nem töröljük itt -- lásd a fenti jegyzetet.
    });

    it("ha a névvégi római szám sorszáma MÁR FOGLALT, visszaesik a legkisebb szabadra", async () => {
      const category = await prisma.assetCategory.create({
        data: {
          name: `${PREFIX} római foglalt kategória`,
          code: `${PREFIX}ROMF`,
        },
        select: { id: true },
      });
      const prefix = `PCR-PCL-${PREFIX}ROMF`;
      // A "VI." sorszáma (6) MÁR FOGLALT kézi kóddal.
      await prisma.asset.create({
        data: {
          assetNumber: `${PREFIX}-ROMF-FOGLALT`,
          supplierId,
          departmentId,
          kind: "EQUIPMENT",
          name: `${PREFIX} római foglalt kézi`,
          partnerInternalCode: `${prefix}-06`,
        },
      });

      const created = (await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          departmentId,
          kind: "EQUIPMENT",
          name: `${PREFIX} Lámpa VI.`,
          categoryId: category.id,
        } as never,
        internalUser,
      )) as { id: string; partnerInternalCode: string | null };

      // NEM "-06" (foglalt) -- a legkisebb szabad, ami "-01".
      assert.equal(created.partnerInternalCode, `${prefix}-01`);

      // A temp kategóriát nem töröljük itt -- lásd a fenti jegyzetet.
    });

    it("a KÉZZEL BEÍRT értéket soha nem írja felül", async () => {
      const created = (await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          departmentId,
          kind: "EQUIPMENT",
          name: `${PREFIX} kézi érték`,
          categoryId,
          partnerInternalCode: `${PREFIX}-KEZI-1`,
        } as never,
        internalUser,
      )) as { id: string; partnerInternalCode: string | null };

      assert.equal(created.partnerInternalCode, `${PREFIX}-KEZI-1`);
    });

    it("a PATCH (szerkesztés) SOHA nem generál", async () => {
      // Létrehozáskor kategória nélkül, tehát nem generálódik kód.
      const created = (await assets.create(
        {
          ownerType: "SUPPLIER",
          ownerId: supplierId,
          departmentId,
          kind: "EQUIPMENT",
          name: `${PREFIX} patch teszt`,
        } as never,
        internalUser,
      )) as {
        id: string;
        partnerInternalCode: string | null;
        updatedAt: string;
      };
      assert.equal(await storedPartnerInternalCode(created.id), null);

      // A PATCH utólag kategóriát ad -- a kód generálása CSAK a `create()`-hez
      // kötött, a szerkesztéshez nem.
      await assets.update(
        created.id,
        {
          categoryId,
          expectedUpdatedAt: created.updatedAt,
        } as never,
        internalUser,
      );

      const stored = await prisma.asset.findUnique({
        where: { id: created.id },
        select: { partnerInternalCode: true, categoryId: true },
      });
      assert.equal(stored?.categoryId, categoryId);
      assert.equal(stored?.partnerInternalCode, null);
    });

    /**
     * A VERSENYHELYZET ELLENI ZÁR MÉRÉSE.
     *
     * `pg_advisory_xact_lock` a tranzakción belül szerializálja a generálást:
     * két egyidejű felvitel UGYANARRA az előtagra nem kaphatja ugyanazt a
     * sorszámot. Ha a zár hiányozna, mindkét hívás a "nincs meglévő kód"
     * állapotot olvasná ki, és mindkettő "-01"-et írna -- ez az állítás azt a
     * hibát fogná meg.
     */
    it("két egyidejű felvitel ugyanarra az előtagra nem kap azonos sorszámot", async () => {
      const category = await prisma.assetCategory.create({
        data: { name: `${PREFIX} verseny kategória`, code: `${PREFIX}VERS` },
        select: { id: true },
      });

      const [elso, masodik] = await Promise.all([
        assets.create(
          {
            ownerType: "SUPPLIER",
            ownerId: supplierId,
            departmentId,
            kind: "EQUIPMENT",
            name: `${PREFIX} verseny A`,
            categoryId: category.id,
          } as never,
          internalUser,
        ) as Promise<{ partnerInternalCode: string | null }>,
        assets.create(
          {
            ownerType: "SUPPLIER",
            ownerId: supplierId,
            departmentId,
            kind: "EQUIPMENT",
            name: `${PREFIX} verseny B`,
            categoryId: category.id,
          } as never,
          internalUser,
        ) as Promise<{ partnerInternalCode: string | null }>,
      ]);

      assert.ok(elso.partnerInternalCode);
      assert.ok(masodik.partnerInternalCode);
      assert.notEqual(elso.partnerInternalCode, masodik.partnerInternalCode);
      const kettoAlakja = [
        elso.partnerInternalCode,
        masodik.partnerInternalCode,
      ].sort();
      assert.deepEqual(kettoAlakja, [
        `PCR-PCL-${PREFIX}VERS-01`,
        `PCR-PCL-${PREFIX}VERS-02`,
      ]);

      // A temp kategóriát nem töröljük itt -- lásd a fenti jegyzetet.
    });
  },
);
