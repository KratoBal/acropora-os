import "reflect-metadata";

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../app.module.js";
import { configureApp } from "../app.configuration.js";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { hashPassword } from "../users/password.util.js";

/**
 * CONTENT AND THE MANUFACTURER CLAIMS IT STANDS ON (T5.3, points 3-4), through the OS API.
 *
 *   - an item names its claims before approval; after approval the set is fixed;
 *   - approval is refused while a named claim may not go out, and goes once it is checked;
 *   - a disputed claim sends the approved item back to approval, with a state-log row; a scheduled
 *     item is not moved (it stands on Facebook), it gets a comment;
 *   - the claim's affected-content list shows both.
 *
 * Runs only on a database named for testing; see integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const EMAIL_DOMAIN = "tartalom-allitas.invalid";
const PREFIX = "TARTALOM-ALLITAS-PROBA ";
const PASSWORD = "tartalom allitas jelszo";

describe(
  "tartalom és gyártói állítás (T5.3, 3-4. pont)",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    let app: INestApplication;
    let base: string;
    const bearer: Record<string, string> = {};
    const userId: Record<string, string> = {};
    let product: string;
    let claimId: string;
    let draft: string;
    let scheduled: string;

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

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      for (const [name, role] of [
        ["a", "MANAGER"],
        ["b", "MANAGER"],
        ["o", "OWNER"],
        ["v", "VIEWER"],
      ] as const) {
        userId[name] = (
          await prisma.user.create({
            data: {
              email: email(name),
              displayName: `Tartalom-állítás ${name}`,
              role,
              isActive: true,
              passwordHash: await hashPassword(PASSWORD),
              passwordUpdatedAt: new Date(),
            },
          })
        ).id;
      }
      product = (
        await prisma.product.create({ data: { name: `${PREFIX}${suffix}` } })
      ).id;
      draft = (
        await prisma.contentItem.create({
          data: {
            title: `${PREFIX}vázlat ${suffix}`,
            channel: "FACEBOOK_POST",
            state: "AWAITING_APPROVAL",
          },
        })
      ).id;
      scheduled = (
        await prisma.contentItem.create({
          data: {
            title: `${PREFIX}ütemezett ${suffix}`,
            channel: "FACEBOOK_POST",
            state: "DRAFTING",
          },
        })
      ).id;

      app = await NestFactory.create(AppModule, { logger: false });
      configureApp(app);
      await app.listen(0, "127.0.0.1");
      base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
      for (const name of ["a", "b", "o", "v"]) {
        const response = await fetch(`${base}/auth/mobile/login/password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email(name), password: PASSWORD }),
        });
        assert.equal(response.status, 201, name);
        bearer[name] = ((await response.json()) as { token: string }).token;
      }
    });

    after(async () => {
      await app?.close();
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "ContentItem (a suite előtagja)",
          darab: await prisma.contentItem.count({
            where: { title: { startsWith: PREFIX } },
          }),
        },
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
      // The links, the state log and the comments go with the item; the claims with the product.
      await prisma.contentItem.deleteMany({
        where: { title: { startsWith: PREFIX } },
      });
      await prisma.product.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: EMAIL_DOMAIN } },
      });
    }

    it("kötés jóváhagyás előtt: a tétel látja az állítást, a néző nem köthet", async () => {
      const created = await call(
        "a",
        `/products/${product}/manufacturer-claims`,
        {
          method: "POST",
          body: {
            claimType: "EFFECT",
            claimText: "Növeli a korallok színintenzitását.",
            sourceKind: "MANUFACTURER_PAGE",
            sourceRef: "https://gyarto.example.invalid/termek",
            sourceReadOn: "2026-11-12",
          },
        },
      );
      assert.equal(created.status, 201, JSON.stringify(created.body));
      claimId = created.body.id;
      const viewer = await call("v", `/content/${draft}/claims`, {
        method: "POST",
        body: { claimId },
      });
      assert.equal(viewer.status, 403);
      for (const item of [draft, scheduled]) {
        const linked = await call("a", `/content/${item}/claims`, {
          method: "POST",
          body: { claimId },
        });
        assert.equal(linked.status, 201, JSON.stringify(linked.body));
        assert.equal(linked.body.items.length, 1);
      }
      const detail = await call("v", `/content/${draft}`);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.claims[0].output.mode, "DRAFT_ONLY");
    });

    it("jóváhagyás: ellenőrizetlen állítással elutasítva, ellenőrzés után megy", async () => {
      const refused = await call("o", `/content/${draft}/approve-move`, {
        method: "POST",
        body: { from: "AWAITING_APPROVAL", to: "READY_TO_SEND" },
      });
      assert.equal(refused.status, 409, JSON.stringify(refused.body));
      assert.match(refused.body.message, new RegExp(claimId));
      const checked = await call(
        "b",
        `/manufacturer-claims/${claimId}/status`,
        {
          method: "POST",
          body: { expectedVersion: 1, status: "MATCHES_MANUFACTURER" },
        },
      );
      assert.equal(checked.status, 201, JSON.stringify(checked.body));
      const approved = await call("o", `/content/${draft}/approve-move`, {
        method: "POST",
        body: { from: "AWAITING_APPROVAL", to: "READY_TO_SEND" },
      });
      assert.equal(approved.status, 201, JSON.stringify(approved.body));
    });

    it("jóváhagyott tételhez nem köthető és nem vehető le állítás", async () => {
      const unlink = await call("a", `/content/${draft}/claims/${claimId}`, {
        method: "DELETE",
      });
      assert.equal(unlink.status, 409);
    });

    it("vitatott állítás: a jóváhagyott tétel visszalép, az ütemezett csak jelzést kap", async () => {
      // The second item was approved and scheduled while the claim was checked.
      await prisma.contentItem.update({
        where: { id: scheduled },
        data: { state: "SCHEDULED" },
      });
      const disputed = await call(
        "o",
        `/manufacturer-claims/${claimId}/status`,
        { method: "POST", body: { expectedVersion: 1, status: "DISPUTED" } },
      );
      assert.equal(disputed.status, 201, JSON.stringify(disputed.body));

      const back = await prisma.contentItem.findUniqueOrThrow({
        where: { id: draft },
        select: { state: true },
      });
      assert.equal(back.state, "AWAITING_APPROVAL");
      const event = await prisma.contentStateEvent.findFirstOrThrow({
        where: { contentId: draft, toState: "AWAITING_APPROVAL" },
        orderBy: { createdAt: "desc" },
      });
      assert.equal(event.fromState, "READY_TO_SEND");
      assert.equal(event.actorUserId, userId.o);
      assert.match(event.note ?? "", /vitatott/);

      const still = await prisma.contentItem.findUniqueOrThrow({
        where: { id: scheduled },
        select: { state: true },
      });
      assert.equal(still.state, "SCHEDULED");
      const comment = await prisma.contentComment.findFirstOrThrow({
        where: { contentId: scheduled },
      });
      assert.match(comment.body, /Facebookon/);
    });

    it("az érintett tartalmak listája mindkét tételt mutatja, az állapotukkal", async () => {
      const affected = await call(
        "v",
        `/manufacturer-claims/${claimId}/content`,
      );
      assert.equal(affected.status, 200);
      assert.deepEqual(
        affected.body.items
          .map((item: { id: string; state: string }) => [item.id, item.state])
          .sort(),
        [
          [draft, "AWAITING_APPROVAL"],
          [scheduled, "SCHEDULED"],
        ].sort(),
      );
    });
  },
);
