import "reflect-metadata";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { prisma, PrismaClient } from "@acropora/database";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import {
  integrationDatabaseGate,
  integrationDatabaseUrl,
} from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import type { OutgoingMail } from "../notifications/mail/mail.port.js";
import {
  REEFCLUB_DELETION_GRACE_MS,
  ReefClubAccountDeletionService,
} from "./reefclub-account-deletion.service.js";
import { configureReefClubApp } from "./reefclub-app.configuration.js";
import {
  REEFCLUB_PRIVACY_NOTICE_VERSION,
  REEFCLUB_SHARE_CONSENT_VERSION,
} from "./reefclub-consent.js";
import { hashLinkCode, normalizeLinkCode } from "./reefclub-link-code.js";
import { ReefClubAppModule } from "./reefclub.module.js";

/**
 * THE REEFCLUB PROCESS ON ITS RESTRICTED ROLE (plan v6.1, 2.1 and 5.4;
 * acceptance 7.8 and 7.13; slice 6).
 *
 * A role is created for the run, `packages/database/sql/reefclub-role.sql` is
 * applied to it AS IT IS (only the role's name is the run's), and the ReefClub
 * application connects with that role. Then:
 *
 *   - every ReefClub flow works on it: registration, e-mail confirmation,
 *     password reset, login, the account, own aquariums, targets, manual
 *     measurements, sharing, the shop link with a released shop measurement,
 *     account deletion and its final sweep. A grant the code needs and the
 *     file lacks is a red test here, not a production error;
 *   - with the same role, the invoice, worksheet, product and user tables, the
 *     customer's phone and e-mail, the aquarium's internal columns and the
 *     share log cannot be read (5.4: "hibát kell adjon").
 *   - with the same role, a shop aquarium, its measurements and target ranges
 *     cannot be changed or deleted, a link needs a code the account claimed,
 *     an ended link stays ended and a claimed code stays claimed (the
 *     row-level policies of the file; barracuda, #1730). Each refused shape
 *     has a control of the same shape on an own aquarium that succeeds.
 *
 * The rows are written by the test's own (owner) connection where the
 * ReefClub has no route for them (the shop's customer, its release, a code).
 * Runs only on a database named for testing; see integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_EMAIL_DOMAIN = "reefclub-szerep.invalid";
const NAME_PREFIX = "RC-szerep-proba";
const PASSWORD = "reefclub szerep jelszo";
const NEW_PASSWORD = "reefclub szerep uj jelszo";
const CODE = "SZRPK-DAAB2";
const SHOP_OCCASION = "2026-06-01T08:00:00.000Z";
const SQL_FILE = fileURLToPath(
  new URL(
    "../../../../packages/database/sql/reefclub-role.sql",
    import.meta.url,
  ),
);

/**
 * The file's statements: comment lines dropped, split on the semicolons that
 * are not inside a dollar-quoted body (the function owner's DO block has its
 * own).
 */
function statements(sql: string, role: string): string[] {
  const text = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replaceAll('"reefclub_app"', `"${role}"`);
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const piece of text.split(/(\$\$|;)/)) {
    if (piece === "$$") quoted = !quoted;
    if (piece === ";" && !quoted) {
      parts.push(current);
      current = "";
    } else current += piece;
  }
  parts.push(current);
  return parts.map((statement) => statement.trim()).filter(Boolean);
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

describe(
  "ReefClub: a folyamat a szűkített adatbázis-szereppel",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    const role = `reefclub_app_proba_${suffix}`;
    const rolePassword = `szerep-${suffix}-jelszo`;
    const mails: OutgoingMail[] = [];
    let roleUrl: string;
    let asRole: PrismaClient;
    let reefclub: INestApplication;
    let base: string;
    let session: Session;
    let customerId: string;
    let shopAquariumId: string;

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
      return fetch(`${base}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    }

    /** A request that must succeed on the role; the body for the next step. */
    async function ok(
      label: string,
      path: string,
      init: { method?: string; body?: unknown; session?: Session } = {},
    ): Promise<unknown> {
      const response = await rc(path, init);
      const text = await response.text();
      assert.ok(
        response.status >= 200 && response.status < 300,
        `${label}: ${response.status} ${text.slice(0, 300)}`,
      );
      return text ? (JSON.parse(text) as unknown) : null;
    }

    async function settle(): Promise<void> {
      // The registration and the reset run in the background (slice 2).
      const { ReefClubAuthService } =
        await import("./reefclub-auth.service.js");
      await reefclub.get(ReefClubAuthService).settled();
    }

    function tokenIn(address: string): string {
      const mail = [...mails].reverse().find((m) => m.to.includes(address));
      assert.ok(mail, `nem ment levél ide: ${address}`);
      const match = /#token=([A-Za-z0-9_-]+)/.exec(mail.text);
      assert.ok(match, "a levélben nincs token");
      return match[1]!;
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const ownerUrl = integrationDatabaseUrl(process.env);
      await prisma.$executeRawUnsafe(
        `CREATE ROLE "${role}" LOGIN PASSWORD '${rolePassword}'`,
      );
      for (const statement of statements(readFileSync(SQL_FILE, "utf8"), role))
        await prisma.$executeRawUnsafe(statement);
      const url = new URL(ownerUrl);
      url.username = role;
      url.password = rolePassword;
      roleUrl = url.toString();
      asRole = new PrismaClient({ datasourceUrl: roleUrl });

      customerId = (
        await prisma.customer.create({
          data: {
            customerNumber: `RCS-${suffix}`,
            type: "PERSON",
            displayName: `${NAME_PREFIX} vevő`,
            email: email("vevo"),
            phone: "+36 1 000 0000",
          },
        })
      ).id;
      shopAquariumId = (
        await prisma.aquarium.create({
          data: {
            aquariumNumber: `RCS-${suffix}`,
            customerId,
            ownershipType: "CUSTOMER",
            name: `${NAME_PREFIX} bolti`,
            waterType: "TENGERI",
            notes: "belső jegyzet",
            measurements: {
              create: [
                {
                  parameterCode: "KH",
                  value: 7.5,
                  unit: "dKH",
                  measuredAt: new Date(SHOP_OCCASION),
                  source: "bolt",
                  notes: "belső",
                },
              ],
            },
            releases: { create: [{ measuredAt: new Date(SHOP_OCCASION) }] },
          },
        })
      ).id;
      await prisma.reefClubLinkCode.create({
        data: {
          customerId,
          codeHash: hashLinkCode(normalizeLinkCode(CODE)!),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });

      reefclub = await NestFactory.create(
        ReefClubAppModule.forRoot({
          databaseUrl: roleUrl,
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
      base = `http://127.0.0.1:${(reefclub.getHttpServer().address() as AddressInfo).port}`;
    });

    after(async () => {
      await reefclub?.close();
      await asRole?.$disconnect();
      await removeLeftovers();
      await prisma
        .$executeRawUnsafe(`DROP OWNED BY "${role}"`)
        .catch(() => undefined);
      await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS "${role}"`);
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
      ]);
    });

    async function removeLeftovers(): Promise<void> {
      const accounts = await prisma.reefClubAccount.findMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
        select: { id: true },
      });
      await prisma.reefClubAccountDeletion.deleteMany({
        where: { accountId: { in: accounts.map((a) => a.id) } },
      });
      await prisma.aquarium.deleteMany({
        where: { name: { startsWith: NAME_PREFIX } },
      });
      await prisma.customer.deleteMany({
        where: { displayName: { startsWith: NAME_PREFIX } },
      });
      await prisma.reefClubAccount.deleteMany({
        where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      });
    }

    it("regisztráció, megerősítés, jelszó-visszaállítás és belépés a szereppel", async () => {
      await ok("regisztráció", "/rc/v1/auth/register", {
        method: "POST",
        body: {
          email: email("a"),
          password: PASSWORD,
          consentVersion: REEFCLUB_PRIVACY_NOTICE_VERSION,
        },
      });
      await settle();
      await ok("e-mail megerősítés", "/rc/v1/auth/verify-email", {
        method: "POST",
        body: { token: tokenIn(email("a")) },
      });
      await ok("jelszó-visszaállítás kérése", "/rc/v1/auth/password-reset", {
        method: "POST",
        body: { email: email("a") },
      });
      await settle();
      await ok("jelszó-visszaállítás", "/rc/v1/auth/password-reset/confirm", {
        method: "POST",
        body: { token: tokenIn(email("a")), password: NEW_PASSWORD },
      });
      const login = await rc("/rc/v1/auth/login", {
        method: "POST",
        body: { email: email("a"), password: NEW_PASSWORD },
      });
      assert.equal(login.status, 204, await login.text());
      const cookies = setCookies(login);
      session = {
        cookie: `rc_session=${cookies.rc_session}; rc_csrf=${cookies.rc_csrf}`,
        csrf: cookies.rc_csrf!,
      };
      await ok("fiók", "/rc/v1/me", { session });
      await ok("értesítés", "/rc/v1/me", {
        method: "PATCH",
        body: { notifyOnRelease: false },
        session,
      });
      await ok("hozzájárulás", "/rc/v1/me/share-consent", { session });
    });

    it("saját akvárium, célsáv, kézi mérés és megosztás a szereppel", async () => {
      const created = (await ok("akvárium", "/rc/v1/aquariums", {
        method: "POST",
        body: { name: `${NAME_PREFIX} saját`, waterType: "TENGERI" },
        session,
      })) as { id: string };
      const id = created.id;
      await ok("lista", "/rc/v1/aquariums", { session });
      await ok("részlet", `/rc/v1/aquariums/${id}`, { session });
      await ok("szerkesztés", `/rc/v1/aquariums/${id}`, {
        method: "PATCH",
        body: { name: `${NAME_PREFIX} saját átírva`, systemVolumeLiters: 120 },
        session,
      });
      await ok("célsáv", `/rc/v1/aquariums/${id}/targets`, {
        method: "PUT",
        body: { targets: [{ parameterCode: "KH", min: 7, max: 9 }] },
        session,
      });
      await ok("célsáv olvasás", `/rc/v1/aquariums/${id}/targets`, { session });
      const occasion = (await ok(
        "mérés",
        `/rc/v1/aquariums/${id}/measurements`,
        {
          method: "POST",
          body: {
            measuredAt: "2026-06-02T08:00:00.000Z",
            clientOperationId: `szerep-${suffix}`,
            values: [{ parameterCode: "KH", value: 6.5 }],
          },
          session,
        },
      )) as { id: string };
      await ok("mérés ismétlés", `/rc/v1/aquariums/${id}/measurements`, {
        method: "POST",
        body: {
          measuredAt: "2026-06-02T08:00:00.000Z",
          clientOperationId: `szerep-${suffix}`,
          values: [{ parameterCode: "KH", value: 6.5 }],
        },
        session,
      });
      await ok("mérések", `/rc/v1/aquariums/${id}/measurements`, { session });
      await ok("megosztás", `/rc/v1/aquariums/${id}/share`, {
        method: "POST",
        body: { consentVersion: REEFCLUB_SHARE_CONSENT_VERSION },
        session,
      });
      await ok("előnézet", `/rc/v1/aquariums/${id}/share/preview`, { session });
      await ok("visszavonás", `/rc/v1/aquariums/${id}/share`, {
        method: "DELETE",
        session,
      });
      await ok(
        "mérés törlése",
        `/rc/v1/aquariums/${id}/measurements/${encodeURIComponent(occasion.id)}`,
        { method: "DELETE", session },
      );
      const second = (await ok("második akvárium", "/rc/v1/aquariums", {
        method: "POST",
        body: { name: `${NAME_PREFIX} törlendő` },
        session,
      })) as { id: string };
      await ok("akvárium törlése", `/rc/v1/aquariums/${second.id}`, {
        method: "DELETE",
        session,
      });
      // Shared again, so the deletion below has a share to revoke.
      await ok("megosztás újra", `/rc/v1/aquariums/${id}/share`, {
        method: "POST",
        body: { consentVersion: REEFCLUB_SHARE_CONSENT_VERSION },
        session,
      });
    });

    it("bolti összekapcsolás és a véglegesített bolti mérés a szereppel", async () => {
      const link = (await ok("beváltás", "/rc/v1/shop-links", {
        method: "POST",
        body: { code: CODE },
        session,
      })) as { id: string };
      await ok("összekapcsolások", "/rc/v1/shop-links", { session });
      const occasions = (await ok(
        "bolti mérések",
        `/rc/v1/aquariums/${shopAquariumId}/measurements`,
        { session },
      )) as { occasions: { id: string }[] };
      assert.deepEqual(
        occasions.occasions.map((o) => o.id),
        [SHOP_OCCASION],
      );
      await ok("bolti célsáv", `/rc/v1/aquariums/${shopAquariumId}/targets`, {
        session,
      });
      assert.ok(link.id);
    });

    it("fióktörlés és a végleges törlés a szereppel", async () => {
      await ok("törlés kérése", "/rc/v1/me", {
        method: "DELETE",
        body: { method: "PASSWORD", password: NEW_PASSWORD },
        session,
      });
      const deleted = await reefclub
        .get(ReefClubAccountDeletionService)
        .sweep(new Date(Date.now() + REEFCLUB_DELETION_GRACE_MS + 60_000));
      assert.ok(deleted >= 1);
      assert.equal(
        await prisma.reefClubAccount.count({ where: { email: email("a") } }),
        0,
      );
    });

    it("a szereppel a tiltott táblák és oszlopok nem olvashatók, a megengedett igen (kontroll)", async () => {
      const refused: string[] = [];
      const read = async (sql: string) =>
        asRole.$queryRawUnsafe(sql).then(
          () => "OLVASHATÓ",
          (error: unknown) =>
            /permission denied/i.test(String(error))
              ? "TILTOTT"
              : String(error),
        );
      for (const sql of [
        'SELECT 1 FROM "Invoice" LIMIT 1',
        'SELECT 1 FROM "Worksheet" LIMIT 1',
        'SELECT 1 FROM "Product" LIMIT 1',
        'SELECT 1 FROM "User" LIMIT 1',
        'SELECT 1 FROM "Session" LIMIT 1',
        'SELECT "phone" FROM "Customer" LIMIT 1',
        'SELECT "email" FROM "Customer" LIMIT 1',
        'SELECT "notes" FROM "Aquarium" LIMIT 1',
        'SELECT "maintainedByUs" FROM "Aquarium" LIMIT 1',
        'SELECT "measuredById" FROM "AquariumMeasurement" LIMIT 1',
        'SELECT 1 FROM "AquariumShareEvent" LIMIT 1',
        'SELECT 1 FROM "AquariumMeasurementRecommendation" LIMIT 1',
        'SELECT "errorMessage" FROM "ReefClubDoseProjectionRun" LIMIT 1',
        'SELECT "trigger" FROM "ReefClubDoseProjectionRun" LIMIT 1',
        'SELECT 1 FROM "ReefClubLinkCode" LIMIT 1',
      ]) {
        const result = await read(sql);
        if (result !== "TILTOTT") refused.push(`${sql}: ${result}`);
      }
      assert.deepEqual(refused, []);
      assert.equal(
        await read('SELECT "displayName" FROM "Customer" LIMIT 1'),
        "OLVASHATÓ",
        "kontroll: a megengedett oszlop olvasható",
      );
      // the projection of the dose list (slice 8, path B): the rows and the run's age are readable
      for (const sql of [
        'SELECT "sourceId", "sourceVersion", "refusals", "inStock" FROM "ReefClubDoseRow" LIMIT 1',
        'SELECT "id", "status", "finishedAt", "rowCount" FROM "ReefClubDoseProjectionRun" LIMIT 1',
      ])
        assert.equal(await read(sql), "OLVASHATÓ", sql);
    });

    it("a szereppel a belső sorok nem írhatók, a ReefClub sajátjai igen (#1730 barracuda, sorszintű házirend)", async () => {
      // Its own fixtures, on the owner connection: an account with an own
      // aquarium, a target range on the shop aquarium, an ended link and a
      // claimed code. The shop aquarium and its measurement come from before().
      const account = await prisma.reefClubAccount.create({
        data: {
          email: email("iras"),
          consentVersion: "proba",
          consentAt: new Date(),
        },
      });
      const own = await prisma.aquarium.create({
        data: {
          aquariumNumber: `RCS-${suffix}-S`,
          ownerAccountId: account.id,
          ownershipType: "CUSTOMER",
          name: `${NAME_PREFIX} saját`,
        },
      });
      const shopMeasurement = await prisma.aquariumMeasurement.findFirstOrThrow(
        { where: { aquariumId: shopAquariumId }, select: { id: true } },
      );
      const shopTarget = await prisma.aquariumMeasurementTarget.create({
        data: { aquariumId: shopAquariumId, parameterCode: "KH", min: 7 },
      });
      const ended = await prisma.reefClubCustomerLink.create({
        data: {
          accountId: account.id,
          customerId,
          status: "ENDED",
          endedAt: new Date(),
          endedBy: "ACCOUNT",
        },
      });
      // Another person customer: a code claimed for the first one must not
      // link the account to this one (barracuda, #1748).
      const otherCustomer = await prisma.customer.create({
        data: {
          customerNumber: `RCS-${suffix}-M`,
          type: "PERSON",
          displayName: `${NAME_PREFIX} másik vevő`,
        },
      });
      const used = await prisma.reefClubLinkCode.create({
        data: {
          customerId,
          codeHash: `szerep-iras-${suffix}`,
          expiresAt: new Date(Date.now() + 3_600_000),
          usedAt: new Date(),
          usedByAccountId: account.id,
        },
      });

      // A refused INSERT is the row-level security error; a refused UPDATE or
      // DELETE matches no row. Every refused shape has a control of the same
      // shape on the account's own aquarium that must succeed: without it a
      // missing column grant would read as the policy.
      const write = (sql: string, ...values: unknown[]) =>
        asRole.$executeRawUnsafe(sql, ...values).then(
          (count) => count,
          (error: unknown) =>
            /row-level security/i.test(String(error))
              ? "SORSZINTŰ TILTÁS"
              : /permission denied/i.test(String(error))
                ? "OSZLOP/TÁBLA TILTÁS"
                : String(error),
        );
      const measurementSql =
        'INSERT INTO "AquariumMeasurement" ("id", "aquariumId", "parameterCode", "value", "unit", "measuredAt", "source", "recordedByAccountId") VALUES ($1, $2, \'KH\', 7, \'dKH\', $3::timestamp(3), $4, $5)';
      const targetSql =
        'INSERT INTO "AquariumMeasurementTarget" ("id", "aquariumId", "parameterCode", "min", "updatedAt") VALUES ($1, $2, \'CA\', 400, now())';
      const aquariumSql =
        'INSERT INTO "Aquarium" ("id", "aquariumNumber", "ownerAccountId", "ownershipType", "name", "updatedAt") VALUES ($1, $2, $3, \'CUSTOMER\', $4, now())';
      const linkWithCodeSql =
        'INSERT INTO "ReefClubCustomerLink" ("id", "accountId", "customerId", "codeId", "status") VALUES ($1, $2, $3, $4, \'ACTIVE\')';
      const shareSql =
        'INSERT INTO "AquariumShareEvent" ("id", "aquariumId", "kind", "accountId") VALUES ($1, $2, \'SHARED\', $3)';
      const result: Record<string, unknown> = {
        "kontroll: saját akvárium átnevezése": await write(
          'UPDATE "Aquarium" SET "name" = $1 WHERE "id" = $2',
          `${NAME_PREFIX} saját 2`,
          own.id,
        ),
        "bolti akvárium átnevezése": await write(
          'UPDATE "Aquarium" SET "name" = $1 WHERE "id" = $2',
          `${NAME_PREFIX} átírva`,
          shopAquariumId,
        ),
        "bolti akvárium törlése": await write(
          'DELETE FROM "Aquarium" WHERE "id" = $1',
          shopAquariumId,
        ),
        "kontroll: ReefClub-akvárium felvétele": await write(
          aquariumSql,
          `szerep-akv-${suffix}`,
          `RCS-${suffix}-K`,
          account.id,
          `${NAME_PREFIX} kontroll`,
        ),
        "tulajdonos nélküli akvárium felvétele": await write(
          aquariumSql,
          `szerep-akv2-${suffix}`,
          `RCS-${suffix}-B`,
          null,
          `${NAME_PREFIX} belső`,
        ),
        "kontroll: kézi mérés a saját akváriumra": await write(
          measurementSql,
          `szerep-mer-${suffix}`,
          own.id,
          "2026-07-01T08:00:00.000Z",
          "REEFCLUB_MANUAL",
          account.id,
        ),
        "kézi mérés a bolti akváriumra": await write(
          measurementSql,
          `szerep-mer2-${suffix}`,
          shopAquariumId,
          "2026-07-02T08:00:00.000Z",
          "REEFCLUB_MANUAL",
          account.id,
        ),
        "bolti forrású mérés a saját akváriumra": await write(
          measurementSql,
          `szerep-mer3-${suffix}`,
          own.id,
          "2026-07-03T08:00:00.000Z",
          "bolt",
          account.id,
        ),
        "kontroll: saját kézi mérés törlése": await write(
          'DELETE FROM "AquariumMeasurement" WHERE "id" = $1',
          `szerep-mer-${suffix}`,
        ),
        "bolti mérés törlése": await write(
          'DELETE FROM "AquariumMeasurement" WHERE "id" = $1',
          shopMeasurement.id,
        ),
        "kontroll: célsáv a saját akváriumra": await write(
          targetSql,
          `szerep-cel-${suffix}`,
          own.id,
        ),
        "célsáv a bolti akváriumra": await write(
          targetSql,
          `szerep-cel2-${suffix}`,
          shopAquariumId,
        ),
        "bolti célsáv átírása": await write(
          'UPDATE "AquariumMeasurementTarget" SET "min" = 1 WHERE "id" = $1',
          shopTarget.id,
        ),
        "bolti célsáv törlése": await write(
          'DELETE FROM "AquariumMeasurementTarget" WHERE "id" = $1',
          shopTarget.id,
        ),
        "kontroll: megosztási napló a saját akváriumról": await write(
          shareSql,
          `szerep-nap-${suffix}`,
          own.id,
          account.id,
        ),
        "megosztási napló a bolti akváriumról": await write(
          shareSql,
          `szerep-nap2-${suffix}`,
          shopAquariumId,
          account.id,
        ),
        "összekapcsolás kód nélkül": await write(
          'INSERT INTO "ReefClubCustomerLink" ("id", "accountId", "customerId", "status") VALUES ($1, $2, $3, \'ACTIVE\')',
          `szerep-lnk-${suffix}`,
          account.id,
          customerId,
        ),
        "összekapcsolás a saját kódjával másik vevőre": await write(
          linkWithCodeSql,
          `szerep-lnk2-${suffix}`,
          account.id,
          otherCustomer.id,
          used.id,
        ),
        "lezárt összekapcsolás újranyitása": await write(
          'UPDATE "ReefClubCustomerLink" SET "status" = \'ACTIVE\' WHERE "id" = $1',
          ended.id,
        ),
        "összekapcsolás átírása másik fiókra": await write(
          'UPDATE "ReefClubCustomerLink" SET "accountId" = $1 WHERE "id" = $2',
          account.id,
          ended.id,
        ),
        "beváltott kód visszanyitása": await write(
          'UPDATE "ReefClubLinkCode" SET "usedAt" = NULL WHERE "id" = $1',
          used.id,
        ),
      };
      assert.deepEqual(result, {
        "kontroll: saját akvárium átnevezése": 1,
        "bolti akvárium átnevezése": 0,
        "bolti akvárium törlése": 0,
        "kontroll: ReefClub-akvárium felvétele": 1,
        "tulajdonos nélküli akvárium felvétele": "SORSZINTŰ TILTÁS",
        "kontroll: kézi mérés a saját akváriumra": 1,
        "kézi mérés a bolti akváriumra": "SORSZINTŰ TILTÁS",
        "bolti forrású mérés a saját akváriumra": "SORSZINTŰ TILTÁS",
        "kontroll: saját kézi mérés törlése": 1,
        "bolti mérés törlése": 0,
        "kontroll: célsáv a saját akváriumra": 1,
        "célsáv a bolti akváriumra": "SORSZINTŰ TILTÁS",
        "bolti célsáv átírása": 0,
        "bolti célsáv törlése": 0,
        "kontroll: megosztási napló a saját akváriumról": 1,
        "megosztási napló a bolti akváriumról": "SORSZINTŰ TILTÁS",
        // no INSERT on links and no right on codes: only the redemption function
        "összekapcsolás kód nélkül": "OSZLOP/TÁBLA TILTÁS",
        "összekapcsolás a saját kódjával másik vevőre": "OSZLOP/TÁBLA TILTÁS",
        "lezárt összekapcsolás újranyitása": 0,
        "összekapcsolás átírása másik fiókra": "OSZLOP/TÁBLA TILTÁS",
        "beváltott kód visszanyitása": "OSZLOP/TÁBLA TILTÁS",
      });

      // And on the owner connection: the shop rows are as they were.
      const shop = await prisma.aquarium.findUniqueOrThrow({
        where: { id: shopAquariumId },
        select: { name: true, _count: { select: { measurements: true } } },
      });
      assert.deepEqual(shop, {
        name: `${NAME_PREFIX} bolti`,
        _count: { measurements: 1 },
      });
      assert.equal(
        (
          await prisma.aquariumMeasurementTarget.findUniqueOrThrow({
            where: { id: shopTarget.id },
          })
        ).min?.toNumber(),
        7,
      );
      assert.equal(
        (
          await prisma.reefClubCustomerLink.findUniqueOrThrow({
            where: { id: ended.id },
          })
        ).status,
        "ENDED",
      );
      assert.ok(
        (
          await prisma.reefClubLinkCode.findUniqueOrThrow({
            where: { id: used.id },
          })
        ).usedAt,
      );
    });

    it("a beváltó függvény szuperfelhasználó tulajdonosát a fájl a táblák tulajdonosára adja (#1752, acrobot 33903)", async () => {
      const ownerOf = async () =>
        (
          await prisma.$queryRawUnsafe<{ fn: string; tbl: string }[]>(
            `SELECT pg_get_userbyid(p.proowner) AS fn,
                    (SELECT pg_get_userbyid(c.relowner) FROM pg_class c
                      WHERE c.oid = '"ReefClubLinkCode"'::regclass) AS tbl
               FROM pg_proc p
              WHERE p.oid = '"reefclub_redeem_link_code"(text, text)'::regprocedure`,
          )
        )[0]!;
      const before = await ownerOf();
      // the run's own superuser stands for a superuser that ran the migrations
      const superuser = `reefclub_proba_super_${suffix}`;
      await prisma.$executeRawUnsafe(
        `CREATE ROLE "${superuser}" SUPERUSER NOLOGIN`,
      );
      try {
        await prisma.$executeRawUnsafe(
          `ALTER FUNCTION "reefclub_redeem_link_code"(text, text) OWNER TO "${superuser}"`,
        );
        assert.equal(
          (await ownerOf()).fn,
          superuser,
          "kontroll: a csere megtörtént",
        );
        for (const statement of statements(
          readFileSync(SQL_FILE, "utf8"),
          role,
        ))
          await prisma.$executeRawUnsafe(statement);
        const after = await ownerOf();
        assert.equal(after.fn, after.tbl);
        // run again: nothing changes
        for (const statement of statements(
          readFileSync(SQL_FILE, "utf8"),
          role,
        ))
          await prisma.$executeRawUnsafe(statement);
        assert.deepEqual(await ownerOf(), after);
      } finally {
        await prisma.$executeRawUnsafe(
          `ALTER FUNCTION "reefclub_redeem_link_code"(text, text) OWNER TO "${before.fn}"`,
        );
        await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS "${superuser}"`);
      }
      // the role keeps its right after the owner change (the ACL stays)
      assert.equal(
        (
          await prisma.$queryRawUnsafe<{ ok: boolean }[]>(
            `SELECT has_function_privilege($1, '"reefclub_redeem_link_code"(text, text)', 'EXECUTE') AS ok`,
            role,
          )
        )[0]!.ok,
        true,
      );
    });

    it("a kódot csak a beváltó függvény váltja be: egyszer, érvényesen, magánszemély vevőre (#1748)", async () => {
      const account = await prisma.reefClubAccount.create({
        data: {
          email: email("bevalto"),
          consentVersion: "proba",
          consentAt: new Date(),
        },
      });
      const company = await prisma.customer.create({
        data: {
          customerNumber: `RCS-${suffix}-C`,
          type: "COMPANY",
          displayName: `${NAME_PREFIX} cég`,
        },
      });
      const code = (customer: string, hash: string, expiresIn: number) =>
        prisma.reefClubLinkCode.create({
          data: {
            customerId: customer,
            codeHash: `szerep-bevalto-${hash}-${suffix}`,
            expiresAt: new Date(Date.now() + expiresIn),
          },
        });
      // The rights themselves, not only their effect: a link INSERT the role
      // got back would still be refused (its policy reads the code table), so
      // only this tells that the grant came back.
      const rights = await prisma.$queryRawUnsafe<Record<string, boolean>[]>(
        `SELECT has_any_column_privilege($1, '"ReefClubCustomerLink"', 'INSERT') AS "linkInsert",
                has_any_column_privilege($1, '"ReefClubLinkCode"', 'SELECT') AS "codeSelect",
                has_any_column_privilege($1, '"ReefClubLinkCode"', 'INSERT') AS "codeInsert",
                has_any_column_privilege($1, '"ReefClubLinkCode"', 'UPDATE') AS "codeUpdate",
                has_table_privilege($1, '"ReefClubLinkCode"', 'DELETE') AS "codeDelete",
                has_function_privilege($1, '"reefclub_redeem_link_code"(text, text)', 'EXECUTE') AS "redeem"`,
        role,
      );
      assert.deepEqual(rights[0], {
        linkInsert: false,
        codeSelect: false,
        codeInsert: false,
        codeUpdate: false,
        codeDelete: false,
        redeem: true,
      });

      const valid = await code(customerId, "jo", 3_600_000);
      const expired = await code(customerId, "lejart", -60_000);
      const companys = await code(company.id, "ceg", 3_600_000);
      const redeem = (hash: string) =>
        asRole.$queryRawUnsafe<{ linkId: string; customerName: string }[]>(
          'SELECT "linkId", "customerName" FROM "reefclub_redeem_link_code"($1, $2)',
          hash,
          account.id,
        );

      const first = await redeem(valid.codeHash);
      assert.equal(first.length, 1);
      assert.equal(first[0]!.customerName, `${NAME_PREFIX} vevő`);
      const link = await prisma.reefClubCustomerLink.findUniqueOrThrow({
        where: { id: first[0]!.linkId },
      });
      assert.deepEqual(
        [link.accountId, link.customerId, link.codeId, link.status],
        [account.id, customerId, valid.id, "ACTIVE"],
      );
      // a second code of the same customer: spent, and answered with the
      // same active link (barracuda, #1752)
      const second = await code(customerId, "masodik", 3_600_000);
      const again = await redeem(second.codeHash);
      assert.deepEqual(
        again.map((row) => row.linkId),
        [first[0]!.linkId],
      );
      assert.equal(
        (
          await prisma.reefClubLinkCode.findUniqueOrThrow({
            where: { id: second.id },
          })
        ).usedByAccountId,
        account.id,
      );
      assert.deepEqual(
        {
          again: (await redeem(valid.codeHash)).length,
          expired: (await redeem(expired.codeHash)).length,
          company: (await redeem(companys.codeHash)).length,
          unknown: (await redeem(`nincs-ilyen-${suffix}`)).length,
        },
        { again: 0, expired: 0, company: 0, unknown: 0 },
      );
      // the claim is written with the account, in UTC like Prisma's rows
      const claimed = await prisma.reefClubLinkCode.findUniqueOrThrow({
        where: { id: valid.id },
      });
      assert.equal(claimed.usedByAccountId, account.id);
      assert.ok(Math.abs(claimed.usedAt!.getTime() - Date.now()) < 60_000);
    });

    it("a szereppel az ajánlás-napló és a beadott adag csak a saját vagy az összekötött vevő akváriumára írható (8. szelet, sorszintű házirend)", async () => {
      // Two accounts: A owns an aquarium and has an ACTIVE link to the shop customer (made on the
      // owner connection); B has neither. Each refused shape has a control of the same shape that
      // must succeed, so a missing column grant would not read as the policy.
      const accountA = await prisma.reefClubAccount.create({
        data: {
          email: email("ajanlas-a"),
          consentVersion: "proba",
          consentAt: new Date(),
        },
      });
      const accountB = await prisma.reefClubAccount.create({
        data: {
          email: email("ajanlas-b"),
          consentVersion: "proba",
          consentAt: new Date(),
        },
      });
      const ownA = await prisma.aquarium.create({
        data: {
          aquariumNumber: `RCS-${suffix}-AJ`,
          ownerAccountId: accountA.id,
          ownershipType: "CUSTOMER",
          name: `${NAME_PREFIX} ajánlás saját`,
        },
      });
      await prisma.reefClubCustomerLink.create({
        data: { accountId: accountA.id, customerId, status: "ACTIVE" },
      });

      const write = (sql: string, ...values: unknown[]) =>
        asRole.$executeRawUnsafe(sql, ...values).then(
          (count) => count,
          (error: unknown) =>
            /row-level security/i.test(String(error))
              ? "SORSZINTŰ TILTÁS"
              : /permission denied/i.test(String(error))
                ? "OSZLOP/TÁBLA TILTÁS"
                : String(error),
        );
      const recommendationSql =
        'INSERT INTO "ReefClubRecommendation" ("id", "aquariumId", "accountId", "parameterCode", "direction", "frameVersion", "input", "basisMeasuredAt", "doseEffectVersion", "productName", "amount", "doseUnit", "durationDays", "effectHours", "source", "text", "templateId", "reservedChanges", "status", "effectEndsAt") VALUES ($1, $2, $3, \'KH\', \'EMEL\', \'keret-proba\', \'{}\'::jsonb, now(), 1, \'Minta\', 8, \'ML\', 1, 12, \'forrás\', \'mondat\', \'dose-v1\', \'[]\'::jsonb, $4::"ReefClubRecommendationStatus", now() + interval \'12 hours\')';
      const doseSql =
        'INSERT INTO "ReefClubAdministeredDose" ("id", "aquariumId", "accountId", "parameterCode", "recommendationId", "amount", "doseUnit", "administeredAt", "clientOperationId") VALUES ($1, $2, $3, \'KH\', $4, 4, \'ML\', now(), $5)';
      const id = (name: string) => `szerep-aj-${name}-${suffix}`;
      const result: Record<string, unknown> = {
        "kontroll: ajánlás a saját akváriumra": await write(
          recommendationSql,
          id("r1"),
          ownA.id,
          accountA.id,
          "OPEN",
        ),
        "ajánlás a saját akváriumra másik fiók nevén": await write(
          recommendationSql,
          id("r2"),
          ownA.id,
          accountB.id,
          "OPEN",
        ),
        "ajánlás a bolti akváriumra összekötés nélkül": await write(
          recommendationSql,
          id("r3"),
          shopAquariumId,
          accountB.id,
          "OPEN",
        ),
        "kontroll: ajánlás a bolti akváriumra aktív összekötéssel": await write(
          recommendationSql,
          id("r4"),
          shopAquariumId,
          accountA.id,
          "OPEN",
        ),
        "ajánlás már megválaszoltként felvéve": await write(
          recommendationSql,
          id("r5"),
          ownA.id,
          accountA.id,
          "GIVEN",
        ),
        "GIVEN visszajelzés a beadott adag sora nélkül": await write(
          'UPDATE "ReefClubRecommendation" SET "status" = \'GIVEN\', "feedbackAt" = now() WHERE "id" = $1',
          id("r1"),
        ),
        "kontroll: beadott adag a saját akváriumra a saját ajánlással":
          await write(
            doseSql,
            id("d1"),
            ownA.id,
            accountA.id,
            id("r1"),
            id("o1"),
          ),
        "kontroll: GIVEN visszajelzés a beadott adag sorával": await write(
          'UPDATE "ReefClubRecommendation" SET "status" = \'GIVEN\', "feedbackAt" = now() WHERE "id" = $1',
          id("r1"),
        ),
        "megválaszolt ajánlás újraválaszolása": await write(
          'UPDATE "ReefClubRecommendation" SET "status" = \'NOT_GIVEN\', "feedbackAt" = now() WHERE "id" = $1',
          id("r1"),
        ),
        "kontroll: másik nyitott ajánlás": await write(
          recommendationSql,
          id("r6"),
          ownA.id,
          accountA.id,
          "OPEN",
        ),
        "kontroll: NOT_GIVEN visszajelzés adag nélkül": await write(
          'UPDATE "ReefClubRecommendation" SET "status" = \'NOT_GIVEN\', "feedbackAt" = now() WHERE "id" = $1',
          id("r6"),
        ),
        "harmadik nyitott ajánlás": await write(
          recommendationSql,
          id("r7"),
          ownA.id,
          accountA.id,
          "OPEN",
        ),
        "PARTIAL visszajelzés a beadott adag sora nélkül": await write(
          'UPDATE "ReefClubRecommendation" SET "status" = \'PARTIAL\', "feedbackAt" = now() WHERE "id" = $1',
          id("r7"),
        ),
        "GIVEN visszajelzés másik ajánlás adag-sorával": await write(
          'UPDATE "ReefClubRecommendation" SET "status" = \'GIVEN\', "feedbackAt" = now() WHERE "id" = $1',
          id("r7"),
        ),
        "az ajánlott mennyiség átírása": await write(
          'UPDATE "ReefClubRecommendation" SET "amount" = 1 WHERE "id" = $1',
          id("r4"),
        ),
        "ajánlás törlése": await write(
          'DELETE FROM "ReefClubRecommendation" WHERE "id" = $1',
          id("r4"),
        ),
        "beadott adag a bolti akváriumra összekötés nélkül": await write(
          doseSql,
          id("d2"),
          shopAquariumId,
          accountB.id,
          null,
          id("o2"),
        ),
        "beadott adag másik akvárium ajánlásával": await write(
          doseSql,
          id("d3"),
          ownA.id,
          accountA.id,
          id("r4"),
          id("o3"),
        ),
        "kontroll: beadott adag ajánlás nélkül": await write(
          doseSql,
          id("d4"),
          ownA.id,
          accountA.id,
          null,
          id("o4"),
        ),
        "beadott adag átírása": await write(
          'UPDATE "ReefClubAdministeredDose" SET "amount" = 99 WHERE "id" = $1',
          id("d1"),
        ),
        "beadott adag törlése": await write(
          'DELETE FROM "ReefClubAdministeredDose" WHERE "id" = $1',
          id("d1"),
        ),
      };
      assert.deepEqual(result, {
        "kontroll: ajánlás a saját akváriumra": 1,
        "ajánlás a saját akváriumra másik fiók nevén": "SORSZINTŰ TILTÁS",
        "ajánlás a bolti akváriumra összekötés nélkül": "SORSZINTŰ TILTÁS",
        "kontroll: ajánlás a bolti akváriumra aktív összekötéssel": 1,
        "ajánlás már megválaszoltként felvéve": "SORSZINTŰ TILTÁS",
        "GIVEN visszajelzés a beadott adag sora nélkül": "SORSZINTŰ TILTÁS",
        "kontroll: beadott adag a saját akváriumra a saját ajánlással": 1,
        "kontroll: GIVEN visszajelzés a beadott adag sorával": 1,
        "megválaszolt ajánlás újraválaszolása": 0,
        "kontroll: másik nyitott ajánlás": 1,
        "kontroll: NOT_GIVEN visszajelzés adag nélkül": 1,
        "harmadik nyitott ajánlás": 1,
        "PARTIAL visszajelzés a beadott adag sora nélkül": "SORSZINTŰ TILTÁS",
        "GIVEN visszajelzés másik ajánlás adag-sorával": "SORSZINTŰ TILTÁS",
        "az ajánlott mennyiség átírása": "OSZLOP/TÁBLA TILTÁS",
        "ajánlás törlése": "OSZLOP/TÁBLA TILTÁS",
        "beadott adag a bolti akváriumra összekötés nélkül": "SORSZINTŰ TILTÁS",
        "beadott adag másik akvárium ajánlásával": "SORSZINTŰ TILTÁS",
        "kontroll: beadott adag ajánlás nélkül": 1,
        "beadott adag átírása": "OSZLOP/TÁBLA TILTÁS",
        "beadott adag törlése": "OSZLOP/TÁBLA TILTÁS",
      });

      // On the owner connection: the answered one stayed GIVEN, the amount is untouched.
      const answered = await prisma.reefClubRecommendation.findUniqueOrThrow({
        where: { id: id("r1") },
        select: { status: true, amount: true },
      });
      assert.equal(answered.status, "GIVEN");
      assert.equal(answered.amount.toNumber(), 8);
    });

    it("a szereppel a termék-adag lista vetítése csak olvasható, semmilyen írás nem megy (8. szelet, (B) út)", async () => {
      // The owner connection makes one run and one row; the role may read them and change nothing.
      // A refused statement is a permission error (no INSERT, UPDATE or DELETE grant at all), and
      // the control is a read of the same table that must succeed, so a missing table would not
      // read as the grant.
      const run = await prisma.reefClubDoseProjectionRun.create({
        data: {
          status: "SUCCEEDED",
          trigger: "STARTUP",
          startedAt: new Date(),
          finishedAt: new Date(),
          rowCount: 1,
        },
      });
      const row = await prisma.reefClubDoseRow.create({
        data: {
          runId: run.id,
          sourceId: `szerep-vet-${suffix}`,
          sourceVersion: 1,
          productId: `szerep-vet-p-${suffix}`,
          productName: `${NAME_PREFIX} vetített`,
          parameterCode: "KH",
          direction: "EMEL",
          effectPer100L: 0.25,
          doseUnit: "ML",
          doseStep: 1,
          source: "próba",
          refusals: [],
        },
      });
      const outcome = (sql: string, ...values: unknown[]) =>
        asRole.$executeRawUnsafe(sql, ...values).then(
          (count) => count,
          (error: unknown) =>
            /permission denied/i.test(String(error))
              ? "TILTOTT"
              : String(error),
        );
      try {
        const result: Record<string, unknown> = {
          "kontroll: olvasás": (
            await asRole.$queryRawUnsafe<unknown[]>(
              'SELECT 1 FROM "ReefClubDoseRow" WHERE "id" = $1',
              row.id,
            )
          ).length,
          "sor beszúrása": await outcome(
            'INSERT INTO "ReefClubDoseRow" ("id", "runId", "sourceId", "sourceVersion", "productId", "productName", "parameterCode", "direction", "effectPer100L", "doseUnit", "doseStep", "source", "refusals") VALUES ($1, $2, $3, 1, \'p\', \'n\', \'KH\', \'EMEL\', 1, \'ML\', 1, \'s\', \'{}\')',
            `szerep-vet2-${suffix}`,
            run.id,
            `szerep-vet2-${suffix}`,
          ),
          "sor átírása": await outcome(
            'UPDATE "ReefClubDoseRow" SET "effectPer100L" = 999 WHERE "id" = $1',
            row.id,
          ),
          "sor törlése": await outcome(
            'DELETE FROM "ReefClubDoseRow" WHERE "id" = $1',
            row.id,
          ),
          "futási rekord beszúrása": await outcome(
            'INSERT INTO "ReefClubDoseProjectionRun" ("id", "status", "trigger", "startedAt", "finishedAt") VALUES ($1, \'SUCCEEDED\', \'EDIT\', now(), now())',
            `szerep-vet3-${suffix}`,
          ),
          "futási rekord átírása": await outcome(
            'UPDATE "ReefClubDoseProjectionRun" SET "finishedAt" = now() WHERE "id" = $1',
            run.id,
          ),
          "futási rekord törlése": await outcome(
            'DELETE FROM "ReefClubDoseProjectionRun" WHERE "id" = $1',
            run.id,
          ),
        };
        assert.deepEqual(result, {
          "kontroll: olvasás": 1,
          "sor beszúrása": "TILTOTT",
          "sor átírása": "TILTOTT",
          "sor törlése": "TILTOTT",
          "futási rekord beszúrása": "TILTOTT",
          "futási rekord átírása": "TILTOTT",
          "futási rekord törlése": "TILTOTT",
        });
        const intact = await prisma.reefClubDoseRow.findUniqueOrThrow({
          where: { id: row.id },
        });
        assert.equal(intact.effectPer100L.toNumber(), 0.25);
      } finally {
        await prisma.reefClubDoseProjectionRun.deleteMany({
          where: { id: run.id },
        });
      }
    });
  },
);
