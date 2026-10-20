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
import { ReefClubAppModule } from "./reefclub.module.js";

/**
 * THE CORE OF THE ACCEPTANCE PROBE (plan v6.1, 5.2 points 1 and 2; slice 4),
 * on the routes the ReefClub process actually serves.
 *
 *   1. B's session with every aquarium id of A (own), C and D (shop
 *      customers, private persons) and E (a company): every id route, every
 *      method, answers 404 with the SAME BYTES as an id that does not exist,
 *      and the aquarium, target and measurement rows of the suite are the
 *      same before and after.
 *   2. An occasion id of another aquarium under one's own aquarium's path is
 *      the same 404, and the other aquarium's rows stay.
 *
 * THE MATRIX IS READ FROM THE ROUTER, not written by hand: every `/rc/v1`
 * route with a path parameter is swept, and a parameter or a body route this
 * suite has no value for is a red test, so a new id route cannot slip past it
 * (the core of point 10). Each foreign request is paired with a control: the
 * same request on B's own aquarium succeeds, so a 404 is the access rule and
 * not a malformed request.
 *
 * B has no link to C, D or E, so all of them are foreign to B here; the
 * shop-link half (A linked to C, plan points 3, 5, 6, 7) is
 * `reefclub-bolti.integration.spec.ts`. The link routes (`/shop-links/:id`)
 * are in this sweep too, with the link of another account as the foreign id. The internal side is measured too:
 * a ReefClub aquarium is not an internal row (plan 4.4), so the internal
 * detail route answers 404 for it.
 *
 * Rows are created and deleted, so it runs only on a database named for
 * testing; see integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_EMAIL_DOMAIN = "reefclub-akvarium.invalid";
const NAME_PREFIX = "RC-akvarium-proba";
const PASSWORD = "reefclub akvarium jelszo";
const MISSING_ID = "rc-akvarium-nincs-ilyen";
const MISSING_OCCASION = "2001-01-01T00:00:00.000Z";

/** A valid body for every swept route that takes one; a missing entry is red. */
const BODIES: Record<string, unknown> = {
  "POST /rc/v1/aquariums/:id/share": { consentVersion: "teszt-1" },
  "PATCH /rc/v1/aquariums/:id": { name: `${NAME_PREFIX} átírva` },
  "PUT /rc/v1/aquariums/:id/targets": {
    targets: [{ parameterCode: "KH", min: 7, max: 9 }],
  },
  "POST /rc/v1/aquariums/:id/measurements": {
    measuredAt: "2026-03-03T03:03:03.000Z",
    values: [{ parameterCode: "KH", value: 8 }],
  },
};

/** The path parameters this suite knows how to fill; any other one is red. */
const KNOWN_PARAMS = new Set(["id", "occasionId"]);

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

function fill(path: string, values: Record<string, string>): string {
  return path.replace(/:(\w+)/g, (_, name: string) => {
    const value = values[name];
    assert.ok(value !== undefined, `nincs érték ehhez: :${name} (${path})`);
    return encodeURIComponent(value);
  });
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

interface Session {
  cookie: string;
  csrf: string;
}

interface Answer {
  status: number;
  body: string;
}

describe(
  "ReefClub: saját akvárium és az elfogadási próba 1-2. pontja",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    let internal: INestApplication;
    let reefclub: INestApplication;
    let internalBase: string;
    let reefclubBase: string;
    let internalBearer: string;

    let sessionA: Session;
    let sessionB: Session;
    /** A's aquariums, made through the API. */
    let a1: string;
    let a2: string;
    let a1Occasion: string;
    /** B's own: the control aquarium of the sweep. */
    let b1: string;
    let b1Occasion: string;
    /** The shop customers' aquariums, made inside. */
    let c1: string;
    let c2: string;
    let d1: string;
    let dOccasion: string;
    let e1: string;
    const customerIds: string[] = [];
    /** A link of another account (Z, to C): the foreign link id of the sweep. */
    let zLink: string;
    /** B's own link (to F, a customer without aquariums): the control's. */
    let bLink: string;

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

    async function answer(
      route: Route,
      values: Record<string, string>,
      session: Session,
    ): Promise<Answer> {
      const key = `${route.method} ${route.path}`;
      const hasBody = ["POST", "PUT", "PATCH"].includes(route.method);
      if (hasBody) assert.ok(key in BODIES, `nincs mintatörzs ehhez: ${key}`);
      // The `:id` of a link route is a link id, of every other route an
      // aquarium id.
      const filled = route.path.startsWith("/rc/v1/shop-links/")
        ? { ...values, id: values.linkId! }
        : values;
      const response = await rc(fill(route.path, filled), {
        method: route.method,
        body: hasBody ? BODIES[key] : undefined,
        session,
      });
      return { status: response.status, body: await response.text() };
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
      assert.equal(response.status, 204, `ReefClub-belépés: ${name}`);
      const cookies = setCookies(response);
      return {
        cookie: `rc_session=${cookies.rc_session}; rc_csrf=${cookies.rc_csrf}`,
        csrf: cookies.rc_csrf!,
      };
    }

    async function ownAquarium(
      session: Session,
      name: string,
    ): Promise<string> {
      const response = await rc("/rc/v1/aquariums", {
        method: "POST",
        body: {
          name: `${NAME_PREFIX} ${name}`,
          waterType: "TENGERI",
          systemVolumeLiters: 250,
        },
        session,
      });
      assert.equal(response.status, 201, await response.clone().text());
      return ((await response.json()) as { id: string }).id;
    }

    async function manualOccasion(
      session: Session,
      aquariumId: string,
      measuredAt: string,
    ): Promise<string> {
      const response = await rc(`/rc/v1/aquariums/${aquariumId}/measurements`, {
        method: "POST",
        body: {
          measuredAt,
          values: [
            { parameterCode: "KH", value: 6 },
            { parameterCode: "KALCIUM", value: 420 },
          ],
        },
        session,
      });
      assert.equal(response.status, 201, await response.clone().text());
      return ((await response.json()) as { id: string }).id;
    }

    async function shopAquarium(
      type: "PERSON" | "COMPANY",
      name: string,
    ): Promise<string> {
      const customer = await prisma.customer.create({
        data: {
          customerNumber: `RCA-${suffix}-${name}`,
          type,
          displayName: `${NAME_PREFIX} ${name}`,
          email: email(`vevo-${name}`),
          phone: "+36 1 000 0000",
        },
      });
      customerIds.push(customer.id);
      const aquarium = await prisma.aquarium.create({
        data: {
          aquariumNumber: `RCA-${suffix}-${name}`,
          customerId: customer.id,
          ownershipType: "CUSTOMER",
          name: `${NAME_PREFIX} ${name}`,
          waterType: "TENGERI",
          notes: "belső jegyzet",
          maintainedByUs: true,
          targets: { create: [{ parameterCode: "KH", min: 7, max: 9 }] },
        },
      });
      return aquarium.id;
    }

    /** Every row the sweep could touch, in one hash. */
    async function fingerprint(): Promise<string> {
      const ids = [a1, a2, b1, c1, c2, d1, e1];
      const [aquariums, targets, measurements, links] = await Promise.all([
        prisma.aquarium.findMany({
          where: { id: { in: ids } },
          orderBy: { id: "asc" },
        }),
        prisma.aquariumMeasurementTarget.findMany({
          where: { aquariumId: { in: ids } },
          orderBy: { id: "asc" },
        }),
        prisma.aquariumMeasurement.findMany({
          where: { aquariumId: { in: ids } },
          orderBy: { id: "asc" },
        }),
        prisma.reefClubCustomerLink.findMany({
          where: { id: { in: [zLink, bLink] } },
          orderBy: { id: "asc" },
        }),
      ]);
      assert.equal(aquariums.length, ids.length);
      assert.equal(links.length, 2);
      return createHash("sha256")
        .update(JSON.stringify({ aquariums, targets, measurements, links }))
        .digest("hex");
    }

    /** The /rc/v1 routes with a path parameter, checked against what the suite can fill. */
    function idRoutes(): Route[] {
      const routes = routesOf(reefclub).filter(
        (route) => paramsOf(route.path).length > 0,
      );
      // The control on the reading itself: eleven aquarium id routes and the
      // link route.
      assert.ok(routes.length >= 12, `${routes.length} azonosítós útvonal`);
      for (const route of routes)
        for (const param of paramsOf(route.path))
          assert.ok(
            KNOWN_PARAMS.has(param),
            `ismeretlen útvonal-paraméter, nincs a próba mátrixában: ${route.method} ${route.path} (:${param})`,
          );
      return routes;
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      await prisma.user.create({
        data: {
          email: email("belso"),
          displayName: "Akvárium-próba belső kolléga",
          role: "OWNER",
          isActive: true,
          passwordHash: await hashPassword(PASSWORD),
          passwordUpdatedAt: new Date(),
        },
      });

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
      internalBearer = ((await mobile.json()) as { token: string }).token;

      sessionA = await login("a");
      sessionB = await login("b");
      a1 = await ownAquarium(sessionA, "A1");
      a2 = await ownAquarium(sessionA, "A2");
      a1Occasion = await manualOccasion(
        sessionA,
        a1,
        "2026-01-10T08:00:00.000Z",
      );
      b1 = await ownAquarium(sessionB, "B1");
      b1Occasion = await manualOccasion(
        sessionB,
        b1,
        "2026-01-11T08:00:00.000Z",
      );
      c1 = await shopAquarium("PERSON", "C1");
      c2 = await shopAquarium("PERSON", "C2");
      d1 = await shopAquarium("PERSON", "D1");
      e1 = await shopAquarium("COMPANY", "E1");
      dOccasion = "2026-01-12T08:00:00.000Z";
      await prisma.aquariumMeasurement.create({
        data: {
          aquariumId: d1,
          parameterCode: "KH",
          value: 8,
          unit: "dKH",
          measuredAt: new Date(dOccasion),
          source: "bolt",
        },
      });

      const z = await prisma.reefClubAccount.create({
        data: {
          email: email("z"),
          emailVerifiedAt: new Date(),
          consentVersion: "teszt-1",
          consentAt: new Date(),
        },
      });
      zLink = (
        await prisma.reefClubCustomerLink.create({
          data: { accountId: z.id, customerId: customerIds[0]! },
        })
      ).id;
      const f = await prisma.customer.create({
        data: {
          customerNumber: `RCA-${suffix}-F`,
          type: "PERSON",
          displayName: `${NAME_PREFIX} F`,
        },
      });
      customerIds.push(f.id);
      const b = await prisma.reefClubAccount.findUniqueOrThrow({
        where: { email: email("b") },
      });
      bLink = (
        await prisma.reefClubCustomerLink.create({
          data: { accountId: b.id, customerId: f.id },
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
      // Targets and measurements go with the aquarium, sessions with the
      // account, the own aquariums with the account (all Cascade).
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

    it("5.2/1: B munkamenetével minden idegen akvárium-azonosító minden azonosítós útvonalon bájtra a nem létező 404-e, és semmi nem változik", async () => {
      const foreign: Record<
        string,
        { id: string; occasionId: string; linkId: string }
      > = {
        "A saját (privát)": { id: a1, occasionId: a1Occasion, linkId: zLink },
        "A második saját": { id: a2, occasionId: a1Occasion, linkId: zLink },
        "C bolti 1": { id: c1, occasionId: dOccasion, linkId: zLink },
        "C bolti 2": { id: c2, occasionId: dOccasion, linkId: zLink },
        "D bolti": { id: d1, occasionId: dOccasion, linkId: zLink },
        "E cég": { id: e1, occasionId: dOccasion, linkId: zLink },
      };
      const before = await fingerprint();
      const mismatches: string[] = [];
      let compared = 0;
      for (const route of idRoutes()) {
        const missing = await answer(
          route,
          { id: MISSING_ID, occasionId: MISSING_OCCASION, linkId: MISSING_ID },
          sessionB,
        );
        assert.equal(
          missing.status,
          404,
          `nem létező azonosító: ${route.method} ${route.path}`,
        );
        for (const [who, values] of Object.entries(foreign)) {
          const got = await answer(route, values, sessionB);
          compared += 1;
          if (got.status !== 404 || got.body !== missing.body)
            mismatches.push(
              `${route.method} ${route.path} [${who}]: ${got.status} ${got.body.slice(0, 120)}`,
            );
        }
      }
      assert.deepEqual(mismatches, []);
      assert.ok(compared >= 12 * 6, `${compared} összevetés`);
      assert.equal(await fingerprint(), before, "a sorok megváltoztak");
    });

    it("5.2/2: idegen akvárium alkalom-azonosítója a saját akvárium útvonalán a nem létező 404-e, és a másik sora megmarad", async () => {
      const routes = idRoutes().filter((route) =>
        paramsOf(route.path).includes("occasionId"),
      );
      assert.ok(routes.length >= 1);
      const before = await fingerprint();
      const mismatches: string[] = [];
      for (const route of routes) {
        const missing = await answer(
          route,
          { id: b1, occasionId: MISSING_OCCASION },
          sessionB,
        );
        assert.equal(missing.status, 404);
        for (const [who, occasionId] of Object.entries({
          "A1 alkalma": a1Occasion,
          "D bolti alkalma": dOccasion,
        })) {
          const got = await answer(route, { id: b1, occasionId }, sessionB);
          if (got.status !== 404 || got.body !== missing.body)
            mismatches.push(
              `${route.method} ${route.path} [${who}]: ${got.status}`,
            );
        }
      }
      assert.deepEqual(mismatches, []);
      assert.equal(await fingerprint(), before, "a sorok megváltoztak");
    });

    it("kontroll: ugyanezek a kérések B saját akváriumán sikeresek (a 404 a hozzáférési szabály, nem rossz kérés)", async () => {
      const throwaway = await ownAquarium(sessionB, "B-eldobhato");
      const failures: string[] = [];
      // Deletes last, so the other routes still find the rows.
      const routes = idRoutes().sort(
        (x, y) =>
          Number(x.method === "DELETE") - Number(y.method === "DELETE") ||
          y.path.length - x.path.length,
      );
      for (const route of routes) {
        const target =
          route.method === "DELETE" && !route.path.includes("occasionId")
            ? throwaway
            : b1;
        const got = await answer(
          route,
          { id: target, occasionId: b1Occasion, linkId: bLink },
          sessionB,
        );
        if (got.status < 200 || got.status > 299)
          failures.push(
            `${route.method} ${route.path}: ${got.status} ${got.body}`,
          );
      }
      assert.deepEqual(failures, []);
    });

    it("lista: A pontosan a két sajátját látja OWN jelöléssel, B csak a sajátját", async () => {
      const listOf = async (session: Session) => {
        const response = await rc("/rc/v1/aquariums", { session });
        assert.equal(response.status, 200);
        return (
          (await response.json()) as {
            aquariums: { id: string; origin: string }[];
          }
        ).aquariums;
      };
      const aList = await listOf(sessionA);
      assert.deepEqual(aList.map((x) => x.id).sort(), [a1, a2].sort());
      assert.ok(aList.every((x) => x.origin === "OWN"));
      const bIds = (await listOf(sessionB)).map((x) => x.id);
      assert.ok(bIds.includes(b1));
      assert.ok(![a1, a2, c1, c2, d1, e1].some((id) => bIds.includes(id)));
    });

    it("a válasz kifejezett mezőlista: belső mező nincs benne", async () => {
      const response = await rc(`/rc/v1/aquariums/${a1}`, {
        session: sessionA,
      });
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(await response.json()).sort(), [
        "createdAt",
        "id",
        "name",
        "origin",
        "sharedWithShopAt",
        "systemVolumeLiters",
        "waterBodyType",
        "waterType",
      ]);
    });

    it("gazda a törzsben: elutasítva, és nem jön létre sor", async () => {
      for (const field of ["ownerAccountId", "customerId", "departmentId"]) {
        const response = await rc("/rc/v1/aquariums", {
          method: "POST",
          body: { name: `${NAME_PREFIX} gazda-${field}`, [field]: c1 },
          session: sessionB,
        });
        assert.equal(response.status, 400, field);
      }
      assert.equal(
        await prisma.aquarium.count({
          where: { name: { startsWith: `${NAME_PREFIX} gazda-` } },
        }),
        0,
      );
    });

    it("célsáv és kézi mérés: a közös értékelés adja a státuszt, az irányt és a trendet", async () => {
      const put = await rc(`/rc/v1/aquariums/${a2}/targets`, {
        method: "PUT",
        body: {
          targets: [
            { parameterCode: "KH", min: 7, max: 9 },
            { parameterCode: "PH" },
          ],
        },
        session: sessionA,
      });
      assert.equal(put.status, 200, await put.clone().text());
      assert.deepEqual(await put.json(), {
        targets: [{ parameterCode: "KH", min: 7, max: 9 }],
      });

      const reversed = await rc(`/rc/v1/aquariums/${a2}/targets`, {
        method: "PUT",
        body: { targets: [{ parameterCode: "KH", min: 9, max: 7 }] },
        session: sessionA,
      });
      assert.equal(reversed.status, 400);

      await manualOccasion(sessionA, a2, "2026-02-01T08:00:00.000Z"); // KH 6
      const second = await rc(`/rc/v1/aquariums/${a2}/measurements`, {
        method: "POST",
        body: {
          measuredAt: "2026-02-02T08:00:00.000Z",
          clientOperationId: `rc-akv-${suffix}`,
          values: [{ parameterCode: "KH", value: 4 }],
        },
        session: sessionA,
      });
      assert.equal(second.status, 201);
      const occasion = (await second.json()) as {
        id: string;
        source: string;
        values: {
          parameterCode: string;
          unit: string;
          status: string;
          direction: string;
          trend: string;
          target: unknown;
        }[];
      };
      assert.equal(occasion.id, "2026-02-02T08:00:00.000Z");
      assert.equal(occasion.source, "MANUAL");
      // 7-9: 4 is 3 below, the width is 2: ALERT; 6 was 1 below: WORSENING.
      assert.deepEqual(occasion.values, [
        {
          parameterCode: "KH",
          value: 4,
          unit: "dKH",
          target: { min: 7, max: 9 },
          status: "ALERT",
          direction: "LOW",
          trend: "WORSENING",
        },
      ]);

      const again = await rc(`/rc/v1/aquariums/${a2}/measurements`, {
        method: "POST",
        body: {
          measuredAt: "2026-02-03T08:00:00.000Z",
          clientOperationId: `rc-akv-${suffix}`,
          values: [{ parameterCode: "KH", value: 5 }],
        },
        session: sessionA,
      });
      assert.equal(again.status, 201);
      assert.equal(((await again.json()) as { id: string }).id, occasion.id);

      const rows = await prisma.aquariumMeasurement.findMany({
        where: { aquariumId: a2 },
      });
      assert.equal(rows.length, 3, "a megismételt kulcs nem ír új sort");
      const account = await prisma.reefClubAccount.findUniqueOrThrow({
        where: { email: email("a") },
      });
      assert.ok(
        rows.every(
          (row) =>
            row.source === "REEFCLUB_MANUAL" &&
            row.recordedByAccountId === account.id &&
            row.measuredById === null,
        ),
      );

      const future = await rc(`/rc/v1/aquariums/${a2}/measurements`, {
        method: "POST",
        body: {
          measuredAt: new Date(Date.now() + 3_600_000).toISOString(),
          values: [{ parameterCode: "KH", value: 8 }],
        },
        session: sessionA,
      });
      assert.equal(future.status, 400);

      const sameMoment = await rc(`/rc/v1/aquariums/${a2}/measurements`, {
        method: "POST",
        body: {
          measuredAt: "2026-02-01T08:00:00.000Z",
          values: [{ parameterCode: "KH", value: 8 }],
        },
        session: sessionA,
      });
      assert.equal(sameMoment.status, 409);

      const removed = await rc(
        `/rc/v1/aquariums/${a2}/measurements/${encodeURIComponent(occasion.id)}`,
        { method: "DELETE", session: sessionA },
      );
      assert.equal(removed.status, 204);
      const list = await rc(`/rc/v1/aquariums/${a2}/measurements`, {
        session: sessionA,
      });
      assert.deepEqual(
        ((await list.json()) as { occasions: { id: string }[] }).occasions.map(
          (o) => o.id,
        ),
        ["2026-02-01T08:00:00.000Z"],
      );
    });

    it("belső oldal: a ReefClub-akvárium nem belső sor (404), a bolti igen (kontroll)", async () => {
      const read = (id: string) =>
        fetch(`${internalBase}/aquariums/${id}`, {
          headers: { authorization: `Bearer ${internalBearer}` },
        });
      assert.equal((await read(c1)).status, 200);
      assert.equal((await read(a1)).status, 404);
    });

    it("adatbázis-CHECK: ReefClub-akváriumnak nem lehet vevője", async () => {
      await assert.rejects(
        prisma.aquarium.update({ where: { id: a1 }, data: { customerId: c1 } }),
      );
      await assert.rejects(
        prisma.aquarium.update({
          where: { id: a1 },
          data: { maintainedByUs: true },
        }),
      );
    });
  },
);
