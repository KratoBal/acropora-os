import "reflect-metadata";

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { nincsMaradek } from "../common/takaritas-leltar.js";

import { prisma } from "@acropora/database";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";

import { AppModule } from "../app.module.js";
import { configureApp } from "../app.configuration.js";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { hashPassword } from "../users/password.util.js";
import {
  DOCUMENT_THUMBNAIL_VARIANT,
  DOCUMENT_VARIANT_PARAM,
} from "@acropora/types";

/**
 * A PARTNER-HATOKOR VALODI HTTP-N, ES CSAK AZ.
 *
 * A testver-suite (`partner-scope-endpoint.integration.spec.ts`) a kontrollert
 * hivja kozvetlenul, tehat a lanc a `partnerScopeOf` hivastol lefele all
 * egyben. AMI OTT NEM FUT: a guardok, a jogosultsagi dekoratorok es a
 * validacios pipe. Egy hatokor-hiba, ami GUARDBAN lakna, ott NEM latszana --
 * ezt minden eddigi commit uzenete kiirta "nem fedett" cimszo alatt, es ez a
 * fajl az, ami lezarja.
 *
 * A KETTO NEM DUPLIKACIO. Ez a suite DRAGA (teljes Nest alkalmazas indul, es
 * valodi bejelentkezes tortenik), ezert NEM ismetli meg a testver-suite
 * huszonhat allitasat: azt meri, ami CSAK itt merheto -- hogy a kapu
 * egyaltalan lefut, es hogy a hatokor a teljes keresi uton at is all.
 *
 * A RES VALODI, ES EZ KET MERES, NEM EGY (acrobot kikotese, 2026-08-31). Egy uj
 * suite-tol keves azt allitani, hogy O eszreveszi a hibat; azt kell megmutatni,
 * hogy RAJTA KIVUL SENKI. A hasznalt romlas-proba a `AuthGuard`-ban ul, es
 * hihetobb, mint egy kitalalt hiba: a guard "rendbe teszi" a felhasznalot, es
 * kozben elejti a partner-kotest (`customerId` es `supplierId` nullara). Ettol
 * MINDEN kero belsosnek latszik.
 *
 *   1. lepes -- a romlassal a MEGLEVO halmazok VEGIG ZOLDEK: 1448 egysegteszt es
 *      56 kontroller-szintu integracios teszt, koztuk a guard SAJAT spec-je
 *      (`auth.guard.spec.ts`) is. Az a fajl a guard vezerlesi agait allitja, nem
 *      azt, MIT AD TOVABB -- ezert megy at rajta.
 *   2. lepes -- ugyanarra a romlasra ez a suite 5-bol 3 allitast megdont.
 *
 * Az elso lepes a fontosabb, es azt szoktuk kihagyni.
 *
 * A JELSZAVAS BEJELENTKEZES SZANDEKOSAN A VALODI UT. A `mobile/login/password`
 * vegpont Bearer tokent ad vissza a torzsben, tehat nem kell sutis kliens; a
 * hitelesites viszont ugyanaz a kod, mint eleseben.
 *
 * A suite sorokat hoz letre es torol, ezert csak tesztelesre megnevezett
 * adatbazison fut; lasd integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_EMAIL_DOMAIN = "partner-scope-http.invalid";
const TEST_CUSTOMER_PREFIX = "PS-HTTP-";
const TEST_ASSET_PREFIX = "PS-HTTP-ASSET-";
const PASSWORD = "correct horse battery staple";

describe(
  "Partner-hatokor valodi HTTP-n",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    let app: INestApplication;
    let base: string;

    let assetA: string;
    let assetB: string;
    let qrTokenB: string;
    let tokenA: string;
    let tokenB: string;
    let tokenInternal: string;
    /** Olyan szerep, ami NEM viszi a `SERVICE_VIEW` jogot -- a dekorator merceje. */
    let tokenWithoutServiceView: string;
    /**
     * MANAGER: MINDEN MAS SZEMPONTBOL JOGOSULT, es PONTOSAN a torles joga
     * hianyzik neki. Ez nem kenyelmi valasztas -- egy olyan keroval, aki amugy
     * sem jutna el a vegpontig, a 403-at nem a dekorator adna, es azt hinnenk,
     * hogy igen. (Ugyanaz a csapda, amit ma delutan a webes valasztonal talaltam
     * meg: az allitas atment, mert egy MASIK feltetel is hamissa tette az agat.)
     */
    let tokenManager: string;
    let deletableAsset: string;
    /** Kepes csatolmany az A vevo eszkozen -- a `variant` parameter merESEhez. */
    let kepDokumentumId: string;

    async function login(email: string): Promise<string> {
      const response = await fetch(`${base}/auth/mobile/login/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD }),
      });
      assert.equal(response.status, 201, `bejelentkezés: ${email}`);
      const body = (await response.json()) as { token: string };
      assert.ok(body.token, "a bejelentkezés tokent ad vissza");
      return body.token;
    }

    function get(path: string, token?: string) {
      return fetch(`${base}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      const [customerA, customerB] = await Promise.all([
        prisma.customer.create({
          data: {
            customerNumber: `${TEST_CUSTOMER_PREFIX}${suffix}-A`,
            type: "COMPANY",
            displayName: `HTTP Vevo A ${suffix}`,
          },
        }),
        prisma.customer.create({
          data: {
            customerNumber: `${TEST_CUSTOMER_PREFIX}${suffix}-B`,
            type: "COMPANY",
            displayName: `HTTP Vevo B ${suffix}`,
          },
        }),
      ]);

      /*
        HELYSZIN MINDKET VEVONEK, 2026-09-22 OTA.

        A vevo-hatokoru olvasas a HOZZARENDELT helyszinekre szur, es a NULL
        `departmentId` azon nem megy at. Helyszin es hozzarendeles nelkul ez a
        fixtura nem a TULAJDON hatarat merne, hanem egy ures listat -- es minden
        lenti tiltas zold lenne, barmit is csinal a kod.
      */
      const [helyA, helyB] = await Promise.all([
        prisma.worksheetDepartment.create({
          data: {
            customerId: customerA.id,
            code: "HTA",
            name: `hely A ${suffix}`,
          },
          select: { id: true },
        }),
        prisma.worksheetDepartment.create({
          data: {
            customerId: customerB.id,
            code: "HTB",
            name: `hely B ${suffix}`,
          },
          select: { id: true },
        }),
      ]);

      const passwordHash = await hashPassword(PASSWORD);
      await Promise.all([
        prisma.user.create({
          data: {
            email: `a-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: "HTTP Vevő A kapcsolattartó",
            role: "VIEWER",
            isActive: true,
            passwordHash,
            passwordUpdatedAt: new Date(),
            customerId: customerA.id,
            // A KET FELHASZNALO KULONBOZO helyszint kap: e nelkul egy
            // "mindent atengedo" es egy "helyesen szukito" szuro ugyanazt adna.
            unitAssignments: { create: [{ departmentId: helyA.id }] },
          },
        }),
        prisma.user.create({
          data: {
            email: `b-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: "HTTP Vevő B kapcsolattartó",
            role: "VIEWER",
            isActive: true,
            passwordHash,
            passwordUpdatedAt: new Date(),
            customerId: customerB.id,
            unitAssignments: { create: [{ departmentId: helyB.id }] },
          },
        }),
        prisma.user.create({
          data: {
            email: `internal-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: "HTTP Belsős kolléga",
            role: "OWNER",
            isActive: true,
            passwordHash,
            passwordUpdatedAt: new Date(),
          },
        }),
        /**
         * SAJAT KOLLEGA, DE OLYAN SZEREPPEL, AMI NEM VISZI A `SERVICE_VIEW`
         * JOGOT. A partner-kotes itt NULL, tehat a hatokor belsos -- amit merunk,
         * az NEM a hatokor, hanem a jogosultsagi dekorator.
         */
        prisma.user.create({
          data: {
            email: `manager-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: "HTTP Vezető kolléga",
            role: "MANAGER",
            isActive: true,
            passwordHash,
            passwordUpdatedAt: new Date(),
          },
        }),
        prisma.user.create({
          data: {
            email: `sales-${suffix}@${TEST_EMAIL_DOMAIN}`,
            displayName: "HTTP Értékesítő kolléga",
            role: "SALES",
            isActive: true,
            passwordHash,
            passwordUpdatedAt: new Date(),
          },
        }),
      ]);

      const [aA, aB] = await Promise.all([
        prisma.asset.create({
          data: {
            assetNumber: `${TEST_ASSET_PREFIX}${suffix}-A`,
            name: `HTTP eszköz A ${suffix}`,
            customerId: customerA.id,
            departmentId: helyA.id,
          },
        }),
        prisma.asset.create({
          data: {
            assetNumber: `${TEST_ASSET_PREFIX}${suffix}-B`,
            name: `HTTP eszköz B ${suffix}`,
            customerId: customerB.id,
            departmentId: helyB.id,
          },
        }),
      ]);
      assetA = aA.id;
      assetB = aB.id;

      /*
        KEPES CSATOLMANY, KET KULONBOZO TARTALOMMAL.
        A teljes tartalom es a belyegkep SZANDEKOSAN mas szoveg: igy a valasz
        MAGA mondja meg, melyik agat jartuk be. Azonos bajtokkal a `variant`
        parameter eltuneset semmi nem mutatna meg.
        `MANUAL`, mert a vevo CSAK `WARRANTY` vagy `MANUAL` tipust lat -- mas
        tipussal a jogos kero sem jutna el a belyegkep-agig.
      */
      kepDokumentumId = (
        await prisma.assetDocument.create({
          data: {
            assetId: assetA,
            type: "MANUAL",
            fileName: `${TEST_ASSET_PREFIX}${suffix}-kep.png`,
            contentType: "image/png",
            sizeBytes: 16,
            sha256: "0".repeat(64),
            content: Buffer.from("eredeti-kep-http"),
            thumbnail: Buffer.from("belyegkep-http"),
          },
          select: { id: true },
        })
      ).id;
      qrTokenB = aB.qrToken;

      /**
       * KULON ESZKOZ A TORLES-PROBAHOZ: a masik kettore allitasok epulnek, es
       * egy sikeres torles kihuzna a talajt aluluk.
       */
      deletableAsset = (
        await prisma.asset.create({
          data: {
            assetNumber: `${TEST_ASSET_PREFIX}${suffix}-D`,
            name: `HTTP eszköz törléshez ${suffix}`,
            customerId: customerA.id,
            departmentId: helyA.id,
          },
        })
      ).id;

      app = await NestFactory.create(AppModule, { logger: false });
      // UGYANAZ A KONFIGURACIO, MINT ELESBEN. Enelkul a validacios pipe nem
      // futna, es a suite pont azt hagyna ki, amiert keszult.
      configureApp(app);
      await app.listen(0, "127.0.0.1");
      const address = app.getHttpServer().address() as AddressInfo;
      base = `http://127.0.0.1:${address.port}`;

      tokenA = await login(`a-${suffix}@${TEST_EMAIL_DOMAIN}`);
      tokenB = await login(`b-${suffix}@${TEST_EMAIL_DOMAIN}`);
      tokenInternal = await login(`internal-${suffix}@${TEST_EMAIL_DOMAIN}`);
      tokenManager = await login(`manager-${suffix}@${TEST_EMAIL_DOMAIN}`);
      tokenWithoutServiceView = await login(
        `sales-${suffix}@${TEST_EMAIL_DOMAIN}`,
      );
    });

    after(async () => {
      if (gate.mode !== "run") return;
      if (app) await app.close();
      await removeLeftovers();
      /**
       * ES A TAKARITAS EREDMENYET MEG IS MERJUK: minden `deleteMany` nulla
       * sorra is sikeres, tehat egy elcsuszott elotag vagy domain pontosan ugy
       * nez ki, mint egy tiszta futas.
       *
       * A `Session` NEM SZEREPEL: a `userId` `Cascade`, tehat a fiok torlese
       * elviszi -- a takaritas sajat sora gyorsitas, nem vedelem. A masik
       * harom viszont kulon all, mert az `Asset.customerId` es a
       * `User.customerId` is `Restrict`: ott nem a torles VISZI a masikat,
       * hanem a sorrendjuk kotott.
       */
      nincsMaradek([
        {
          nev: "a suite eszkozei bent maradtak a takaritas utan",
          darab: await prisma.asset.count({
            where: { assetNumber: { startsWith: TEST_ASSET_PREFIX } },
          }),
        },
        {
          nev: "a suite fiokjai bent maradtak a takaritas utan",
          darab: await prisma.user.count({
            where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
          }),
        },
        {
          nev: "a suite vevoi bent maradtak a takaritas utan",
          darab: await prisma.customer.count({
            where: { customerNumber: { startsWith: TEST_CUSTOMER_PREFIX } },
          }),
        },
      ]);
    });

    async function removeLeftovers() {
      await prisma.asset.deleteMany({
        where: { assetNumber: { startsWith: TEST_ASSET_PREFIX } },
      });
      const users = await prisma.user.findMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
        select: { id: true },
      });
      if (users.length > 0) {
        await prisma.session.deleteMany({
          where: { userId: { in: users.map((user) => user.id) } },
        });
      }
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });
      // A HELYSZIN az eszkozok ES a felhasznalok UTAN megy: az `Asset` es a
      // `UserWorksheetDepartment` is ra mutat. A masodik kaszkadol, az elso nem.
      await prisma.worksheetDepartment.deleteMany({
        where: {
          customer: { customerNumber: { startsWith: TEST_CUSTOMER_PREFIX } },
        },
      });
      await prisma.customer.deleteMany({
        where: { customerNumber: { startsWith: TEST_CUSTOMER_PREFIX } },
      });
    }

    /**
     * A KAPU MAGA. Ez az egyetlen allitas, ami a testver-suite-ban ELVBOL nem
     * merheto: ott nincs guard, tehat a "token nelkul nem megy" kerdes fel sem
     * merul.
     */
    it("token nélkül a végpont 401-et ad", async () => {
      const response = await get("/service/assets");
      assert.equal(response.status, 401);
    });

    /**
     * A JOGOSULTSAGI DEKORATOR, ES EZ MASIK TENGELY, MINT A HATOKOR.
     *
     * Merve 2026-08-31, mielott ez az allitas megszuletett: a
     * `@RequirePermissions(SERVICE_VIEW)` levetele a lista-vegpontrol NULLA
     * tesztet vitt pirosra -- sem az 1448 egysegteszt, sem a 30 kontroller-szintu
     * allitas, sem ez a suite nem vette eszre, mert MINDEN korabbi kero
     * rendelkezik ezzel a joggal. A res tehat a sajat suite-omban is ott volt.
     *
     * A kero SAJAT kollega (partner-kotes nelkul), tehat a hatokor belsos: ha ez
     * az allitas elbukik, az CSAK a dekoratorrol szolhat, semmi masrol.
     */
    it("SERVICE_VIEW jog nélküli kolléga 403-at kap", async () => {
      const response = await get("/service/assets", tokenWithoutServiceView);
      assert.equal(response.status, 403);
    });

    /**
     * A TORLES JOGA FUTASIDOBEN, ES EZ A LEGDRAGABB VEGPONT.
     *
     * A `SERVICE_ASSET_DELETE` MA UJ jog, es ma dontottunk ugy, hogy NEM
     * tagitjuk, amig Balazs nem valaszol. Egy szukitett jog, amit futasidoben
     * senki nem probal ki, ugyanolyan allitas, mint egy zold szam meres nelkul
     * -- es itt a tevedes ara egy VISSZAFORDITHATATLAN torles.
     *
     * A `route-permission-coverage.spec.ts` SZERKEZETILEG orzi, hogy minden
     * utvonalon ALL dekorator; azt viszont nem tudja megmondani, hogy a HELYES
     * jogot nevezi-e meg, es hogy a kapu tenylegesen zar-e. Ez a ket allitas
     * arrol szol.
     */
    it("SERVICE_ASSET_DELETE nélkül a törlés 403, a joggal 200", async () => {
      const forbidden = await fetch(
        `${base}/service/assets/${deletableAsset}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${tokenManager}` },
        },
      );
      assert.equal(forbidden.status, 403);
      assert.ok(
        await prisma.asset.findUnique({ where: { id: deletableAsset } }),
        "az őrző akkor őrző, ha nem történt semmi",
      );

      const allowed = await fetch(`${base}/service/assets/${deletableAsset}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokenInternal}` },
      });
      assert.equal(allowed.status, 200);
      assert.equal(
        await prisma.asset.findUnique({ where: { id: deletableAsset } }),
        null,
      );
    });

    it("a belsős kérő MINDKÉT eszközt megkapja", async () => {
      const response = await get(
        `/service/assets?search=HTTP%20eszk&pageSize=100`,
        tokenInternal,
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as { items: { id: string }[] };
      const ids = body.items.map((item) => item.id);
      assert.ok(
        ids.includes(assetA) && ids.includes(assetB),
        "kontroll: enélkül a partner-körök üres adatbázison is igazak lennének",
      );
    });

    it("mindegyik partner CSAK a saját eszközét kapja meg", async () => {
      for (const [token, own, foreign] of [
        [tokenA, assetA, assetB],
        [tokenB, assetB, assetA],
      ] as const) {
        const response = await get(
          `/service/assets?search=HTTP%20eszk&pageSize=100`,
          token,
        );
        assert.equal(response.status, 200);
        const body = (await response.json()) as { items: { id: string }[] };
        assert.deepEqual(
          body.items.map((item) => item.id),
          [own],
        );
        assert.equal(JSON.stringify(body).includes(foreign), false);
      }
    });

    /** A lista hordozza a `qrToken`-t, es a `scan` vegpont nem ellenoriz tulajdonost. */
    it("az idegen eszköz qrToken-je nem megy ki a partnernek", async () => {
      const response = await get(
        `/service/assets?search=HTTP%20eszk&pageSize=100`,
        tokenA,
      );
      const text = await response.text();
      assert.ok(qrTokenB.length > 0, "a mércéhez kell egy valódi token");
      assert.equal(text.includes(qrTokenB), false);
    });

    /**
     * A `variant` PARAMETER ATVETELE, ES EZT CSAK ITT LEHET MERNI.
     *
     * A kontrolleren `@Query("variant") variant?: string` all, es a metodus
     * tovabbadja a szolgaltatasnak. EGY EGYSEG-TESZT EZT NEM TUDNA MERNI: ha a
     * metodust kozvetlenul hivjuk, azt kapja, amit atadunk -- a dekorator
     * KIVETELE utan is. Vagyis egy olyan allitas lenne, ami NEM TUD ELBUKNI.
     * A dekorator hatasa csak a HTTP-retegen at latszik, ezert all ez itt.
     *
     * A KET HIVAS EGYUTT ALLIT, es a sorrendjuk nem mindegy:
     *   1. parameter NELKUL -> az EREDETI tartalom. Ez a kontroll: bizonyitja,
     *      hogy a vegpont el, a jogosultsag rendben, es a bajtok jonnek.
     *   2. `?variant=thumbnail` -> a BELYEGKEP. Ez az allitas.
     * A ket tartalom SZANDEKOSAN kulonbozo szoveg: azonos bajtokkal a parameter
     * eltunese lathatatlan maradna, mert mind a ket hivas ugyanazt adna.
     *
     * EDDIG EZT CSAK FORRAS-SZOVEG ORIZTE (`document-thumbnail-wiring.spec.ts`
     * 119. sora). Az az allitas MARAD, horgonynak: a TORLEST tovabbra is az
     * fogja meg, a HATASTALANSAGOT ez.
     */
    it("a letöltés a variant paramétert VALÓDI HTTP-n is átveszi", async () => {
      const teljes = await get(
        `/service/assets/${assetA}/documents/${kepDokumentumId}`,
        tokenA,
      );
      assert.equal(teljes.status, 200, "a teljes letöltés nem 200-at adott");
      assert.equal(
        Buffer.from(await teljes.arrayBuffer()).toString(),
        "eredeti-kep-http",
        "paraméter nélkül nem az eredeti tartalom jött",
      );

      const csempe = await get(
        `/service/assets/${assetA}/documents/${kepDokumentumId}` +
          `?${DOCUMENT_VARIANT_PARAM}=${DOCUMENT_THUMBNAIL_VARIANT}`,
        tokenA,
      );
      assert.equal(csempe.status, 200, "a bélyegkép-kérés nem 200-at adott");
      assert.equal(
        Buffer.from(await csempe.arrayBuffer()).toString(),
        "belyegkep-http",
        "a variant paraméter nem ért el a szolgáltatásig: az eredeti jött vissza",
      );
    });

    it("az idegen eszköz adatlapja 404, a sajátja 200", async () => {
      const own = await get(`/service/assets/${assetA}`, tokenA);
      assert.equal(own.status, 200);

      const foreign = await get(`/service/assets/${assetB}`, tokenA);
      assert.equal(foreign.status, 404);
    });
  },
);
