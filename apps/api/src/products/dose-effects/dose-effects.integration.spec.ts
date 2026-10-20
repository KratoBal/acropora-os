import "reflect-metadata";

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../../app.module.js";
import { configureApp } from "../../app.configuration.js";
import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { hashPassword } from "../../users/password.util.js";

/**
 * THE PRODUCT DOSE LIST THROUGH THE OS API (ReefClub plan v6.1, 6.2; slice 7).
 *
 *   - a row is recorded by one colleague and becomes usable only when ANOTHER
 *     one checks the version they saw; the recorder cannot check it, and a
 *     stale version is refused (409);
 *   - any edit is a new version and clears the check; every version is kept;
 *   - a usable row has a source, two colleagues, the daily maximum, the JEV's
 *     agreement and a purchasable product, and each missing one is named;
 *   - the JEV's row suggestion reads only, and offers the effects without a
 *     live row; the numbers stay empty;
 *   - a viewer reads and cannot write.
 *
 * Runs only on a database named for testing; see integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const EMAIL_DOMAIN = "adag-lista.invalid";
const PREFIX = "ADAG-LISTA-PROBA ";
const PASSWORD = "adag lista jelszo";

describe(
  "termék-adag lista (ReefClub 7. szelet)",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    let app: INestApplication;
    let base: string;
    const bearer: Record<string, string> = {};
    const userId: Record<string, string> = {};
    let product: string;
    let otherProduct: string;
    let rowId: string;

    const email = (name: string) => `${name}-${suffix}@${EMAIL_DOMAIN}`;

    async function call(
      who: string,
      path: string,
      init: { method?: string; body?: unknown } = {},
    ): Promise<{ status: number; body: any }> {
      const response = await fetch(`${base}${path}`, {
        method: init.method ?? "GET",
        headers: {
          authorization: `Bearer ${bearer[who]}`,
          ...(init.body !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    }

    async function jev(productId: string, value: string, status = "VERIFIED") {
      await prisma.productEnrichmentRun.create({
        data: {
          requestedById: userId.a!,
          status: "COMPLETED",
          productLimit: 1,
          requestLimit: 1,
          products: {
            create: {
              productId,
              checkedAt: new Date(),
              sourceCount: 1,
              fieldCount: 2,
              fields: {
                create: [
                  {
                    field: "waterParameterEffects",
                    tier: "C",
                    status,
                    value: status === "VERIFIED" ? value : null,
                    currentValue: status === "UNVERIFIED" ? value : null,
                    sourceRef: "https://gyarto.example.invalid/termek",
                    evidence: [],
                  },
                  {
                    field: "dosing",
                    tier: "C",
                    status: "VERIFIED",
                    value: "5 ml/100 L/day",
                    evidence: [],
                  },
                ],
              },
            },
          },
        },
      });
    }

    const ROW = {
      parameterCode: "KH",
      direction: "EMEL",
      effectPer100L: 0.5,
      doseUnit: "ML",
      doseStep: 1,
      maxDailyDosePer100L: 10,
      effectHours: 24,
      source: "https://gyarto.example.invalid/termek (címke, 2026-10)",
    };

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      for (const [name, role] of [
        ["a", "OWNER"],
        ["b", "MANAGER"],
        ["v", "VIEWER"],
      ] as const) {
        userId[name] = (
          await prisma.user.create({
            data: {
              email: email(name),
              displayName: `Adag-lista ${name}`,
              role,
              isActive: true,
              passwordHash: await hashPassword(PASSWORD),
              passwordUpdatedAt: new Date(),
            },
          })
        ).id;
      }
      product = (
        await prisma.product.create({
          data: {
            name: `${PREFIX}KH ${suffix}`,
            channelListings: {
              create: [{ channel: "UNAS", externalStatus: "1" }],
            },
          },
        })
      ).id;
      otherProduct = (
        await prisma.product.create({
          data: {
            name: `${PREFIX}nem vásárolható ${suffix}`,
            channelListings: {
              create: [{ channel: "UNAS", externalStatus: "3" }],
            },
          },
        })
      ).id;

      app = await NestFactory.create(AppModule, { logger: false });
      configureApp(app);
      await app.listen(0, "127.0.0.1");
      base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
      for (const name of ["a", "b", "v"]) {
        const response = await fetch(`${base}/auth/mobile/login/password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email(name), password: PASSWORD }),
        });
        assert.equal(response.status, 201, name);
        bearer[name] = ((await response.json()) as { token: string }).token;
      }
      await jev(product, "KALCIUM:EMEL;KH:EMEL");
    });

    after(async () => {
      await app?.close();
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "Product (a suite előtagja)",
          darab: await prisma.product.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "User (a suite tartománya)",
          darab: await prisma.user.count({
            where: { email: { endsWith: EMAIL_DOMAIN } },
          }),
        },
      ]);
    });

    async function removeLeftovers(): Promise<void> {
      await prisma.productEnrichmentRun.deleteMany({
        where: { requestedBy: { email: { endsWith: EMAIL_DOMAIN } } },
      });
      // The dose rows, their versions and the listings go with the product.
      await prisma.product.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: EMAIL_DOMAIN } },
      });
    }

    it("rögzítés: a sor létrejön, de nem használható, amíg más kolléga nem ellenőrzi", async () => {
      const created = await call("a", `/products/${product}/dose-effects`, {
        method: "POST",
        body: ROW,
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      rowId = created.body.id;
      assert.equal(created.body.version, 1);
      assert.equal(created.body.usable, false);
      assert.deepEqual(created.body.refusals, ["NOT_VERIFIED"]);
      assert.equal(created.body.jevStatus, "VERIFIED");

      const again = await call("a", `/products/${product}/dose-effects`, {
        method: "POST",
        body: ROW,
      });
      assert.equal(
        again.status,
        409,
        "egy élő sor termékenként, paraméterenként, irányonként",
      );
      for (const bad of [
        { ...ROW, effectPer100L: 0 },
        { ...ROW, source: "  " },
        { ...ROW, parameterCode: "NINCS" },
        { ...ROW, direction: "FEL" },
      ])
        assert.equal(
          (
            await call("a", `/products/${product}/dose-effects`, {
              method: "POST",
              body: bad,
            })
          ).status,
          400,
          JSON.stringify(bad),
        );
    });

    it("ellenőrzés: a rögzítő nem, a régi verzió nem, a második kolléga a látott verziót igen", async () => {
      const own = await call("a", `/dose-effects/${rowId}/verify`, {
        method: "POST",
        body: { expectedVersion: 1 },
      });
      assert.equal(own.status, 400);
      const stale = await call("b", `/dose-effects/${rowId}/verify`, {
        method: "POST",
        body: { expectedVersion: 2 },
      });
      assert.equal(stale.status, 409);
      const ok = await call("b", `/dose-effects/${rowId}/verify`, {
        method: "POST",
        body: { expectedVersion: 1 },
      });
      assert.equal(ok.status, 201, JSON.stringify(ok.body));
      assert.equal(ok.body.verifiedBy.id, userId.b);
      assert.equal(ok.body.usable, true);
      assert.deepEqual(ok.body.refusals, []);
    });

    it("szerkesztés: új verzió, az ellenőrzés törlődik, és a szerkesztő nem ellenőrizheti a sajátját", async () => {
      const same = await call("b", `/dose-effects/${rowId}`, {
        method: "PATCH",
        body: { expectedVersion: 1, doseStep: 1 },
      });
      assert.equal(same.status, 200);
      assert.equal(same.body.version, 1, "változás nélkül nincs új verzió");
      assert.equal(same.body.usable, true);

      const edited = await call("b", `/dose-effects/${rowId}`, {
        method: "PATCH",
        body: { expectedVersion: 1, effectPer100L: 0.25 },
      });
      assert.equal(edited.status, 200);
      assert.equal(edited.body.version, 2);
      assert.equal(edited.body.recordedBy.id, userId.b);
      assert.equal(edited.body.verifiedBy, null);
      assert.deepEqual(edited.body.refusals, ["NOT_VERIFIED"]);

      const oldEdit = await call("a", `/dose-effects/${rowId}`, {
        method: "PATCH",
        body: { expectedVersion: 1, doseStep: 2 },
      });
      assert.equal(oldEdit.status, 409);
      assert.equal(
        (
          await call("b", `/dose-effects/${rowId}/verify`, {
            method: "POST",
            body: { expectedVersion: 2 },
          })
        ).status,
        400,
      );
      const verified = await call("a", `/dose-effects/${rowId}/verify`, {
        method: "POST",
        body: { expectedVersion: 2 },
      });
      assert.equal(verified.status, 201);
      assert.equal(verified.body.usable, true);

      const versions = await call("v", `/dose-effects/${rowId}/versions`);
      assert.equal(versions.status, 200);
      assert.deepEqual(
        versions.body.items.map(
          (v: {
            version: number;
            effectPer100L: number;
            verifiedById: string;
          }) => [v.version, v.effectPer100L, v.verifiedById],
        ),
        [
          [2, 0.25, userId.a],
          [1, 0.5, userId.b],
        ],
      );
    });

    it("használhatóság: a napi maximum hiánya, a JEV eltérése és a nem vásárolható termék külön okkal", async () => {
      const noMax = await call("a", `/dose-effects/${rowId}`, {
        method: "PATCH",
        body: { expectedVersion: 2, maxDailyDosePer100L: null },
      });
      assert.deepEqual(noMax.body.refusals, ["NOT_VERIFIED", "NO_MAX_DAILY"]);

      const magnesium = await call("a", `/products/${product}/dose-effects`, {
        method: "POST",
        body: { ...ROW, parameterCode: "MAGNEZIUM" },
      });
      assert.ok(magnesium.body.refusals.includes("JEV_DISAGREES"));

      const notForSale = await call(
        "a",
        `/products/${otherProduct}/dose-effects`,
        {
          method: "POST",
          body: ROW,
        },
      );
      assert.ok(notForSale.body.refusals.includes("NOT_PURCHASABLE"));
      assert.ok(notForSale.body.refusals.includes("JEV_DISAGREES"));
      assert.equal(notForSale.body.jevStatus, "NONE");
    });

    it("JEV sor-javaslat: csak olvas, és csak az élő sor nélküli hatásokat ajánlja, számok nélkül", async () => {
      const before = await prisma.product.findUniqueOrThrow({
        where: { id: product },
      });
      const rowsBefore = await prisma.productDoseEffect.count({
        where: { productId: product },
      });
      const suggestion = await call(
        "v",
        `/products/${product}/dose-effects/suggestion`,
      );
      assert.equal(suggestion.status, 200);
      assert.equal(suggestion.body.jev.status, "VERIFIED");
      assert.deepEqual(suggestion.body.rows, [
        {
          parameterCode: "KALCIUM",
          direction: "EMEL",
          source: "https://gyarto.example.invalid/termek",
        },
      ]);
      assert.equal(suggestion.body.dosing.value, "5 ml/100 L/day");
      assert.equal(
        await prisma.productDoseEffect.count({ where: { productId: product } }),
        rowsBefore,
      );
      const after = await prisma.product.findUniqueOrThrow({
        where: { id: product },
      });
      assert.equal(
        after.updatedAt.toISOString(),
        before.updatedAt.toISOString(),
      );
    });

    it("archiválás: kikerül a listából, a helyére új élő sor jöhet; a nézőnek csak olvasás", async () => {
      assert.equal(
        (
          await call("v", `/products/${product}/dose-effects`, {
            method: "POST",
            body: { ...ROW, parameterCode: "KALCIUM" },
          })
        ).status,
        403,
      );
      assert.equal(
        (await call("v", `/dose-effects/${rowId}`, { method: "DELETE" }))
          .status,
        403,
      );
      assert.equal(
        (await call("a", `/dose-effects/${rowId}`, { method: "DELETE" }))
          .status,
        204,
      );
      const live = await call("v", "/dose-effects?parameterCode=KH");
      assert.ok(
        !live.body.items.some((row: { id: string }) => row.id === rowId),
      );
      const all = await call(
        "v",
        "/dose-effects?parameterCode=KH&includeArchived=true",
      );
      assert.ok(all.body.items.some((row: { id: string }) => row.id === rowId));
      const replaced = await call("a", `/products/${product}/dose-effects`, {
        method: "POST",
        body: ROW,
      });
      assert.equal(replaced.status, 201);
    });

    it("adatbázis-CHECK: a rögzítő nem lehet az ellenőrző, a szám nem lehet nulla", async () => {
      const row = await prisma.productDoseEffect.findFirstOrThrow({
        where: { productId: product, archivedAt: null, parameterCode: "KH" },
      });
      await assert.rejects(
        prisma.productDoseEffect.update({
          where: { id: row.id },
          data: { verifiedById: row.recordedById },
        }),
      );
      await assert.rejects(
        prisma.productDoseEffect.update({
          where: { id: row.id },
          data: { doseStep: 0 },
        }),
      );
    });
  },
);
