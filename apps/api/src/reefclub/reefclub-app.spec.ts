import "reflect-metadata";

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AuthService } from "../auth/auth.service.js";
import { SessionRepository } from "../auth/session.repository.js";
import { configureReefClubApp } from "./reefclub-app.configuration.js";
import { ReefClubAppModule } from "./reefclub.module.js";

/**
 * THE REEFCLUB PROCESS, WITHOUT A DATABASE: what it loads and which routes it
 * serves. The database-backed half (sessions, the two-world sweep) is
 * `reefclub-ket-vilag.integration.spec.ts`; this half runs in every unit run.
 *
 * The address points at a port nothing listens on: building the application
 * never connects, and no assertion here reaches a query.
 */
const EXPECTED_ROUTES = [
  "DELETE /rc/v1/aquariums/:id",
  "DELETE /rc/v1/aquariums/:id/measurements/:occasionId",
  "GET /rc/v1/aquariums",
  "GET /rc/v1/aquariums/:id",
  "GET /rc/v1/aquariums/:id/measurements",
  "GET /rc/v1/aquariums/:id/targets",
  "PATCH /rc/v1/aquariums/:id",
  "POST /rc/v1/aquariums",
  "POST /rc/v1/aquariums/:id/measurements",
  "PUT /rc/v1/aquariums/:id/targets",
  "DELETE /rc/v1/shop-links/:id",
  "GET /rc/v1/shop-links",
  "POST /rc/v1/shop-links",
  "GET /rc/v1/health",
  "GET /rc/v1/me",
  "PATCH /rc/v1/me",
  "POST /rc/v1/auth/apple",
  "POST /rc/v1/auth/google",
  "POST /rc/v1/auth/login",
  "POST /rc/v1/auth/logout",
  "POST /rc/v1/auth/password-reset",
  "POST /rc/v1/auth/password-reset/confirm",
  "POST /rc/v1/auth/register",
  "POST /rc/v1/auth/verify-email",
  "POST /rc/v1/me/identities/apple",
  "POST /rc/v1/me/identities/google",
];

describe("ReefClub-folyamat (adatbázis nélkül)", () => {
  let app: INestApplication;
  let base: string;

  before(async () => {
    app = await NestFactory.create(
      ReefClubAppModule.forRoot({
        mailSender: { async send() {} },
        databaseUrl: "postgresql://nincs:nincs@127.0.0.1:1/reefclub_unit_test",
      }),
      // Without `abortOnError: false` Nest ends the PROCESS on an unknown
      // provider in `app.get`, so the assertion below would exit the test run
      // with code 1 and no message instead of passing.
      { logger: false, abortOnError: false },
    );
    configureReefClubApp(app);
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  after(async () => {
    await app?.close();
  });

  it("pontosan a ReefClub útvonalait szolgálja ki, mind /rc/v1 alatt", () => {
    const router = (
      app.getHttpAdapter().getInstance() as {
        router: {
          stack: {
            route?: { path: string; methods: Record<string, boolean> };
          }[];
        };
      }
    ).router;
    const routes = router.stack.flatMap((layer) =>
      layer.route
        ? Object.keys(layer.route.methods).map(
            (method) => `${method.toUpperCase()} ${layer.route!.path}`,
          )
        : [],
    );
    assert.deepEqual(routes.sort(), [...EXPECTED_ROUTES].sort());
  });

  it("a belső hitelesítés egyetlen szolgáltatása sincs betöltve", () => {
    assert.throws(() => app.get(AuthService, { strict: false }));
    assert.throws(() => app.get(SessionRepository, { strict: false }));
  });

  it("az alkalmazás-őr él: munkamenet nélkül a zárt útvonal 401, adatbázis nélkül is", async () => {
    const response = await fetch(`${base}/rc/v1/me`);
    assert.equal(response.status, 401);
  });

  it("idegen oldal űrlap-POST-ja a belépésre 403, sütit nem állít (adatbázis nélkül is)", async () => {
    const response = await fetch(`${base}/rc/v1/auth/login`, {
      method: "POST",
      headers: {
        origin: "https://tamado.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "email=tamado%40pelda.hu&password=tamado+jelszava",
    });
    assert.equal(response.status, 403);
    assert.deepEqual(response.headers.getSetCookie(), []);
  });

  it("belső útvonal ebben a folyamatban nem létezik: 404", async () => {
    const response = await fetch(`${base}/auth/me`);
    assert.equal(response.status, 404);
  });
});
