import "reflect-metadata";

import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import {
  integrationDatabaseGate,
  integrationDatabaseUrl,
} from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import type { OutgoingMail } from "../notifications/mail/mail.port.js";
import { hashPassword } from "../users/password.util.js";
import {
  REEFCLUB_DELETION_GRACE_MS,
  ReefClubAccountDeletionService,
} from "./reefclub-account-deletion.service.js";
import { configureReefClubApp } from "./reefclub-app.configuration.js";
import { ReefClubAuthService } from "./reefclub-auth.service.js";
import { reefClubProviderConfigs } from "./reefclub-external-auth.service.js";
import { ReefClubAppModule } from "./reefclub.module.js";

/**
 * ACCOUNT DELETION (plan v6.1, 4.5 and 3.2; acceptance 7.9; slice 6).
 *
 *   - It needs a fresh sign-in: a wrong password, another person's Google
 *     token and a Google token older than ten minutes are refused, and
 *     nothing changes.
 *   - The request locks the account at once: the old session is a 401, a
 *     login, a password reset and a registration on the address go nowhere
 *     (no e-mail either), the shop links end, the shared aquariums are
 *     revoked (logged), and the request is logged.
 *   - The final deletion comes after 30 days, not before: the account, its
 *     own aquariums and its links go; the shop's customer, the shop aquarium
 *     and the log stay.
 *
 * Runs only on a database named for testing; see integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_EMAIL_DOMAIN = "reefclub-torles.invalid";
const NAME_PREFIX = "RC-torles-proba";
const PASSWORD = "reefclub torles jelszo";
const GOOGLE_CLIENT = "rc-torles-google";
const IDP = generateKeyPairSync("rsa", { modulusLength: 2048 });
const IDP_JWK = { ...IDP.publicKey.export({ format: "jwk" }), kid: "torles" };

function googleToken(subject: string, issuedSecondsAgo = 5): string {
  const now = Math.floor(Date.now() / 1000);
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const head = part({ alg: "RS256", kid: "torles" });
  const body = part({
    iss: "https://accounts.google.com",
    aud: GOOGLE_CLIENT,
    sub: subject,
    iat: now - issuedSecondsAgo,
    exp: now + 3600,
  });
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${head}.${body}`),
    IDP.privateKey,
  ).toString("base64url");
  return `${head}.${body}.${signature}`;
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

describe("ReefClub: fióktörlés", { skip: gate.mode === "skip" }, () => {
  const suffix = `${Date.now() % 1_000_000}`;
  const mails: OutgoingMail[] = [];
  const subject = `torles-google-${suffix}`;
  let reefclub: INestApplication;
  let base: string;
  let session: Session;
  let accountId: string;
  let ownId: string;
  let customerId: string;
  let shopId: string;
  let requestedAt: Date;

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

  async function login(address: string): Promise<Response> {
    return rc("/rc/v1/auth/login", {
      method: "POST",
      body: { email: address, password: PASSWORD },
    });
  }

  const deletion = () => reefclub.get(ReefClubAccountDeletionService);

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
    reefclub = await NestFactory.create(
      ReefClubAppModule.forRoot({
        databaseUrl: integrationDatabaseUrl(process.env),
        mailSender: {
          async send(mail) {
            mails.push(mail);
          },
        },
        identityKeys: async (_config, kid) =>
          kid === "torles" ? IDP_JWK : null,
        providerConfigs: reefClubProviderConfigs({
          REEFCLUB_GOOGLE_CLIENT_IDS: GOOGLE_CLIENT,
        }),
      }),
      { logger: false },
    );
    configureReefClubApp(reefclub);
    await reefclub.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(reefclub.getHttpServer().address() as AddressInfo).port}`;

    accountId = (
      await prisma.reefClubAccount.create({
        data: {
          email: email("a"),
          passwordHash: await hashPassword(PASSWORD),
          emailVerifiedAt: new Date(),
          consentVersion: "teszt-1",
          consentAt: new Date(),
          identities: { create: [{ provider: "GOOGLE", subject }] },
        },
      })
    ).id;
    // Someone else's Google account, for the refused confirmation.
    await prisma.reefClubAccount.create({
      data: {
        email: email("masik"),
        emailVerifiedAt: new Date(),
        consentVersion: "teszt-1",
        consentAt: new Date(),
        identities: {
          create: [{ provider: "GOOGLE", subject: `${subject}-masik` }],
        },
      },
    });
    const response = await login(email("a"));
    assert.equal(response.status, 204);
    const cookies = setCookies(response);
    session = {
      cookie: `rc_session=${cookies.rc_session}; rc_csrf=${cookies.rc_csrf}`,
      csrf: cookies.rc_csrf!,
    };

    ownId = (
      await prisma.aquarium.create({
        data: {
          aquariumNumber: `RCT-${suffix}-saját`,
          ownerAccountId: accountId,
          ownershipType: "CUSTOMER",
          name: `${NAME_PREFIX} saját`,
          sharedWithShopAt: new Date(),
          shareConsentVersion: "teszt",
          measurements: {
            create: [
              {
                parameterCode: "KH",
                value: 7,
                unit: "dKH",
                measuredAt: new Date("2026-07-01T08:00:00Z"),
                source: "REEFCLUB_MANUAL",
                recordedByAccountId: accountId,
              },
            ],
          },
        },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: {
          customerNumber: `RCT-${suffix}`,
          type: "PERSON",
          displayName: `${NAME_PREFIX} vevő`,
        },
      })
    ).id;
    shopId = (
      await prisma.aquarium.create({
        data: {
          aquariumNumber: `RCT-${suffix}-bolti`,
          customerId,
          ownershipType: "CUSTOMER",
          name: `${NAME_PREFIX} bolti`,
        },
      })
    ).id;
    await prisma.reefClubCustomerLink.create({
      data: { accountId, customerId },
    });
  });

  after(async () => {
    await reefclub?.close();
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
        nev: "ReefClubAccountDeletion (a suite fiókja)",
        darab: await prisma.reefClubAccountDeletion.count({
          where: { accountId: accountId ?? "-" },
        }),
      },
    ]);
  });

  async function removeLeftovers(): Promise<void> {
    if (accountId)
      await prisma.reefClubAccountDeletion.deleteMany({
        where: { accountId },
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

  async function deleteMe(body: unknown): Promise<number> {
    const response = await rc("/rc/v1/me", {
      method: "DELETE",
      body,
      session,
    });
    await response.body?.cancel().catch(() => undefined);
    return response.status;
  }

  it("friss belépés nélkül nincs törlés: rossz jelszó, másik Google-fiók, régi Google-token", async () => {
    assert.equal(
      await deleteMe({ method: "PASSWORD", password: "nem ez a jelszo" }),
      401,
    );
    assert.equal(
      await deleteMe({
        method: "GOOGLE",
        idToken: googleToken(`${subject}-masik`),
      }),
      401,
    );
    assert.equal(
      await deleteMe({
        method: "GOOGLE",
        idToken: googleToken(subject, 20 * 60),
      }),
      401,
    );
    const account = await prisma.reefClubAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    assert.equal(account.deletionRequestedAt, null);
    assert.equal((await rc("/rc/v1/me", { session })).status, 200);
  });

  it("a saját, friss Google-tokennel a törlés elfogad, és a fiók azonnal zárolt", async () => {
    const before = mails.length;
    assert.equal(
      await deleteMe({ method: "GOOGLE", idToken: googleToken(subject) }),
      202,
    );
    const account = await prisma.reefClubAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    assert.ok(account.deletionRequestedAt);
    requestedAt = account.deletionRequestedAt;

    assert.equal((await rc("/rc/v1/me", { session })).status, 401);
    assert.equal((await login(email("a"))).status, 401);
    await rc("/rc/v1/auth/password-reset", {
      method: "POST",
      body: { email: email("a") },
    });
    await rc("/rc/v1/auth/register", {
      method: "POST",
      body: {
        email: email("a"),
        password: "egy uj jelszo 2026",
        consentVersion: "teszt-1",
      },
    });
    await reefclub.get(ReefClubAuthService).settled();
    assert.equal(
      mails.slice(before).filter((m) => m.to.includes(email("a"))).length,
      0,
      "zárolt fiók címére nem mehet levél",
    );

    assert.equal(
      await prisma.reefClubSession.count({ where: { accountId } }),
      0,
    );
    const link = await prisma.reefClubCustomerLink.findFirstOrThrow({
      where: { accountId },
    });
    assert.equal(link.status, "ENDED");
    assert.equal(link.endedBy, "ACCOUNT");
    const own = await prisma.aquarium.findUniqueOrThrow({
      where: { id: ownId },
    });
    assert.equal(own.sharedWithShopAt, null);
    assert.equal(
      await prisma.aquariumShareEvent.count({
        where: { aquariumId: ownId, kind: "REVOKED", accountId },
      }),
      1,
    );
    const log = await prisma.reefClubAccountDeletion.findMany({
      where: { accountId },
    });
    assert.equal(log.length, 1);
    assert.equal(log[0]!.completedAt, null);
  });

  it("a végleges törlés 30 nap előtt nem fut, utána igen; a bolti nyilvántartás és a napló megmarad", async () => {
    const service = deletion();
    assert.equal(
      await service.sweep(
        new Date(requestedAt.getTime() + REEFCLUB_DELETION_GRACE_MS - 60_000),
      ),
      0,
    );
    assert.ok(
      await prisma.reefClubAccount.findUnique({ where: { id: accountId } }),
    );
    const when = new Date(
      requestedAt.getTime() + REEFCLUB_DELETION_GRACE_MS + 60_000,
    );
    assert.equal(await service.sweep(when), 1);
    assert.equal(
      await prisma.reefClubAccount.count({ where: { id: accountId } }),
      0,
    );
    assert.equal(await prisma.aquarium.count({ where: { id: ownId } }), 0);
    assert.equal(
      await prisma.aquariumMeasurement.count({ where: { aquariumId: ownId } }),
      0,
    );
    assert.equal(
      await prisma.reefClubCustomerLink.count({ where: { accountId } }),
      0,
    );
    assert.equal(await prisma.aquarium.count({ where: { id: shopId } }), 1);
    assert.equal(await prisma.customer.count({ where: { id: customerId } }), 1);
    const log = await prisma.reefClubAccountDeletion.findMany({
      where: { accountId },
    });
    assert.equal(log.length, 1);
    assert.equal(log[0]!.completedAt?.toISOString(), when.toISOString());
  });
});
