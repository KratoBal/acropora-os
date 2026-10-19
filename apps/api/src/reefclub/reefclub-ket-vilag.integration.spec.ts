import "reflect-metadata";

import assert from "node:assert/strict";
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
import type { OutgoingMail } from "../notifications/mail/mail.port.js";
import { hashPassword } from "../users/password.util.js";
import { configureReefClubApp } from "./reefclub-app.configuration.js";
import { ReefClubAuthService } from "./reefclub-auth.service.js";
import { ReefClubAppModule } from "./reefclub.module.js";

/**
 * THE TWO WORLDS, MEASURED ON THE ROUTES THE PROCESSES ACTUALLY SERVE (plan
 * v6.1, 5.2 point 8 and 4.1), and the e-mail login of slice 2 (3.2).
 *
 * Both applications are started for real: the internal `AppModule` and the
 * ReefClub root module through the same `forRoot` the entry point calls, with
 * one seam (the mail sender captures instead of sending). The route lists come
 * from the loaded Express routers, not from a hand-written list, so a route
 * added later is in the sweep without anybody adding it.
 *
 * THE RULE THE SWEEP CHECKS, in one sentence: a credential of the other world
 * gets NOTHING that no credential at all would not get. On a closed route that
 * means the same 401 as an anonymous call; on an open route it means the
 * credential does not turn a refusal into a success. Each foreign credential
 * is tried in every shape it could arrive in (its own cookie, a Bearer header,
 * pasted into the other side's cookie), because a guard that reads one more
 * place than it should is exactly the defect this is for.
 *
 * Rows are created and deleted, so it runs only on a database named for
 * testing; see integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_EMAIL_DOMAIN = "reefclub-ket-vilag.invalid";
const PASSWORD = "reefclub ket vilag jelszo";
const NEW_PASSWORD = "reefclub uj jelszo 2026";
const CSRF = "ket-vilag-csrf";
const PARAM = "rc-ket-vilag-nincs";

/** The ReefClub routes that answer without a session; every other one is closed. */
const REEFCLUB_OPEN_ROUTES = [
  "POST /rc/v1/auth/login",
  "POST /rc/v1/auth/logout",
  "POST /rc/v1/auth/password-reset",
  "POST /rc/v1/auth/password-reset/confirm",
  "POST /rc/v1/auth/register",
  "POST /rc/v1/auth/verify-email",
  "GET /rc/v1/health",
];

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

/** A requestable path: every parameter and wildcard filled with a dummy. */
function concrete(path: string): string {
  return path
    .replace(/\{([^}]*)\}/g, "$1")
    .replace(/:\w+/g, PARAM)
    .replace(/\*\w*/g, PARAM);
}

/**
 * A request that never answers counts as an ANSWER, not as a hang: status 0,
 * which is never the anonymous 401, so the route is listed as a leak by name.
 * Measured on the calibration branch: with a guard that let the foreign
 * cookie through, one internal handler kept its connection open, and without
 * this limit the sweep sat until the CI job's timeout and named nothing.
 * The body is cancelled, not read: only the status matters, and a streaming
 * route would otherwise hold the read forever after its headers.
 */
const REQUEST_TIMEOUT_MS = 15_000;
const TIMED_OUT = 0;

async function statusOf(
  base: string,
  route: Route,
  headers: Record<string, string> = {},
): Promise<number> {
  const hasBody = ["POST", "PUT", "PATCH"].includes(route.method);
  try {
    const response = await fetch(`${base}${concrete(route.path)}`, {
      method: route.method,
      redirect: "manual",
      headers: hasBody
        ? { "Content-Type": "application/json", ...headers }
        : headers,
      body: hasBody ? "{}" : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => undefined);
    return response.status;
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError")
      return TIMED_OUT;
    throw error;
  }
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

describe(
  "ReefClub: két világ és e-mailes belépés",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    const mails: OutgoingMail[] = [];
    let internal: INestApplication;
    let reefclub: INestApplication;
    let internalBase: string;
    let reefclubBase: string;

    let internalBearer: string;
    let internalCookieToken: string;
    let reefclubToken: string;

    const email = (name: string) => `${name}-${suffix}@${TEST_EMAIL_DOMAIN}`;

    async function rc(
      path: string,
      init: {
        method?: string;
        body?: unknown;
        cookie?: string;
        csrf?: string;
      } = {},
    ): Promise<Response> {
      const headers: Record<string, string> = {};
      if (init.body !== undefined) headers["Content-Type"] = "application/json";
      if (init.cookie) headers.cookie = init.cookie;
      if (init.csrf) headers["x-csrf-token"] = init.csrf;
      return fetch(`${reefclubBase}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    }

    async function settle(): Promise<void> {
      await reefclub.get(ReefClubAuthService).settled();
    }

    function lastMailTo(address: string): OutgoingMail {
      const mail = [...mails].reverse().find((m) => m.to.includes(address));
      assert.ok(mail, `nem ment levél ide: ${address}`);
      return mail;
    }

    function tokenIn(mail: OutgoingMail): string {
      const match = /#token=([A-Za-z0-9_-]+)/.exec(mail.text);
      assert.ok(match, "a levélben nincs token");
      return match[1]!;
    }

    /** A verified account straight in the table, and a real login on it. */
    async function verifiedLogin(name: string): Promise<{
      cookie: string;
      csrf: string;
      token: string;
    }> {
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
      assert.ok(cookies.rc_session && cookies.rc_csrf);
      return {
        token: cookies.rc_session,
        csrf: cookies.rc_csrf,
        cookie: `rc_session=${cookies.rc_session}; rc_csrf=${cookies.rc_csrf}`,
      };
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      await prisma.user.create({
        data: {
          email: email("belso"),
          displayName: "Két világ belső kolléga",
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
          // The ReefClub process normally gets its own address variable; here it
          // is the test database the common run already uses (slice 6 narrows
          // the role, not the database).
          databaseUrl: integrationDatabaseUrl(process.env),
          mailSender: {
            async send(mail) {
              mails.push(mail);
            },
          },
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

      const web = await fetch(`${internalBase}/auth/login/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email("belso"), password: PASSWORD }),
      });
      assert.equal(web.status, 201);
      internalCookieToken = setCookies(web).acropora_session!;
      assert.ok(internalCookieToken);

      reefclubToken = (await verifiedLogin("vilag")).token;
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
          nev: "User (a suite e-mail tartománya)",
          darab: await prisma.user.count({
            where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
          }),
        },
      ]);
    });

    async function removeLeftovers(): Promise<void> {
      // Sessions and tokens go with the account (Cascade).
      await prisma.reefClubAccount.deleteMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });
    }

    it("a ReefClub-folyamat csak /rc/v1 útvonalat szolgál ki, a belső egyet sem", () => {
      const reefclubRoutes = routesOf(reefclub);
      const internalRoutes = routesOf(internal);
      // The control on the reading itself: an empty router would pass both.
      assert.ok(reefclubRoutes.length >= REEFCLUB_OPEN_ROUTES.length);
      assert.ok(
        internalRoutes.length > 300,
        `${internalRoutes.length} belső útvonal`,
      );
      assert.deepEqual(
        reefclubRoutes.filter((r) => !r.path.startsWith("/rc/v1/")),
        [],
      );
      assert.deepEqual(
        internalRoutes.filter((r) => r.path.startsWith("/rc/")),
        [],
      );
    });

    it("a ReefClubban pontosan a felsorolt útvonalak nyitottak, minden más 401 munkamenet nélkül", async () => {
      const open: string[] = [];
      for (const route of routesOf(reefclub)) {
        const status = await statusOf(reefclubBase, route);
        if (status !== 401) open.push(`${route.method} ${route.path}`);
      }
      assert.deepEqual(open.sort(), [...REEFCLUB_OPEN_ROUTES].sort());
    });

    it("ReefClub-munkamenet a belső API egyetlen útvonalán sem ér többet a semminél", async () => {
      const shapes: Record<string, Record<string, string>> = {
        "ReefClub-süti": {
          cookie: `rc_session=${reefclubToken}; rc_csrf=${CSRF}`,
          "x-csrf-token": CSRF,
        },
        "ReefClub-token Bearerként": {
          authorization: `Bearer ${reefclubToken}`,
        },
        "ReefClub-token a belső sütiben": {
          cookie: `acropora_session=${reefclubToken}; acropora_csrf=${CSRF}`,
          "x-csrf-token": CSRF,
        },
      };
      const leaks: string[] = [];
      let closed = 0;
      for (const route of routesOf(internal)) {
        const anonymous = await statusOf(internalBase, route);
        if (anonymous === 401) closed += 1;
        for (const [shape, headers] of Object.entries(shapes)) {
          const status = await statusOf(internalBase, route, headers);
          const unlocked =
            anonymous === 401
              ? status !== 401
              : status < 400 && anonymous >= 400;
          if (unlocked)
            leaks.push(
              `${route.method} ${route.path} [${shape}]: ${anonymous} -> ${status}`,
            );
        }
      }
      assert.ok(
        closed > 300,
        `csak ${closed} zárt belső útvonal: a söprés nem azt méri, amit állít`,
      );
      assert.deepEqual(leaks, []);
    });

    it("belső munkamenet a /rc/v1 egyetlen útvonalán sem ér többet a semminél", async () => {
      const shapes: Record<string, Record<string, string>> = {
        "belső Bearer": { authorization: `Bearer ${internalBearer}` },
        "belső süti": {
          cookie: `acropora_session=${internalCookieToken}; acropora_csrf=${CSRF}`,
          "x-csrf-token": CSRF,
        },
        "belső token a ReefClub-sütiben": {
          cookie: `rc_session=${internalBearer}; rc_csrf=${CSRF}`,
          "x-csrf-token": CSRF,
        },
        "belső webes token a ReefClub-sütiben": {
          cookie: `rc_session=${internalCookieToken}; rc_csrf=${CSRF}`,
          "x-csrf-token": CSRF,
        },
      };
      const leaks: string[] = [];
      let closed = 0;
      for (const route of routesOf(reefclub)) {
        const anonymous = await statusOf(reefclubBase, route);
        if (anonymous === 401) closed += 1;
        for (const [shape, headers] of Object.entries(shapes)) {
          const status = await statusOf(reefclubBase, route, headers);
          if (status !== anonymous)
            leaks.push(
              `${route.method} ${route.path} [${shape}]: ${anonymous} -> ${status}`,
            );
        }
      }
      assert.ok(closed >= 2, `csak ${closed} zárt ReefClub-útvonal`);
      assert.deepEqual(leaks, []);
    });

    it("a saját ReefClub-munkamenet a saját oldalán működik (a söprés pozitív kontrollja)", async () => {
      const response = await rc("/rc/v1/me", {
        cookie: `rc_session=${reefclubToken}`,
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        email: email("vilag"),
        loginMethods: ["PASSWORD"],
        notifyOnRelease: true,
        consentVersion: "teszt-1",
      });
      const internalMe = await fetch(`${internalBase}/auth/me`, {
        headers: { authorization: `Bearer ${internalBearer}` },
      });
      assert.equal(internalMe.status, 200);
    });

    it("regisztráció, megerősítés, belépés, beállítás, kilépés", async () => {
      const address = email("uj");
      const register = await rc("/rc/v1/auth/register", {
        method: "POST",
        body: { email: address, password: PASSWORD, consentVersion: "teszt-1" },
      });
      assert.equal(register.status, 202);
      await settle();
      const verifyToken = tokenIn(lastMailTo(address));

      const early = await rc("/rc/v1/auth/login", {
        method: "POST",
        body: { email: address, password: PASSWORD },
      });
      assert.equal(early.status, 403, "megerősítetlen e-maillel nem lép be");

      assert.equal(
        (
          await rc("/rc/v1/auth/verify-email", {
            method: "POST",
            body: { token: verifyToken },
          })
        ).status,
        204,
      );
      assert.equal(
        (
          await rc("/rc/v1/auth/verify-email", {
            method: "POST",
            body: { token: verifyToken },
          })
        ).status,
        400,
        "a megerősítő token egyszer használható",
      );

      const login = await rc("/rc/v1/auth/login", {
        method: "POST",
        body: { email: address.toUpperCase(), password: PASSWORD },
      });
      assert.equal(login.status, 204);
      const cookies = setCookies(login);
      const cookie = `rc_session=${cookies.rc_session}; rc_csrf=${cookies.rc_csrf}`;
      const stored = await prisma.reefClubAccount.findUniqueOrThrow({
        where: { email: address },
        select: { consentVersion: true, consentAt: true },
      });
      assert.equal(stored.consentVersion, "teszt-1");

      assert.equal(
        (
          await rc("/rc/v1/me", {
            method: "PATCH",
            cookie,
            body: { notifyOnRelease: false },
          })
        ).status,
        403,
        "CSRF nélkül nem módosít",
      );
      assert.equal(
        (
          await rc("/rc/v1/me", {
            method: "PATCH",
            cookie,
            csrf: cookies.rc_csrf,
            body: { notifyOnRelease: false, email: "mas@pelda.hu" },
          })
        ).status,
        400,
        "ismeretlen mezőt elutasít",
      );
      const patched = await rc("/rc/v1/me", {
        method: "PATCH",
        cookie,
        csrf: cookies.rc_csrf,
        body: { notifyOnRelease: false },
      });
      assert.equal(patched.status, 200);
      assert.equal(
        ((await patched.json()) as { notifyOnRelease: boolean })
          .notifyOnRelease,
        false,
      );

      assert.equal(
        (await rc("/rc/v1/auth/logout", { method: "POST", cookie })).status,
        204,
      );
      assert.equal(
        (await rc("/rc/v1/me", { cookie })).status,
        401,
        "kilépés után a süti halott",
      );
    });

    it("a regisztráció válasza nem árulja el, hogy van-e fiók, és meglévő fiókot nem módosít", async () => {
      const existing = email("vilag");
      const previous = await prisma.reefClubAccount.findUniqueOrThrow({
        where: { email: existing },
        select: { passwordHash: true, consentVersion: true },
      });
      const fresh = await rc("/rc/v1/auth/register", {
        method: "POST",
        body: {
          email: email("friss"),
          password: PASSWORD,
          consentVersion: "teszt-1",
        },
      });
      const taken = await rc("/rc/v1/auth/register", {
        method: "POST",
        body: {
          email: existing,
          password: NEW_PASSWORD,
          consentVersion: "teszt-2",
        },
      });
      assert.equal(fresh.status, taken.status);
      assert.equal(await fresh.text(), await taken.text());
      await settle();

      const mail = lastMailTo(existing);
      assert.doesNotMatch(mail.text, /token=/);
      const current = await prisma.reefClubAccount.findUniqueOrThrow({
        where: { email: existing },
        select: { passwordHash: true, consentVersion: true },
      });
      assert.deepEqual(current, previous);
    });

    it("a jelszó-visszaállítás minden munkamenetet megszüntet, és a token egyszer él", async () => {
      const name = "jelszo";
      const first = await verifiedLogin(name);
      const address = email(name);

      const unknown = await rc("/rc/v1/auth/password-reset", {
        method: "POST",
        body: { email: email("nincs-ilyen") },
      });
      const known = await rc("/rc/v1/auth/password-reset", {
        method: "POST",
        body: { email: address },
      });
      assert.equal(unknown.status, 202);
      assert.equal(known.status, 202);
      await settle();
      assert.equal(
        mails.filter((m) => m.to.includes(email("nincs-ilyen"))).length,
        0,
      );
      const resetToken = tokenIn(lastMailTo(address));

      assert.equal(
        (
          await rc("/rc/v1/auth/verify-email", {
            method: "POST",
            body: { token: resetToken },
          })
        ).status,
        400,
        "a visszaállító token megerősítésre nem használható",
      );
      assert.equal(
        (
          await rc("/rc/v1/auth/password-reset/confirm", {
            method: "POST",
            body: { token: resetToken, password: NEW_PASSWORD },
          })
        ).status,
        204,
      );
      assert.equal(
        (
          await rc("/rc/v1/auth/password-reset/confirm", {
            method: "POST",
            body: { token: resetToken, password: "harmadik jelszo 99" },
          })
        ).status,
        400,
        "a visszaállító token egyszer használható",
      );
      assert.equal(
        (await rc("/rc/v1/me", { cookie: first.cookie })).status,
        401,
      );
      assert.equal(
        (
          await rc("/rc/v1/auth/login", {
            method: "POST",
            body: { email: address, password: PASSWORD },
          })
        ).status,
        401,
        "a régi jelszó halott",
      );
      assert.equal(
        (
          await rc("/rc/v1/auth/login", {
            method: "POST",
            body: { email: address, password: NEW_PASSWORD },
          })
        ).status,
        204,
      );
    });
  },
);
