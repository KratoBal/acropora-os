import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { NotFoundException } from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import {
  AssetListQueryDto,
  UploadAssetDocumentDto,
} from "../service-assets/dto/asset.dto.js";
import { ServiceAssetsController } from "../service-assets/service-assets.controller.js";
import { ServiceAssetsRepository } from "../service-assets/service-assets.repository.js";
import { ServiceAssetsService } from "../service-assets/service-assets.service.js";
import { SupplierListQueryDto } from "../suppliers/dto/supplier.dto.js";
import { SuppliersController } from "../suppliers/suppliers.controller.js";
import { SuppliersRepository } from "../suppliers/suppliers.repository.js";
import { SuppliersService } from "../suppliers/suppliers.service.js";
import { WorksheetListQueryDto } from "../worksheets/dto/worksheet.dto.js";
import { WorksheetsController } from "../worksheets/worksheets.controller.js";
import { WorksheetsRepository } from "../worksheets/worksheets.repository.js";
import { WorksheetsService } from "../worksheets/worksheets.service.js";
import { AuthUserResolver } from "./auth-user-resolver.js";

/**
 * AZ OSSZESZERELES MERESE, ES CSAK AZ.
 *
 * A hatokor-szabaly DARABJAIT egysegtesztek bizonyitjak
 * (`partner-scope.util.spec.ts`: mit ad a helper; `partner-scope-and-branch.spec.ts`:
 * hogy a hivas `AND` agban all). Egyik sem hiv vegpontot, es egyik sem lat
 * adatbazist -- ket zold oldal kozott a VARRAT maradt probalatlan, pedig a
 * munka egesze pont arrol szol, hogy egy partner ne lasson idegen sort.
 *
 * EZ A SUITE AZT MERI, AMIT A JELENTES ALLIT: ket sor ket kulonbozo partnerhez,
 * a lekeres MINDKETTOVEL lefut, es mindegyik CSAK a sajatjat kapja. A kero
 * `AuthenticatedUser`-t nem kezzel epitjuk, hanem az `AuthUserResolver` allitja
 * elo a VALODI `User` sorbol -- igy a lanc a partner-kotest tarolo oszloptol a
 * valaszig egyben all, es nem csak a kozepetol.
 *
 * A MERCE, AMIRE MEGIRTUK: a suite akkor er valamit, ha ELBUKIK attol, hogy a
 * hatokor-szuro kikerul a tarolo retegbol. Kalibralva 2026-08-31, a szamok a
 * commit uzenetben allnak.
 *
 * MELYIK ELLENORZES MIT LAT -- ez a bekezdes azert all itt, hogy a kovetkezo
 * olvaso NE nezze duplikacionak a kettot, es ne vegye ki az egyiket. Merve,
 * ugyanazon a napon, ugyanazzal a kalibracioval:
 *
 *   - EZ A SUITE a VISELKEDEST latja: a hatokor teljes hianyat (a szuro
 *     kivetele piros lesz) es a kulcs-felulirast IS -- de a masodikat CSAK
 *     azokon a hivasokon, amik felhasznaloi szurot is visznek (`ownerId`,
 *     `customerId`). Merve: a szuro `AND` ag helyett spreadkent PONTOSAN ket
 *     allitast dont meg, mindketto ilyen hivas. A tobbi zold marad.
 *   - A `partner-scope-and-branch.spec.ts` a FORRAST latja: minden hivasi
 *     helyen, fuggetlenul attol, hogy van-e ra olyan hivas, ami a hibat
 *     eloidezne.
 *
 * Vagyis a ketto MAS hatokoru, nem ugyanaz ketszer. Egy uj `where`-epito hely,
 * amire ma nincs felhasznaloi szurot vivo teszteset, itt NEM bukna el, ott
 * igen.
 *
 * A KERESES ES A FELHASZNALOI SZURO SZANDEKOSAN SZEREPEL a hivasokban. Ez a
 * ket alak az, amitol a hatokor csendben hatastalanna valhat: a felso szintu
 * `OR` (kereses) egy ag melle sorolna a jogosultsagot, az azonos kulcsu
 * felhasznaloi szuro (`ownerId`, `customerId`) pedig FELULIRNA. Egy szures
 * nelkuli, sima lista mind a kettot atengedne.
 *
 * A suite sorokat hoz letre es torol, ezert csak tesztelesre megnevezett
 * adatbazison fut; lasd integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_EMAIL_DOMAIN = "partner-scope-integration.invalid";
const TEST_CUSTOMER_PREFIX = "PS-INT-";
const TEST_SUPPLIER_PREFIX = "PS-INT-SUP-";
const TEST_ASSET_PREFIX = "PS-INT-ASSET-";

/** A feltoltes valodi PDF-et var: a szolgaltatas a `%PDF-` fejlecet ellenorzi. */
function pdf(fileName: string): Express.Multer.File {
  const buffer = Buffer.from("%PDF-1.4 teszt");
  return {
    fieldname: "file",
    originalname: fileName,
    encoding: "7bit",
    mimetype: "application/pdf",
    size: buffer.length,
    buffer,
  } as Express.Multer.File;
}

describe(
  "Partner-hatokoru vegpontok integracio",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`.padStart(6, "0");
    /** Minden fixture-sor nevében benne áll, hogy a keresés MINDKETTŐT elérje. */
    const shared = `PSINT${suffix}`;

    const resolver = new AuthUserResolver();
    const worksheets = new WorksheetsController(
      new WorksheetsService(new WorksheetsRepository()),
    );
    const assets = new ServiceAssetsController(
      new ServiceAssetsService(new ServiceAssetsRepository()),
    );
    const suppliers = new SuppliersController(
      new SuppliersService(new SuppliersRepository()),
    );

    let customerA: string;
    let customerB: string;
    let supplierA: string;
    let supplierB: string;
    let worksheetA: string;
    let worksheetB: string;
    let assetA: string;
    let assetB: string;
    let assetSupplierA: string;
    let qrTokenA: string;
    let qrTokenB: string;
    let unitOfSupplierA: string;
    let unitOfSupplierB: string;
    let invoiceOfA: string;
    let warrantyOfA: string;
    let invoiceFileNameOfA: string;

    /** A kérő ugyanúgy áll elő, ahogy egy valódi munkamenetben: a User sorból. */
    let asCustomerA: AuthenticatedUser;
    let asCustomerB: AuthenticatedUser;
    let asSupplierA: AuthenticatedUser;
    let asInternal: AuthenticatedUser;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      const [rowA, rowB] = await Promise.all([
        prisma.customer.create({
          data: {
            customerNumber: `${TEST_CUSTOMER_PREFIX}${suffix}-A`,
            type: "COMPANY",
            displayName: `${shared} Vevo A`,
          },
        }),
        prisma.customer.create({
          data: {
            customerNumber: `${TEST_CUSTOMER_PREFIX}${suffix}-B`,
            type: "COMPANY",
            displayName: `${shared} Vevo B`,
          },
        }),
      ]);
      customerA = rowA.id;
      customerB = rowB.id;

      const [supA, supB] = await Promise.all([
        prisma.supplier.create({
          data: {
            code: `${TEST_SUPPLIER_PREFIX}${suffix}-A`,
            name: `${shared} Partner A`,
            isService: true,
          },
        }),
        prisma.supplier.create({
          data: {
            code: `${TEST_SUPPLIER_PREFIX}${suffix}-B`,
            name: `${shared} Partner B`,
            isService: true,
          },
        }),
      ]);
      supplierA = supA.id;
      supplierB = supB.id;

      /**
       * A PARTNER ALEGYSEGEI A TUKOR-VEVON keresztul erhetok el
       * (`Supplier.customerId`). Tukor nelkul a `units` vegpont MINDIG ures
       * listat ad -- vagyis a hatokor-ellenorzes kivetele sem valtoztatna a
       * valaszon, es a rola szolo teszt nem tudna elbukni. Ezert kap MINDKET
       * partner tukrot es alegyseget: az egyik a kontroll (a sajat alegyseg
       * latszik), a masik a merce (az idegene nem).
       */
      const [mirrorA, mirrorB] = await Promise.all([
        prisma.customer.create({
          data: {
            customerNumber: `${TEST_CUSTOMER_PREFIX}${suffix}-MA`,
            type: "COMPANY",
            displayName: `${shared} Tükör A`,
            partner: { connect: { id: supplierA } },
          },
        }),
        prisma.customer.create({
          data: {
            customerNumber: `${TEST_CUSTOMER_PREFIX}${suffix}-MB`,
            type: "COMPANY",
            displayName: `${shared} Tükör B`,
            partner: { connect: { id: supplierB } },
          },
        }),
      ]);
      const [unitA, unitB] = await Promise.all([
        prisma.worksheetDepartment.create({
          data: {
            customerId: mirrorA.id,
            code: "UNA",
            name: `${shared} egység A`,
          },
        }),
        prisma.worksheetDepartment.create({
          data: {
            customerId: mirrorB.id,
            code: "UNB",
            name: `${shared} egység B`,
          },
        }),
      ]);
      unitOfSupplierA = unitA.id;
      unitOfSupplierB = unitB.id;

      const [userA, userB, userSup, userInternal] = await Promise.all([
        prisma.user.create({
          data: {
            email: `customer-a-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: "Vevő A kapcsolattartó",
            role: "VIEWER",
            isActive: true,
            customerId: customerA,
          },
        }),
        prisma.user.create({
          data: {
            email: `customer-b-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: "Vevő B kapcsolattartó",
            role: "VIEWER",
            isActive: true,
            customerId: customerB,
          },
        }),
        prisma.user.create({
          data: {
            email: `supplier-a-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: "Partner A kapcsolattartó",
            role: "VIEWER",
            isActive: true,
            supplierId: supplierA,
          },
        }),
        prisma.user.create({
          data: {
            email: `internal-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: "Belsős kolléga",
            role: "OWNER",
            isActive: true,
          },
        }),
      ]);

      [asCustomerA, asCustomerB, asSupplierA, asInternal] = await Promise.all([
        resolver.resolveById(userA.id),
        resolver.resolveById(userB.id),
        resolver.resolveById(userSup.id),
        resolver.resolveById(userInternal.id),
      ]);

      const [departmentA, departmentB] = await Promise.all([
        prisma.worksheetDepartment.create({
          data: { customerId: customerA, code: "BIO", name: `${shared} A` },
        }),
        prisma.worksheetDepartment.create({
          data: { customerId: customerB, code: "BIO", name: `${shared} B` },
        }),
      ]);

      const [sheetA, sheetB] = await Promise.all([
        prisma.worksheet.create({
          data: {
            customerId: customerA,
            departmentId: departmentA.id,
            versions: {
              create: { version: 1, subject: `${shared} munka A` },
            },
          },
        }),
        prisma.worksheet.create({
          data: {
            customerId: customerB,
            departmentId: departmentB.id,
            versions: {
              create: { version: 1, subject: `${shared} munka B` },
            },
          },
        }),
      ]);
      worksheetA = sheetA.id;
      worksheetB = sheetB.id;

      const [aA, aB, aSup] = await Promise.all([
        prisma.asset.create({
          data: {
            assetNumber: `${TEST_ASSET_PREFIX}${suffix}-A`,
            name: `${shared} eszköz A`,
            customerId: customerA,
          },
        }),
        prisma.asset.create({
          data: {
            assetNumber: `${TEST_ASSET_PREFIX}${suffix}-B`,
            name: `${shared} eszköz B`,
            customerId: customerB,
          },
        }),
        prisma.asset.create({
          data: {
            assetNumber: `${TEST_ASSET_PREFIX}${suffix}-S`,
            name: `${shared} eszköz partner A`,
            supplierId: supplierA,
          },
        }),
      ]);
      assetA = aA.id;
      assetB = aB.id;
      assetSupplierA = aSup.id;
      qrTokenA = aA.qrToken;
      qrTokenB = aB.qrToken;

      /**
       * KET DOKUMENTUM A SAJAT ESZKOZON, ES A TIPUSUK A LENYEG. A tulajdonos
       * egyeztetese ONMAGABAN nem eleg: Balazs dontese szerint a partner a
       * SAJAT eszkozen sem lathat szamlat. A garancia a kontroll -- enelkul a
       * "nem latod a szamlat" allitas ugy is igaz lenne, ha egyetlen dokumentum
       * sem menne ki, es a szures tul szeles voltat semmi nem mutatna.
       *
       * A FELTOLTES A VALODI VEGPONTON MEGY, nem `prisma.assetDocument.create`
       * hivason. Nem kenyelmi kulonbseg: az eles ut ESEMENYT is ir
       * (`DOCUMENT_UPLOADED`), aminek a payloadjaban ott all a fajlnev es a
       * tipus -- es az esemenynaplo szinten az adatlapon megy ki. Egy kezzel
       * beszurt sor mellett ez a masodik hordozo nem letezne, tehat a teszt
       * pont azt nem latna, amit vedeni akar.
       */
      invoiceFileNameOfA = `${shared}-szamla.pdf`;
      const [invoice, warranty] = await Promise.all([
        assets.uploadDocument(
          assetA,
          Object.assign(new UploadAssetDocumentDto(), { type: "INVOICE" }),
          pdf(invoiceFileNameOfA),
          asInternal,
        ),
        assets.uploadDocument(
          assetA,
          Object.assign(new UploadAssetDocumentDto(), { type: "WARRANTY" }),
          pdf(`${shared}-garancia.pdf`),
          asInternal,
        ),
      ]);
      invoiceOfA = invoice.id;
      warrantyOfA = warranty.id;
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await removeLeftovers();
    });

    async function removeLeftovers() {
      // A sorrend a hivatkozasokat koveti: a `User.customerId` /
      // `User.supplierId` kapcsolat `Restrict`, tehat a fiokoknak a partner
      // ELOTT kell eltunniuk.
      await prisma.asset.deleteMany({
        where: { assetNumber: { startsWith: TEST_ASSET_PREFIX } },
      });
      const customers = await prisma.customer.findMany({
        where: { customerNumber: { startsWith: TEST_CUSTOMER_PREFIX } },
        select: { id: true },
      });
      const customerIds = customers.map((customer) => customer.id);
      if (customerIds.length > 0) {
        await prisma.worksheet.deleteMany({
          where: { customerId: { in: customerIds } },
        });
        await prisma.worksheetDepartment.deleteMany({
          where: { customerId: { in: customerIds } },
        });
      }
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });
      await prisma.supplier.deleteMany({
        where: { code: { startsWith: TEST_SUPPLIER_PREFIX } },
      });
      await prisma.customer.deleteMany({
        where: { customerNumber: { startsWith: TEST_CUSTOMER_PREFIX } },
      });
    }

    const worksheetQuery = (over: Partial<WorksheetListQueryDto> = {}) =>
      Object.assign(new WorksheetListQueryDto(), over);
    const assetQuery = (over: Partial<AssetListQueryDto> = {}) =>
      Object.assign(new AssetListQueryDto(), over);
    const supplierQuery = (over: Partial<SupplierListQueryDto> = {}) =>
      Object.assign(new SupplierListQueryDto(), over);

    /**
     * A KONTROLL A FIXTURE-RE, es ez az allitas tartja a tobbit.
     *
     * Egy hatokor-teszt, aminek a ket sora nem is letezik vagy nem is latszik,
     * ZOLDEN HAZUDIK: "nem lattad a masikat" ugyanugy igaz ures adatbazison. A
     * belsos kero pont azt bizonyitja, hogy MINDKET sor lekerdezheto ezen az
     * uton -- tehat a partner-koroknel a hianyzo sor DONTES, nem veletlen.
     */
    it("kontroll: a belsős kérő MINDKÉT partner sorát látja", async () => {
      const sheets = await worksheets.list(
        worksheetQuery({ search: shared }),
        asInternal,
      );
      assert.deepEqual(
        sheets.items.map((item) => item.id).sort(),
        [worksheetA, worksheetB].sort(),
      );

      const list = await assets.list(
        assetQuery({ search: shared }),
        asInternal,
      );
      assert.deepEqual(
        list.items.map((item) => item.id).sort(),
        [assetA, assetB, assetSupplierA].sort(),
      );

      const partners = await suppliers.list(
        supplierQuery({ search: shared }),
        asInternal,
      );
      assert.deepEqual(
        partners.items.map((item) => item.id).sort(),
        [supplierA, supplierB].sort(),
      );
    });

    describe("GET /worksheets", () => {
      it("mindegyik vevő CSAK a saját lapját kapja", async () => {
        const forA = await worksheets.list(worksheetQuery({}), asCustomerA);
        assert.deepEqual(
          forA.items.map((item) => item.id),
          [worksheetA],
        );
        assert.equal(forA.pagination.totalItems, 1);

        const forB = await worksheets.list(worksheetQuery({}), asCustomerB);
        assert.deepEqual(
          forB.items.map((item) => item.id),
          [worksheetB],
        );
        assert.equal(forB.pagination.totalItems, 1);
      });

      /**
       * A KERESES FELSO SZINTU `OR`-t epit. Ha a hatokor ugyanarra a szintre
       * kerulne, a talalat az `OR` barmelyik agatol atmenne -- vagyis pont az a
       * keres hozna fel az idegen lapot, amiben a vevo a sajat nevere keres.
       */
      it("a keresés nem nyitja meg az idegen lapot", async () => {
        const forA = await worksheets.list(
          worksheetQuery({ search: shared }),
          asCustomerA,
        );
        assert.deepEqual(
          forA.items.map((item) => item.id),
          [worksheetA],
        );
      });

      /**
       * A FELHASZNALOI SZURO UGYANAZT A KULCSOT hasznalja, mint a jogosultsagi
       * (`customerId`). Egy objektum-literalban az utolso nyerne, tehat a kero
       * a MASIK partner azonositojaval kikapcsolhatna a sajat szureset.
       */
      it("idegen customerId szűrővel sem jön fel idegen lap", async () => {
        const forA = await worksheets.list(
          worksheetQuery({ customerId: customerB }),
          asCustomerA,
        );
        assert.deepEqual(forA.items, []);
        assert.equal(forA.pagination.totalItems, 0);
      });
    });

    describe("GET /worksheets/:id", () => {
      it("a saját lap betölthető", async () => {
        const detail = await worksheets.detail(worksheetA, asCustomerA);
        assert.equal(detail.id, worksheetA);
      });

      /** 404, nem 403: a letezes maga sem szivarog ki. */
      it("az idegen lap NEM tölthető be, és 404-et ad", async () => {
        await assert.rejects(
          () => worksheets.detail(worksheetB, asCustomerA),
          NotFoundException,
        );
      });
    });

    describe("GET /service/assets", () => {
      it("mindegyik vevő CSAK a saját eszközét kapja", async () => {
        const forA = await assets.list(
          assetQuery({ search: shared }),
          asCustomerA,
        );
        assert.deepEqual(
          forA.items.map((item) => item.id),
          [assetA],
        );

        const forB = await assets.list(
          assetQuery({ search: shared }),
          asCustomerB,
        );
        assert.deepEqual(
          forB.items.map((item) => item.id),
          [assetB],
        );
      });

      /**
       * EZ AZ AN ALLITAS, AMIERT A KET FELIDO EGYUTT TARTOZIK. A `scan/:qrToken`
       * vegpont SZANDEKOSAN nem ellenoriz tulajdonost (a token 128 bites veletlen
       * uuid), tehat a lista szurese az EGYETLEN dolog, ami miatt egy partner nem
       * jut hozza egy idegen eszkoz tokenjehez. A tokent a valasz EGESZEBEN
       * keressuk, nem csak a sor azonositojat nezve: egy szivargas nem feltetlenul
       * kulon sorkent jelenik meg.
       */
      it("az idegen eszköz qrToken-je SEHOL nem jelenik meg a válaszban", async () => {
        const forA = await assets.list(
          assetQuery({ search: shared }),
          asCustomerA,
        );
        assert.ok(qrTokenB.length > 0, "a kontrollhoz kell egy valódi token");
        assert.equal(JSON.stringify(forA).includes(qrTokenB), false);
      });

      /** Ugyanaz a kulcs-utkozes, mint a munkalapnal: `ownerId` a `customerId`-ra megy. */
      it("idegen ownerId szűrővel sem jön fel idegen eszköz", async () => {
        const forA = await assets.list(
          assetQuery({ ownerType: "CUSTOMER", ownerId: customerB }),
          asCustomerA,
        );
        assert.deepEqual(forA.items, []);
      });

      /**
       * A KET PARTNER-AG NEM LAT AT EGYMASHOZ. Az eszkoz ket oszlopon kotodhet,
       * es egy vevo-hatokoru kero nem lathat szerviz-partner eszkozt attol, hogy
       * a masik oszlopban all egy azonosito.
       */
      it("a szállító-hatókörű kérő a saját eszközét kapja, a vevőkét nem", async () => {
        const forSupplier = await assets.list(
          assetQuery({ search: shared }),
          asSupplierA,
        );
        assert.deepEqual(
          forSupplier.items.map((item) => item.id),
          [assetSupplierA],
        );
      });
    });

    describe("GET /service/assets/:id", () => {
      it("az idegen eszköz NEM tölthető be, és 404-et ad", async () => {
        await assert.rejects(
          () => assets.detail(assetB, asCustomerA),
          NotFoundException,
        );
        assert.equal((await assets.detail(assetA, asCustomerA)).id, assetA);
      });
    });

    /**
     * A DOKUMENTUM-TIPUS SZABALYA MINDKET UTON, NEM CSAK A LETOLTESIN.
     *
     * Murena masodik olvasata (2026-08-31) nevezte meg a rest, es a merese
     * szerkezeti volt: a `scopeMaySeeDocumentType` EGYETLEN eles hivasi helyen
     * allt, a letoltesben. Az adatlap viszont behuzza a dokumentumokat, es
     * valtozatlanul kepezi le oket -- vagyis a partner megkapta a SZAMLA
     * letezeset, a fajlnevet, a meretet, a lenyomatot es a feltolto KOLLEGA
     * nevet, mikozben a letoltes ugyanarra 404-et adott.
     *
     * UGYANAZ AZ ALAK, AMIT A SPEC 4.1 MAR LEIR eggyel kintebb: egy elem-szintu
     * korlat hatastalan, ha egy MASIK valasz hordozza azt, amit vedeni akart.
     * Ott a lista vitte a `qrToken`-t, itt az adatlap viszi a szamla adatait.
     */
    describe("A számla a partner elől mindkét úton rejtve marad", () => {
      /** A kontroll: a belsős kérőnél MINDKÉT dokumentum kimegy. */
      it("kontroll: a belsős kérő a számlát is látja az adatlapon", async () => {
        const detail = await assets.detail(assetA, asInternal);
        assert.deepEqual(
          detail.documents.map((document) => document.id).sort(),
          [invoiceOfA, warrantyOfA].sort(),
        );
      });

      it("a partner a saját eszközén NEM kapja meg a számlát, a garanciát igen", async () => {
        const detail = await assets.detail(assetA, asCustomerA);
        assert.deepEqual(
          detail.documents.map((document) => document.id),
          [warrantyOfA],
        );
      });

      /**
       * A SOR AZONOSITOJA NEM AZ EGESZ VALASZ. A szivargas itt nem kulon
       * sorkent all, hanem metaadatkent (fajlnev, lenyomat, feltolto neve),
       * ezert a teljes valaszban keresunk.
       */
      it("a számla fájlneve SEHOL nem jelenik meg a partner válaszában", async () => {
        const detail = await assets.detail(assetA, asCustomerA);
        assert.ok(
          invoiceFileNameOfA.length > 0,
          "a mércéhez kell egy valódi fájlnév",
        );
        assert.equal(
          JSON.stringify(detail).includes(invoiceFileNameOfA),
          false,
        );
      });

      /**
       * A `scan` VEGPONT UGYANEZT A VALASZT ADJA VISSZA, es a spec 4.1 szerint
       * SZANDEKOSAN nem ellenoriz tulajdonost: a token maga a kulcs. A
       * TULAJDONOS kerdese ettol el van dontve, a DOKUMENTUM-TIPUSE viszont nem
       * -- a partner a sajat eszkoze tokenjet jogosan ismeri, tehat ezen az uton
       * ugyanugy hozzajutna a szamlahoz.
       */
      it("a scan végpont sem adja ki a számlát partner-hatókörű kérőnek", async () => {
        const scanned = await assets.scan(qrTokenA, asCustomerA);
        assert.deepEqual(
          scanned.documents.map((document) => document.id),
          [warrantyOfA],
        );

        const internalScan = await assets.scan(qrTokenA, asInternal);
        assert.deepEqual(
          internalScan.documents.map((document) => document.id).sort(),
          [invoiceOfA, warrantyOfA].sort(),
        );
      });

      /**
       * A NEGYEDIK HORDOZO: AZ ESEMENYNAPLO. A feltoltes `DOCUMENT_UPLOADED`
       * esemenyt ir, aminek a payloadjaban ott all a `documentType` es a
       * `fileName`. A dokumentum-lista szurese utan is ez MARADT az egyetlen
       * hely, ahol a szamla neve kiment a partnerhez -- merve, mielott a szures
       * bekerult volna.
       *
       * A GARANCIA ESEMENYE A KONTROLL: a szures nem az esemenynaplot veszi el,
       * csak azt a sort, ami olyan dokumentumrol szol, amit a kero ugysem lat.
       */
      it("a számla feltöltési eseménye sem megy ki, a garanciáé igen", async () => {
        const forPartner = await assets.detail(assetA, asCustomerA);
        const documentEvents = forPartner.events.filter(
          (event) => event.type === "DOCUMENT_UPLOADED",
        );
        assert.deepEqual(
          documentEvents.map((event) => event.payload.documentType),
          ["WARRANTY"],
        );

        const forInternal = await assets.detail(assetA, asInternal);
        assert.deepEqual(
          forInternal.events
            .filter((event) => event.type === "DOCUMENT_UPLOADED")
            .map((event) => event.payload.documentType)
            .sort(),
          ["INVOICE", "WARRANTY"],
        );
      });

      /** A letoltesi ut, ami eddig is helyes volt: a merce mindket iranyban all. */
      it("a letöltés a garanciát adja, a számlára 404-et", async () => {
        await assert.rejects(
          () => assets.downloadDocument(assetA, invoiceOfA, asCustomerA),
          NotFoundException,
        );
        const file = await assets.downloadDocument(
          assetA,
          warrantyOfA,
          asCustomerA,
        );
        assert.ok(file);
      });
    });

    describe("GET /suppliers", () => {
      it("a szállító CSAK a saját sorát látja", async () => {
        const forSupplier = await suppliers.list(
          supplierQuery({ search: shared }),
          asSupplierA,
        );
        assert.deepEqual(
          forSupplier.items.map((item) => item.id),
          [supplierA],
        );
        assert.equal(forSupplier.pagination.totalItems, 1);
      });

      /**
       * A KERESZT-ESET, ES EZ NEM UGYANAZ, MINT A SZUKITES. A vevo-hatokoru kero
       * a szallitok tablajan URES halmazt kap, nem szuretlent: egy `{}` feltetel
       * itt a TELJES partnerlistat adna vissza.
       */
      it("a vevő-hatókörű kérő egyetlen szállítót sem lát", async () => {
        const forCustomer = await suppliers.list(
          supplierQuery({ search: shared }),
          asCustomerA,
        );
        assert.deepEqual(forCustomer.items, []);
        assert.equal(forCustomer.pagination.totalItems, 0);
      });
    });

    describe("GET /suppliers/:id és /:id/units", () => {
      it("az idegen partner adatlapja 404", async () => {
        assert.equal(
          (await suppliers.detail(supplierA, asSupplierA)).id,
          supplierA,
        );
        await assert.rejects(
          () => suppliers.detail(supplierB, asSupplierA),
          NotFoundException,
        );
      });

      /**
       * Itt nincs betoltott sor: maga az utvonal-parameter a tulajdonos.
       *
       * A KONTROLL ELOSZOR FUT, es nem udvariassagbol. A `units` vegpont tukor
       * nelkul is ures listat ad, tehat egy onallo "ures a valasz" allitas
       * akkor is zold lenne, ha az ellenorzest kivennenk. A sajat alegyseg
       * megjelenese bizonyitja, hogy ez az ut EGYALTALAN tud sort visszaadni.
       */
      it("a saját alegység látszik, az idegené nem", async () => {
        const own = await suppliers.units(supplierA, asSupplierA);
        assert.deepEqual(
          own.items.map((item) => item.id),
          [unitOfSupplierA],
        );

        const foreign = await suppliers.units(supplierB, asSupplierA);
        assert.deepEqual(foreign.items, []);
        assert.ok(
          unitOfSupplierB.length > 0,
          "a mércéhez kell egy létező idegen alegység",
        );
      });
    });
  },
);
