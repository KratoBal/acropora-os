import "reflect-metadata";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../app.module.js";
import { configureApp } from "../app.configuration.js";
import {
  integrationDatabaseGate,
  integrationDatabaseUrl,
} from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { hashPassword } from "../users/password.util.js";
import { configureReefClubApp } from "./reefclub-app.configuration.js";
import { REEFCLUB_SHARE_CONSENT_VERSION } from "./reefclub-consent.js";
import { ReefClubAppModule } from "./reefclub.module.js";

/**
 * SHARING A REEFCLUB AQUARIUM WITH THE SHOP (plan v6.1, 4.4; slice 5a), and
 * the probe's points 13 and 14 (5.2), with point 21 (after a revoke, nothing
 * of the earlier data).
 *
 * 13. THE INTERNAL ROUTES ARE READ FROM THE LOADED INTERNAL ROUTER: every
 *     route under `/aquariums/:id` and every route with an `:aquariumId`
 *     anywhere. On a PRIVATE ReefClub aquarium all of them, reads and writes,
 *     answer 404. On a SHARED one the reads answer 200 and every write 404
 *     (barracuda, #1724 review: the writes belong in the sweep too). The
 *     aquarium's rows hash the same before and after. A route with a
 *     parameter or a body this suite has no value for is red, so a new
 *     internal aquarium route cannot pass unmeasured. The control: every
 *     write on an ordinary shop aquarium gets past the access check (not 404).
 * 14. The customer's preview equals what the colleague gets through the OS's
 *     own routes, field for field; and the OS answer has no populated field
 *     outside that list and the internal bookkeeping.
 *
 * Rows are created and deleted, so it runs only on a database named for
 * testing; see integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_EMAIL_DOMAIN = "reefclub-megosztas.invalid";
const NAME_PREFIX = "RC-megosztas-proba";
const PASSWORD = "reefclub megosztas jelszo";
const MISSING = "rc-megosztas-nincs";
const OCCASION = "2026-05-01T08:00:00.000Z";
const SHOP_OCCASION = "2026-05-02T08:00:00.000Z";
const EXPECTED_UPDATED_AT = "2026-01-01T00:00:00.000Z";
/** The internal aquarium 404's message (`AquariumsService.detail` and `writable`). */
const AQUARIUM_NOT_FOUND = "Az akvárium nem található.";

/** A valid body for every internal write route the sweep sends; a missing one is red. */
const BODIES: Record<string, unknown> = {
  "PATCH /aquariums/:id": {
    name: `${NAME_PREFIX} átírva`,
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
  },
  "POST /aquariums/:id/equipment": { kind: "VILAGITAS" },
  "POST /aquariums/:id/measurements": {
    measuredAt: "2026-05-05T05:05:05.000Z",
    values: [{ parameterCode: "KH", value: 8 }],
  },
  "POST /aquariums/:id/measurements/:occasionId/release": {},
  "POST /aquariums/:id/measurements/:occasionId/recommendation/request": {},
  "PATCH /aquariums/:id/measurements/:occasionId/recommendation": {
    text: "teszt",
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
  },
  "POST /aquariums/:id/measurements/:occasionId/recommendation/approve": {
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
  },
  "POST /aquariums/:id/measurements/:occasionId/send-email": {},
  "PATCH /aquariums/:id/maintainers": { userIds: [] },
};
const KNOWN_PARAMS = new Set(["id", "aquariumId", "occasionId", "equipmentId"]);

interface Route {
  method: string;
  path: string;
}

function routesOf(app: INestApplication): Route[] {
  const router = (
    app.getHttpAdapter().getInstance() as {
      router: {
        stack: {
          route?: { path: string; methods: Record<string, boolean> };
        }[];
      };
    }
  ).router;
  return router.stack.flatMap((layer) =>
    layer.route
      ? Object.keys(layer.route.methods)
          .filter((method) => method !== "_all")
          .map((method) => ({
            method: method.toUpperCase(),
            path: layer.route!.path,
          }))
      : [],
  );
}

function paramsOf(path: string): string[] {
  return [...path.matchAll(/:(\w+)/g)].map((match) => match[1]!);
}

function setCookies(response: Response): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const index = pair!.indexOf("=");
    cookies[pair!.slice(0, index)] = decodeURIComponent(pair!.slice(index + 1));
  }
  return cookies;
}

/** A value that carries data: not missing, empty, false, zero or an empty list. */
function populated(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (value === 0) return false;
  if (value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

interface Session {
  cookie: string;
  csrf: string;
}

describe(
  "ReefClub: megosztás a bolttal, az elfogadási próba 13. és 14. pontja",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    let internal: INestApplication;
    let reefclub: INestApplication;
    let internalBase: string;
    let reefclubBase: string;
    let bearer: string;
    let userId: string;
    let sessionA: Session;
    let sessionB: Session;
    let privateId: string;
    let sharedId: string;
    let shopId: string;

    const email = (name: string) => `${name}-${suffix}@${TEST_EMAIL_DOMAIN}`;

    async function rc(
      path: string,
      init: { method?: string; body?: unknown; session?: Session } = {},
    ): Promise<Response> {
      const headers: Record<string, string> = {};
      if (init.body !== undefined) headers["Content-Type"] = "application/json";
      if (init.session) {
        headers.cookie = init.session.cookie;
        headers["x-csrf-token"] = init.session.csrf;
      }
      return fetch(`${reefclubBase}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    }

    async function os(
      path: string,
      init: { method?: string; body?: unknown } = {},
    ): Promise<Response> {
      const headers: Record<string, string> = {
        authorization: `Bearer ${bearer}`,
      };
      if (init.body !== undefined) headers["Content-Type"] = "application/json";
      return fetch(`${internalBase}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    }

    async function login(name: string): Promise<Session> {
      await prisma.reefClubAccount.create({
        data: {
          email: email(name),
          passwordHash: await hashPassword(PASSWORD),
          emailVerifiedAt: new Date(),
          consentVersion: "teszt-1",
          consentAt: new Date(),
        },
      });
      const response = await rc("/rc/v1/auth/login", {
        method: "POST",
        body: { email: email(name), password: PASSWORD },
      });
      assert.equal(response.status, 204);
      const cookies = setCookies(response);
      return {
        cookie: `rc_session=${cookies.rc_session}; rc_csrf=${cookies.rc_csrf}`,
        csrf: cookies.rc_csrf!,
      };
    }

    async function ownAquarium(name: string): Promise<string> {
      const created = await rc("/rc/v1/aquariums", {
        method: "POST",
        body: {
          name: `${NAME_PREFIX} ${name}`,
          waterType: "TENGERI",
          systemVolumeLiters: 300,
        },
        session: sessionA,
      });
      assert.equal(created.status, 201);
      const id = ((await created.json()) as { id: string }).id;
      const targets = await rc(`/rc/v1/aquariums/${id}/targets`, {
        method: "PUT",
        body: { targets: [{ parameterCode: "KH", min: 7, max: 9 }] },
        session: sessionA,
      });
      assert.equal(targets.status, 200);
      const measured = await rc(`/rc/v1/aquariums/${id}/measurements`, {
        method: "POST",
        body: {
          measuredAt: OCCASION,
          values: [
            { parameterCode: "KH", value: 6.5 },
            { parameterCode: "KALCIUM", value: 410 },
          ],
        },
        session: sessionA,
      });
      assert.equal(measured.status, 201);
      return id;
    }

    /** The internal aquarium-id routes, checked against what the suite can fill. */
    function aquariumRoutes(): Route[] {
      const routes = routesOf(internal).filter(
        (route) =>
          route.path.startsWith("/aquariums/:id") ||
          paramsOf(route.path).includes("aquariumId"),
      );
      // The control on the reading itself.
      assert.ok(routes.length >= 15, `${routes.length} akvárium-útvonal`);
      for (const route of routes) {
        for (const param of paramsOf(route.path))
          assert.ok(
            KNOWN_PARAMS.has(param),
            `ismeretlen paraméter, nincs a próba mátrixában: ${route.method} ${route.path} (:${param})`,
          );
        if (["POST", "PUT", "PATCH"].includes(route.method))
          assert.ok(
            `${route.method} ${route.path}` in BODIES,
            `nincs mintatörzs ehhez: ${route.method} ${route.path}`,
          );
      }
      return routes;
    }

    async function call(
      route: Route,
      aquariumId: string,
      occasionId: string,
    ): Promise<{ status: number; body: string }> {
      const path = route.path.replace(/:(\w+)/g, (_, name: string) =>
        encodeURIComponent(
          name === "id" || name === "aquariumId"
            ? aquariumId
            : name === "occasionId"
              ? occasionId
              : MISSING,
        ),
      );
      const response = await os(path, {
        method: route.method,
        body: BODIES[`${route.method} ${route.path}`],
      });
      const text = await response.text();
      return { status: response.status, body: text };
    }

    async function fingerprint(ids: string[]): Promise<string> {
      const where = { aquariumId: { in: ids } };
      const rows = await Promise.all([
        prisma.aquarium.findMany({
          where: { id: { in: ids } },
          orderBy: { id: "asc" },
        }),
        prisma.aquariumMeasurement.findMany({ where, orderBy: { id: "asc" } }),
        prisma.aquariumMeasurementTarget.findMany({
          where,
          orderBy: { id: "asc" },
        }),
        prisma.aquariumEquipment.findMany({ where, orderBy: { id: "asc" } }),
        prisma.aquariumMaintainer.findMany({
          where,
          orderBy: { aquariumId: "asc" },
        }),
        prisma.aquariumMeasurementRelease.findMany({
          where,
          orderBy: { id: "asc" },
        }),
        prisma.aquariumMeasurementRecommendation.findMany({
          where,
          orderBy: { id: "asc" },
        }),
      ]);
      return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      userId = (
        await prisma.user.create({
          data: {
            email: email("belso"),
            displayName: "Megosztás-próba belső kolléga",
            role: "OWNER",
            isActive: true,
            passwordHash: await hashPassword(PASSWORD),
            passwordUpdatedAt: new Date(),
          },
        })
      ).id;

      internal = await NestFactory.create(AppModule, { logger: false });
      configureApp(internal);
      await internal.listen(0, "127.0.0.1");
      internalBase = `http://127.0.0.1:${(internal.getHttpServer().address() as AddressInfo).port}`;
      reefclub = await NestFactory.create(
        ReefClubAppModule.forRoot({
          databaseUrl: integrationDatabaseUrl(process.env),
          mailSender: { async send() {} },
        }),
        { logger: false },
      );
      configureReefClubApp(reefclub);
      await reefclub.listen(0, "127.0.0.1");
      reefclubBase = `http://127.0.0.1:${(reefclub.getHttpServer().address() as AddressInfo).port}`;

      const mobile = await fetch(`${internalBase}/auth/mobile/login/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email("belso"), password: PASSWORD }),
      });
      assert.equal(mobile.status, 201);
      bearer = ((await mobile.json()) as { token: string }).token;

      sessionA = await login("a");
      sessionB = await login("b");
      privateId = await ownAquarium("privát");
      sharedId = await ownAquarium("megosztott");

      const customer = await prisma.customer.create({
        data: {
          customerNumber: `RCM-${suffix}`,
          type: "PERSON",
          displayName: `${NAME_PREFIX} vevő`,
        },
      });
      shopId = (
        await prisma.aquarium.create({
          data: {
            aquariumNumber: `RCM-${suffix}`,
            customerId: customer.id,
            ownershipType: "CUSTOMER",
            name: `${NAME_PREFIX} bolti`,
            waterType: "TENGERI",
            measurements: {
              create: [
                {
                  parameterCode: "KH",
                  value: 6,
                  unit: "dKH",
                  measuredAt: new Date(SHOP_OCCASION),
                  source: "bolt",
                },
              ],
            },
          },
        })
      ).id;
    });

    after(async () => {
      await reefclub?.close();
      await internal?.close();
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "ReefClubAccount (a suite e-mail tartománya)",
          darab: await prisma.reefClubAccount.count({
            where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
          }),
        },
        {
          nev: "Aquarium (a suite névelőtagja)",
          darab: await prisma.aquarium.count({
            where: { name: { startsWith: NAME_PREFIX } },
          }),
        },
        {
          nev: "Customer (a suite névelőtagja)",
          darab: await prisma.customer.count({
            where: { displayName: { startsWith: NAME_PREFIX } },
          }),
        },
        {
          nev: "User (a suite e-mail tartománya)",
          darab: await prisma.user.count({
            where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
          }),
        },
      ]);
    });

    async function removeLeftovers(): Promise<void> {
      // Everything of an aquarium goes with it, the own aquariums with the
      // account (Cascade).
      await prisma.aquarium.deleteMany({
        where: { name: { startsWith: NAME_PREFIX } },
      });
      await prisma.customer.deleteMany({
        where: { displayName: { startsWith: NAME_PREFIX } },
      });
      await prisma.reefClubAccount.deleteMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });
    }

    async function listIds(): Promise<
      Map<string, { reefClubSharedAt?: string }>
    > {
      const response = await os(
        `/aquariums?search=${encodeURIComponent(NAME_PREFIX)}&pageSize=100`,
      );
      assert.equal(response.status, 200);
      const items = (
        (await response.json()) as {
          items: { id: string; reefClubSharedAt?: string }[];
        }
      ).items;
      return new Map(items.map((item) => [item.id, item]));
    }

    it("5.2/13: a privát ReefClub-akvárium a belső lista és minden belső akvárium-útvonal (olvasás és írás) elől rejtve van", async () => {
      const listed = await listIds();
      assert.ok(listed.has(shopId), "kontroll: a bolti akvárium a listán");
      assert.ok(!listed.has(privateId) && !listed.has(sharedId));

      const before = await fingerprint([privateId, sharedId]);
      const leaks: string[] = [];
      for (const route of aquariumRoutes()) {
        const { status } = await call(route, privateId, OCCASION);
        if (status !== 404)
          leaks.push(`${route.method} ${route.path}: ${status}`);
      }
      assert.deepEqual(leaks, []);
      assert.equal(await fingerprint([privateId, sharedId]), before);
    });

    it("B nem oszthatja meg és nem vonhatja vissza A akváriumát, és a bolti akvárium nem osztható meg", async () => {
      for (const method of ["POST", "DELETE"]) {
        const response = await rc(`/rc/v1/aquariums/${sharedId}/share`, {
          method,
          body: method === "POST" ? { consentVersion: "teszt-1" } : undefined,
          session: sessionB,
        });
        assert.equal(response.status, 404, method);
      }
      const row = await prisma.aquarium.findUniqueOrThrow({
        where: { id: sharedId },
      });
      assert.equal(row.sharedWithShopAt, null);
    });

    it("5.2/13: a megosztott akvárium jelöléssel látszik, az olvasások mennek és naplózódnak, minden írás 404", async () => {
      // The server accepts only its own current consent version (#1726
      // review b): another one is refused and nothing is shared.
      const stale = await rc(`/rc/v1/aquariums/${sharedId}/share`, {
        method: "POST",
        body: { consentVersion: "megosztas-regi" },
        session: sessionA,
      });
      assert.equal(stale.status, 400);
      assert.equal(
        (await prisma.aquarium.findUniqueOrThrow({ where: { id: sharedId } }))
          .sharedWithShopAt,
        null,
      );
      const consent = await rc("/rc/v1/me/share-consent", {
        session: sessionA,
      });
      const version = ((await consent.json()) as { version: string }).version;
      assert.equal(version, REEFCLUB_SHARE_CONSENT_VERSION);
      const shared = await rc(`/rc/v1/aquariums/${sharedId}/share`, {
        method: "POST",
        body: { consentVersion: version },
        session: sessionA,
      });
      assert.equal(shared.status, 201, await shared.clone().text());
      const sharedAt = ((await shared.json()) as { sharedWithShopAt: string })
        .sharedWithShopAt;
      assert.ok(sharedAt);

      const listed = await listIds();
      assert.equal(listed.get(sharedId)?.reefClubSharedAt, sharedAt);
      assert.ok(!listed.has(privateId));
      assert.equal(listed.get(shopId)?.reefClubSharedAt, undefined);

      const before = await fingerprint([privateId, sharedId]);
      const wrong: string[] = [];
      for (const route of aquariumRoutes()) {
        const { status } = await call(route, sharedId, OCCASION);
        const expected = route.method === "GET" ? 200 : 404;
        if (status !== expected)
          wrong.push(
            `${route.method} ${route.path}: ${status}, elvárt ${expected}`,
          );
      }
      assert.deepEqual(wrong, []);
      assert.equal(await fingerprint([privateId, sharedId]), before);

      const reads = await prisma.aquariumShareEvent.findMany({
        where: { aquariumId: sharedId, kind: "INTERNAL_READ" },
      });
      assert.ok(reads.length >= 4, `${reads.length} naplózott olvasás`);
      assert.ok(reads.every((read) => read.userId === userId));
      const purposes = new Set(reads.map((read) => read.purpose));
      // "lista": the list read above, acrobot's decision on #1726 review a.
      for (const purpose of ["lista", "részlet", "mérések", "XLSX", "PDF"])
        assert.ok(purposes.has(purpose), `nincs naplózva: ${purpose}`);
      const log = await prisma.aquariumShareEvent.findMany({
        where: { aquariumId: sharedId, kind: "SHARED" },
      });
      assert.equal(log.length, 1);
      assert.equal(log[0]!.consentVersion, REEFCLUB_SHARE_CONSENT_VERSION);
    });

    it("a vezérlőpult akvárium-riasztásai között egyik ReefClub-akvárium sincs, a bolti igen (kontroll)", async () => {
      const response = await os("/dashboard/summary");
      assert.equal(response.status, 200);
      const ids = (
        (
          (await response.json()) as {
            aquariumAlerts?: { items: { aquariumId: string }[] };
          }
        ).aquariumAlerts?.items ?? []
      ).map((item) => item.aquariumId);
      // All three have only a months-old measurement: each is an alert if
      // the query sees it.
      assert.ok(ids.includes(shopId), "kontroll: a bolti akvárium riaszt");
      assert.ok(!ids.includes(privateId), "a privát ReefClub-akvárium látszik");
      assert.ok(
        !ids.includes(sharedId),
        "a megosztott ReefClub-akvárium a pulton",
      );
    });

    it("kontroll: ugyanazok az írások a bolti akváriumon átjutnak a hozzáférésen (nem 404)", async () => {
      const failures: string[] = [];
      const routes = aquariumRoutes()
        .filter((route) => route.method !== "GET")
        // Deletes last, so the other routes still find the rows.
        .sort(
          (x, y) =>
            Number(x.method === "DELETE") - Number(y.method === "DELETE"),
        );
      for (const route of routes) {
        const got = await call(route, shopId, SHOP_OCCASION);
        // The aquarium's own 404 is the access refusal. A 404 of a child the
        // control did not create (an equipment row, a recommendation) is a
        // later step and proves the access check passed.
        if (got.status === 404 && got.body.includes(AQUARIUM_NOT_FOUND))
          failures.push(`${route.method} ${route.path}: ${got.body}`);
      }
      assert.deepEqual(failures, []);
    });

    it("5.2/14: az előnézet mezőről mezőre az, amit a kolléga az OS-ben kap, és az OS-válaszban nincs más adat", async () => {
      const preview = await rc(`/rc/v1/aquariums/${sharedId}/share/preview`, {
        session: sessionA,
      });
      assert.equal(preview.status, 200);
      const view = (await preview.json()) as unknown;

      const detail = (await (await os(`/aquariums/${sharedId}`)).json()) as {
        name: string;
        waterBodyType: string;
        waterType?: string | null;
        systemVolumeLiters?: number | null;
        targets: { parameterCode: string; min?: number; max?: number }[];
      } & Record<string, unknown>;
      const measurements = (await (
        await os(`/aquariums/${sharedId}/measurements`)
      ).json()) as {
        occasions: ({
          measuredAt: string;
          values: { parameterCode: string; value: number }[];
        } & Record<string, unknown>)[];
      };
      const fromOs = {
        aquarium: {
          name: detail.name,
          waterBodyType: detail.waterBodyType,
          waterType: detail.waterType ?? null,
          systemVolumeLiters: detail.systemVolumeLiters ?? null,
        },
        targets: detail.targets.map((t) => ({
          parameterCode: t.parameterCode,
          min: t.min ?? null,
          max: t.max ?? null,
        })),
        occasions: measurements.occasions.map((o) => ({
          measuredAt: o.measuredAt,
          values: [...o.values]
            .map((v) => ({ parameterCode: v.parameterCode, value: v.value }))
            .sort((x, y) => x.parameterCode.localeCompare(y.parameterCode)),
        })),
      };
      assert.deepEqual(view, fromOs);

      // Nothing else of the customer in the OS answer: only the shared data
      // and the internal bookkeeping carry a value.
      const bookkeeping = new Set([
        "id",
        "aquariumNumber",
        "ownershipType",
        "isActive",
        "createdAt",
        "updatedAt",
        "reefClubSharedAt",
        "canAssignAssets",
        "systemVolumeIsManual",
        "name",
        "waterBodyType",
        "waterType",
        "systemVolumeLiters",
        "targets",
      ]);
      assert.deepEqual(
        Object.entries(detail)
          .filter(([key, value]) => populated(value) && !bookkeeping.has(key))
          .map(([key]) => key),
        [],
      );
      const occasionKeys = new Set(["id", "measuredAt", "source", "values"]);
      for (const occasion of measurements.occasions)
        assert.deepEqual(
          Object.entries(occasion)
            .filter(
              ([key, value]) => populated(value) && !occasionKeys.has(key),
            )
            .map(([key]) => key),
          [],
        );
    });

    it("5.2/21: a visszavonás után a korábbi adat semmilyen belső úton nem érhető el, a belső olvasások naplója megmarad", async () => {
      const readsBefore = await prisma.aquariumShareEvent.count({
        where: { aquariumId: sharedId, kind: "INTERNAL_READ" },
      });
      const revoked = await rc(`/rc/v1/aquariums/${sharedId}/share`, {
        method: "DELETE",
        session: sessionA,
      });
      assert.equal(revoked.status, 204);
      assert.ok(!(await listIds()).has(sharedId));
      const leaks: string[] = [];
      for (const route of aquariumRoutes()) {
        const { status } = await call(route, sharedId, OCCASION);
        if (status !== 404)
          leaks.push(`${route.method} ${route.path}: ${status}`);
      }
      assert.deepEqual(leaks, []);
      assert.equal(
        await prisma.aquariumShareEvent.count({
          where: { aquariumId: sharedId, kind: "INTERNAL_READ" },
        }),
        readsBefore,
      );
      assert.equal(
        await prisma.aquariumShareEvent.count({
          where: { aquariumId: sharedId, kind: "REVOKED" },
        }),
        1,
      );
    });

    it("adatbázis-CHECK: bolti akvárium nem lehet megosztott", async () => {
      await assert.rejects(
        prisma.aquarium.update({
          where: { id: shopId },
          data: { sharedWithShopAt: new Date() },
        }),
      );
    });
  },
);
