import "reflect-metadata";

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";

import { AppModule } from "../app.module.js";
import { configureApp } from "../app.configuration.js";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { hashPassword } from "../users/password.util.js";

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
      ]);

      const [aA, aB] = await Promise.all([
        prisma.asset.create({
          data: {
            assetNumber: `${TEST_ASSET_PREFIX}${suffix}-A`,
            name: `HTTP eszköz A ${suffix}`,
            customerId: customerA.id,
          },
        }),
        prisma.asset.create({
          data: {
            assetNumber: `${TEST_ASSET_PREFIX}${suffix}-B`,
            name: `HTTP eszköz B ${suffix}`,
            customerId: customerB.id,
          },
        }),
      ]);
      assetA = aA.id;
      assetB = aB.id;
      qrTokenB = aB.qrToken;

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
    });

    after(async () => {
      if (gate.mode !== "run") return;
      if (app) await app.close();
      await removeLeftovers();
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

    it("az idegen eszköz adatlapja 404, a sajátja 200", async () => {
      const own = await get(`/service/assets/${assetA}`, tokenA);
      assert.equal(own.status, 200);

      const foreign = await get(`/service/assets/${assetB}`, tokenA);
      assert.equal(foreign.status, 404);
    });
  },
);
