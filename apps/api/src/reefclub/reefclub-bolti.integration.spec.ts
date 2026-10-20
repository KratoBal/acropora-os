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
import { AquariumMeasurementsService } from "../aquariums/aquarium-measurements.service.js";
import { AquariumReefClubService } from "../aquariums/aquarium-reefclub.service.js";
import {
  integrationDatabaseGate,
  integrationDatabaseUrl,
} from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import {
  MAIL_SENDER,
  type MailSender,
  type OutgoingMail,
} from "../notifications/mail/mail.port.js";
import { hashPassword } from "../users/password.util.js";
import { configureReefClubApp } from "./reefclub-app.configuration.js";
import { REEFCLUB_SHARE_CONSENT_VERSION } from "./reefclub-consent.js";
import { hashLinkCode, normalizeLinkCode } from "./reefclub-link-code.js";
import { ReefClubAppModule } from "./reefclub.module.js";

/**
 * THE SHOP HALF OF THE ACCEPTANCE PROBE (plan v6.1, 5.2 points 3, 5, 6 and 7;
 * slice 5), with the OS steps it depends on: the code the colleague issues,
 * the release of a shop occasion, and the two e-mails (the notice of a new
 * link to the customer, the release to the linked accounts).
 *
 *   3. A, linked to C, cannot write to C's aquarium: every write route is the
 *      same 404 bytes as a missing id, and nothing changes. Reading works.
 *   5. A's list is exactly the shop aquariums of C (origin SHOP); an
 *      unreleased occasion is not there, the released one is.
 *   6. After A ends the link, every route of C's aquarium is the 404, on the
 *      very next request; the same when the shop ends it.
 *   7. An expired, a used and a company customer's code make no link; the OS
 *      refuses to issue one for a company; after five wrong codes even a good
 *      one is refused, and no link is made.
 *
 * Both processes run for real; the internal mail sender is replaced on its
 * one instance, so the e-mails the production code builds are captured.
 * Rows are created and deleted, so it runs only on a database named for
 * testing; see integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const TEST_EMAIL_DOMAIN = "reefclub-bolti.invalid";
const NAME_PREFIX = "RC-bolti-proba";
const PASSWORD = "reefclub bolti jelszo";
const MISSING_ID = "rc-bolti-nincs-ilyen";
const OCCASION_RELEASED = "2026-04-01T08:00:00.000Z";
const OCCASION_PRIVATE = "2026-04-02T08:00:00.000Z";

interface Session {
  cookie: string;
  csrf: string;
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
  "ReefClub: bolti összekapcsolás, véglegesítés, az elfogadási próba 3, 5, 6, 7. pontja",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    const mails: OutgoingMail[] = [];
    /** While true, every internal send fails (the notice failure test). */
    let failMail = false;
    /** Runs inside a send, before it returns: what a crash there would leave. */
    let duringSend: ((mail: OutgoingMail) => Promise<void>) | null = null;
    let internal: INestApplication;
    let reefclub: INestApplication;
    let internalBase: string;
    let reefclubBase: string;
    let bearer: string;

    let sessionA: Session;
    let sessionB: Session;
    let customerC: string;
    let customerE: string;
    let customerNoMail: string;
    let c1: string;
    let c2: string;
    let linkA: string;

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
      assert.equal(response.status, 204, `ReefClub-belépés: ${name}`);
      const cookies = setCookies(response);
      return {
        cookie: `rc_session=${cookies.rc_session}; rc_csrf=${cookies.rc_csrf}`,
        csrf: cookies.rc_csrf!,
      };
    }

    async function customer(
      name: string,
      type: "PERSON" | "COMPANY",
      withMail = true,
    ): Promise<string> {
      const row = await prisma.customer.create({
        data: {
          customerNumber: `RCB-${suffix}-${name}`,
          type,
          displayName: `${NAME_PREFIX} ${name}`,
          email: withMail ? email(`vevo-${name}`) : null,
          phone: "+36 1 000 0000",
        },
      });
      return row.id;
    }

    async function shopAquarium(customerId: string, name: string) {
      const row = await prisma.aquarium.create({
        data: {
          aquariumNumber: `RCB-${suffix}-${name}`,
          customerId,
          ownershipType: "CUSTOMER",
          name: `${NAME_PREFIX} ${name}`,
          waterType: "TENGERI",
          notes: "belső jegyzet",
          maintainedByUs: true,
          targets: { create: [{ parameterCode: "KH", min: 7, max: 9 }] },
        },
      });
      return row.id;
    }

    async function issueCode(customerId: string): Promise<string> {
      const response = await os(
        `/aquariums/customers/${customerId}/reefclub-link-code`,
        { method: "POST", body: {} },
      );
      assert.equal(response.status, 201, await response.clone().text());
      return ((await response.json()) as { code: string }).code;
    }

    /** A code row written straight in the table, for the states the OS never hands out. */
    async function codeRow(
      customerId: string,
      code: string,
      expiresAt: Date,
    ): Promise<void> {
      await prisma.reefClubLinkCode.create({
        data: {
          customerId,
          codeHash: hashLinkCode(normalizeLinkCode(code)!),
          expiresAt,
        },
      });
    }

    async function redeem(session: Session, code: string): Promise<Response> {
      return rc("/rc/v1/shop-links", {
        method: "POST",
        body: { code },
        session,
      });
    }

    async function linkCount(accountEmail: string): Promise<number> {
      return prisma.reefClubCustomerLink.count({
        where: { account: { email: accountEmail }, status: "ACTIVE" },
      });
    }

    async function fingerprint(): Promise<string> {
      const ids = [c1, c2];
      const [aquariums, targets, measurements, releases] = await Promise.all([
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
        prisma.aquariumMeasurementRelease.findMany({
          where: { aquariumId: { in: ids } },
          orderBy: { id: "asc" },
        }),
      ]);
      assert.equal(aquariums.length, 2);
      return createHash("sha256")
        .update(JSON.stringify({ aquariums, targets, measurements, releases }))
        .digest("hex");
    }

    /** Every aquarium route of `id`, as the given session sees it. */
    async function aquariumRoutes(
      session: Session,
      id: string,
    ): Promise<Record<string, { status: number; body: string }>> {
      const calls: [string, string, unknown][] = [
        ["GET", `/rc/v1/aquariums/${id}`, undefined],
        ["GET", `/rc/v1/aquariums/${id}/targets`, undefined],
        ["GET", `/rc/v1/aquariums/${id}/measurements`, undefined],
        ["PATCH", `/rc/v1/aquariums/${id}`, { name: `${NAME_PREFIX} átírva` }],
        ["DELETE", `/rc/v1/aquariums/${id}`, undefined],
        [
          "PUT",
          `/rc/v1/aquariums/${id}/targets`,
          { targets: [{ parameterCode: "KH", min: 1, max: 2 }] },
        ],
        [
          "POST",
          `/rc/v1/aquariums/${id}/measurements`,
          {
            measuredAt: "2026-04-03T08:00:00.000Z",
            values: [{ parameterCode: "KH", value: 8 }],
          },
        ],
        [
          "DELETE",
          `/rc/v1/aquariums/${id}/measurements/${encodeURIComponent(OCCASION_RELEASED)}`,
          undefined,
        ],
        [
          "POST",
          `/rc/v1/aquariums/${id}/share`,
          { consentVersion: REEFCLUB_SHARE_CONSENT_VERSION },
        ],
        ["DELETE", `/rc/v1/aquariums/${id}/share`, undefined],
        ["GET", `/rc/v1/aquariums/${id}/share/preview`, undefined],
      ];
      const out: Record<string, { status: number; body: string }> = {};
      for (const [method, path, body] of calls) {
        const response = await rc(path, { method, body, session });
        out[`${method} ${path.replace(id, ":id")}`] = {
          status: response.status,
          body: await response.text(),
        };
      }
      return out;
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      await prisma.user.create({
        data: {
          email: email("belso"),
          displayName: "Bolti próba belső kolléga",
          role: "OWNER",
          isActive: true,
          passwordHash: await hashPassword(PASSWORD),
          passwordUpdatedAt: new Date(),
        },
      });

      internal = await NestFactory.create(AppModule, { logger: false });
      configureApp(internal);
      // The one sender instance every internal service holds: its `send` is
      // replaced, so the production code builds the mails and they land here.
      const sender = internal.get<MailSender>(MAIL_SENDER, { strict: false });
      sender.send = async (mail) => {
        if (failMail) throw new Error("teszt: a küldés elbukik");
        if (duringSend) await duringSend(mail);
        mails.push(mail);
      };
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
      customerC = await customer("C", "PERSON");
      customerE = await customer("E", "COMPANY");
      customerNoMail = await customer("N", "PERSON", false);
      c1 = await shopAquarium(customerC, "C1");
      c2 = await shopAquarium(customerC, "C2");
      for (const measuredAt of [OCCASION_RELEASED, OCCASION_PRIVATE])
        await prisma.aquariumMeasurement.create({
          data: {
            aquariumId: c1,
            parameterCode: "KH",
            value: 6,
            unit: "dKH",
            measuredAt: new Date(measuredAt),
            source: "bolt",
            notes: "belső megjegyzés a mérésről",
          },
        });
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
          nev: "Customer (a suite névelőtagja)",
          darab: await prisma.customer.count({
            where: { displayName: { startsWith: NAME_PREFIX } },
          }),
        },
        {
          nev: "Aquarium (a suite névelőtagja)",
          darab: await prisma.aquarium.count({
            where: { name: { startsWith: NAME_PREFIX } },
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
      // Links and codes go with the customer and the account; measurements,
      // targets and releases with the aquarium (all Cascade).
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

    it("5.2/7: az OS cég vevőnek és e-mail cím nélküli vevőnek nem ad ki kódot", async () => {
      for (const id of [customerE, customerNoMail]) {
        const response = await os(
          `/aquariums/customers/${id}/reefclub-link-code`,
          { method: "POST", body: {} },
        );
        assert.equal(response.status, 400, id);
      }
      assert.equal(
        await prisma.reefClubLinkCode.count({
          where: { customerId: { in: [customerE, customerNoMail] } },
        }),
        0,
      );
    });

    it("beváltás: A a kiadott kóddal összekapcsolódik C-vel, és a lista C két akváriumát SHOP jelöléssel adja", async () => {
      const code = await issueCode(customerC);
      assert.match(code, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
      // The user may type it in lower case and without the dash.
      const response = await redeem(
        sessionA,
        code.toLowerCase().replace("-", " "),
      );
      assert.equal(response.status, 201, await response.clone().text());
      const link = (await response.json()) as {
        id: string;
        customerName: string;
      };
      assert.deepEqual(Object.keys(link).sort(), [
        "createdAt",
        "customerName",
        "id",
      ]);
      assert.equal(link.customerName, `${NAME_PREFIX} C`);
      linkA = link.id;

      const list = await rc("/rc/v1/aquariums", { session: sessionA });
      const aquariums = (
        (await list.json()) as {
          aquariums: { id: string; origin: string }[];
        }
      ).aquariums;
      assert.deepEqual(
        aquariums.map((a) => `${a.id} ${a.origin}`).sort(),
        [`${c1} SHOP`, `${c2} SHOP`].sort(),
      );
      const bList = await rc("/rc/v1/aquariums", { session: sessionB });
      const bIds = (
        (await bList.json()) as { aquariums: { id: string }[] }
      ).aquariums.map((a) => a.id);
      assert.ok(!bIds.includes(c1) && !bIds.includes(c2));
    });

    it("értesítés: a vevő levelet kap az új összekapcsolásról, egyszer", async () => {
      const service = internal.get(AquariumReefClubService, { strict: false });
      const before = mails.length;
      assert.ok((await service.sweepLinkNotices()) >= 1);
      const notice = mails
        .slice(before)
        .find((m) => m.to.includes(email("vevo-C")));
      assert.ok(notice, "nem ment értesítés a vevőnek");
      assert.ok(
        notice.text.includes(email("a")),
        "a levél nem nevezi a fiókot",
      );
      const again = mails.length;
      await service.sweepLinkNotices();
      assert.equal(
        mails.slice(again).filter((m) => m.to.includes(email("vevo-C"))).length,
        0,
      );
    });

    /** A link written straight in the table, for an account made the same way. */
    async function rawLink(name: string): Promise<string> {
      const account = await prisma.reefClubAccount.create({
        data: {
          email: email(name),
          emailVerifiedAt: new Date(),
          consentVersion: "teszt-1",
          consentAt: new Date(),
        },
      });
      return (
        await prisma.reefClubCustomerLink.create({
          data: { accountId: account.id, customerId: customerC },
        })
      ).id;
    }

    it("értesítés: egy foglalt, de el nem küldött sor a foglalás lejárta után újra kimegy (#1725 review)", async () => {
      const service = internal.get(AquariumReefClubService, { strict: false });
      const id = await rawLink("lease");
      const claimed = new Date();
      // A process claimed it and stopped before sending.
      await prisma.reefClubCustomerLink.update({
        where: { id },
        data: { customerNoticeClaimedAt: claimed },
      });
      const toLease = () =>
        mails.filter((m) => m.text.includes(email("lease"))).length;
      // If the process stopped DURING the send, the row must not look sent:
      // read it at that moment.
      const markedDuringSend: (Date | null)[] = [];
      duringSend = async (mail) => {
        if (!mail.text.includes(email("lease"))) return;
        const current = await prisma.reefClubCustomerLink.findUniqueOrThrow({
          where: { id },
        });
        markedDuringSend.push(current.customerNoticeAt);
      };
      try {
        await service.sweepLinkNotices(new Date(claimed.getTime() + 60_000));
        assert.equal(toLease(), 0, "élő foglalás mellett nem mehet ki");
        await service.sweepLinkNotices(
          new Date(claimed.getTime() + 11 * 60_000),
        );
      } finally {
        duringSend = null;
      }
      assert.equal(toLease(), 1, "a lejárt foglalás után ki kell mennie");
      assert.deepEqual(
        markedDuringSend,
        [null],
        "küldés közben a sor már kiküldöttnek látszik: egy ott leálló folyamat után senki nem küldené el",
      );
      const row = await prisma.reefClubCustomerLink.findUniqueOrThrow({
        where: { id },
      });
      assert.ok(row.customerNoticeAt, "a sikeres küldés után jelölve");
    });

    it("értesítés: az ötödik sikertelen küldés után hibasor és noticeFailed, és nincs több próba (#1725 review)", async () => {
      const service = internal.get(AquariumReefClubService, { strict: false });
      const errors: string[] = [];
      const logger = (service as unknown as { logger: object }).logger;
      (service as unknown as { logger: object }).logger = {
        ...logger,
        error: (message: string) => errors.push(message),
        warn: () => undefined,
      };
      const id = await rawLink("hiba");
      failMail = true;
      try {
        for (let round = 0; round < 6; round++)
          await service.sweepLinkNotices();
      } finally {
        failMail = false;
        (service as unknown as { logger: object }).logger = logger;
      }
      const row = await prisma.reefClubCustomerLink.findUniqueOrThrow({
        where: { id },
      });
      assert.equal(row.customerNoticeAt, null);
      assert.equal(row.customerNoticeAttempts, 5, "a hatodik kör nem próbál");
      assert.equal(
        errors.filter((line) =>
          line.startsWith(`REEFCLUB_LINK_NOTICE_FAILED link=${id}`),
        ).length,
        1,
      );
      const links = await os(
        `/aquariums/customers/${customerC}/reefclub-links`,
      );
      const listed = (
        (await links.json()) as {
          links: { id: string; noticeFailed: boolean; noticeSentAt?: string }[];
        }
      ).links;
      assert.equal(listed.find((l) => l.id === id)?.noticeFailed, true);
      assert.ok(
        listed.some((l) => l.noticeSentAt && !l.noticeFailed),
        "a sikeres értesítésű sor noticeSentAt-et visz",
      );
    });

    it("5.2/5: a nem véglegesített alkalom nem látszik, a véglegesítés után igen, és A levelet kap", async () => {
      const listOccasions = async () => {
        const response = await rc(`/rc/v1/aquariums/${c1}/measurements`, {
          session: sessionA,
        });
        assert.equal(response.status, 200);
        return (
          (await response.json()) as {
            occasions: { id: string; source: string; values: object[] }[];
          }
        ).occasions;
      };
      assert.deepEqual(await listOccasions(), []);

      const before = mails.length;
      const release = await os(
        `/aquariums/${c1}/measurements/${encodeURIComponent(OCCASION_RELEASED)}/release`,
        { method: "POST" },
      );
      assert.equal(release.status, 201, await release.clone().text());
      const releasedAt = ((await release.json()) as { releasedAt: string })
        .releasedAt;
      await internal.get(AquariumMeasurementsService).settled();

      const occasions = await listOccasions();
      assert.deepEqual(
        occasions.map((o) => `${o.id} ${o.source}`),
        [`${OCCASION_RELEASED} SHOP`],
      );
      // No internal field in a shop occasion's value.
      assert.deepEqual(Object.keys(occasions[0]!.values[0]!).sort(), [
        "direction",
        "parameterCode",
        "status",
        "target",
        "trend",
        "unit",
        "value",
      ]);

      const sent = mails.slice(before);
      assert.equal(sent.filter((m) => m.to.includes(email("a"))).length, 1);
      assert.equal(sent.filter((m) => m.to.includes(email("b"))).length, 0);
      assert.ok(
        !sent.some((m) => /\b6\b|dKH/.test(m.text)),
        "a levélben mérési érték áll",
      );

      // Idempotent: the same release, no second mail.
      const second = await os(
        `/aquariums/${c1}/measurements/${encodeURIComponent(OCCASION_RELEASED)}/release`,
        { method: "POST" },
      );
      assert.equal(second.status, 201);
      assert.equal(
        ((await second.json()) as { releasedAt: string }).releasedAt,
        releasedAt,
      );
      await internal.get(AquariumMeasurementsService).settled();
      assert.equal(
        mails.slice(before).filter((m) => m.to.includes(email("a"))).length,
        1,
      );

      // The OS shows the mark, and does not delete a released occasion.
      const osList = await os(`/aquariums/${c1}/measurements`);
      const osOccasions = (
        (await osList.json()) as {
          occasions: { id: string; releasedAt?: string }[];
        }
      ).occasions;
      assert.equal(
        osOccasions.find((o) => o.id === OCCASION_RELEASED)?.releasedAt,
        releasedAt,
      );
      assert.equal(
        osOccasions.find((o) => o.id === OCCASION_PRIVATE)?.releasedAt,
        undefined,
      );
      const remove = await os(
        `/aquariums/${c1}/measurements/${encodeURIComponent(OCCASION_RELEASED)}`,
        { method: "DELETE" },
      );
      assert.equal(remove.status, 409);
    });

    it("5.2/3: A írása C akváriumára mindenhol a nem létező 404-e, változás nélkül; az olvasás megy", async () => {
      const before = await fingerprint();
      const missing = await aquariumRoutes(sessionA, MISSING_ID);
      const shop = await aquariumRoutes(sessionA, c1);
      const mismatches: string[] = [];
      for (const [route, got] of Object.entries(shop)) {
        // The preview is the owner's (WRITE): a shop aquarium has none.
        if (route.startsWith("GET ") && !route.includes("/share/")) {
          if (got.status !== 200)
            mismatches.push(`${route}: olvasás ${got.status}`);
          continue;
        }
        if (got.status !== 404 || got.body !== missing[route]!.body)
          mismatches.push(`${route}: ${got.status} ${got.body.slice(0, 100)}`);
      }
      assert.deepEqual(mismatches, []);
      assert.equal(await fingerprint(), before, "a sorok megváltoztak");
    });

    it("mezők: a bolti akvárium válaszában nincs belső mező", async () => {
      const response = await rc(`/rc/v1/aquariums/${c1}`, {
        session: sessionA,
      });
      const body = (await response.json()) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), [
        "createdAt",
        "id",
        "name",
        "origin",
        "sharedWithShopAt",
        "systemVolumeLiters",
        "waterBodyType",
        "waterType",
      ]);
      assert.equal(body.origin, "SHOP");
      assert.equal(body.sharedWithShopAt, null);
    });

    it("5.2/7: lejárt, felhasznált és cég vevőhöz írt kód nem köt össze", async () => {
      const before = await linkCount(email("b"));
      await codeRow(customerC, "LEJAR-TKDAA", new Date(Date.now() - 1000));
      await codeRow(customerE, "CEGVE-VKDAB", new Date(Date.now() + 3_600_000));
      const used = await issueCode(customerC);
      assert.equal((await redeem(sessionA, used)).status, 201);
      for (const code of ["LEJAR-TKDAA", "CEGVE-VKDAB", used]) {
        const response = await redeem(sessionB, code);
        assert.equal(response.status, 400, code);
      }
      assert.equal(await linkCount(email("b")), before);
    });

    it("5.2/7: öt hibás kód után a jó kód sem köt össze (fiókonkénti zár)", async () => {
      const locked = await login("zar");
      for (let index = 0; index < 5; index++)
        assert.equal(
          (await redeem(locked, `WRNGC-DAAA${index + 2}`)).status,
          400,
        );
      const good = await issueCode(customerC);
      assert.equal((await redeem(locked, good)).status, 429);
      assert.equal(await linkCount(email("zar")), 0);
    });

    it("5.2/6: A megszünteti az összekapcsolást, és a következő kérésre C minden útvonala 404", async () => {
      const foreign = await rc(`/rc/v1/shop-links/${linkA}`, {
        method: "DELETE",
        session: sessionB,
      });
      assert.equal(foreign.status, 404);

      const end = await rc(`/rc/v1/shop-links/${linkA}`, {
        method: "DELETE",
        session: sessionA,
      });
      assert.equal(end.status, 204);
      const missing = await aquariumRoutes(sessionA, MISSING_ID);
      const shop = await aquariumRoutes(sessionA, c1);
      const leaks = Object.entries(shop)
        .filter(
          ([route, got]) =>
            got.status !== 404 || got.body !== missing[route]!.body,
        )
        .map(([route, got]) => `${route}: ${got.status}`);
      assert.deepEqual(leaks, []);

      const links = await os(
        `/aquariums/customers/${customerC}/reefclub-links`,
      );
      const row = (
        (await links.json()) as {
          links: { id: string; status: string; endedBy?: string }[];
        }
      ).links.find((link) => link.id === linkA);
      assert.equal(row?.status, "ENDED");
      assert.equal(row?.endedBy, "ACCOUNT");
    });

    it("5.2/6: a bolt is megszüntetheti, és utána a fiók nem éri el", async () => {
      const code = await issueCode(customerC);
      const made = await redeem(sessionB, code);
      assert.equal(made.status, 201);
      const id = ((await made.json()) as { id: string }).id;
      assert.equal(
        (await rc(`/rc/v1/aquariums/${c1}`, { session: sessionB })).status,
        200,
      );
      const end = await os(
        `/aquariums/customers/${customerC}/reefclub-links/${id}`,
        { method: "DELETE" },
      );
      assert.equal(end.status, 204);
      assert.equal(
        (await rc(`/rc/v1/aquariums/${c1}`, { session: sessionB })).status,
        404,
      );
      assert.equal(await linkCount(email("b")), 0);
    });
  },
);
