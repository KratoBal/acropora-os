import "reflect-metadata";

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../app.module.js";
import { configureApp } from "../app.configuration.js";
import { hashSessionToken } from "../auth/session-token.util.js";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { CONTENT_AGENT_TOKEN_IDS_ENV } from "./content-agent.config.js";

/**
 * THE MACHINE AGENTS' ENTRY TO THE MANUFACTURER CLAIMS (T5.3), with real service tokens.
 *
 *   - an agent records a claim; it cannot check its own, another agent can, and no agent can
 *     confirm one independently;
 *   - an agent links claims to its own content item only; another author's item answers 404;
 *   - a token not on the list is refused.
 *
 * Runs only on a database named for testing; see integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const EMAIL_DOMAIN = "agens-allitas.invalid";
const PREFIX = "AGENS-ALLITAS-PROBA ";

describe(
  "gyártói állítások a gépi bejáraton (T5.3)",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    let app: INestApplication;
    let base: string;
    const raw: Record<string, string> = {};
    const userId: Record<string, string> = {};
    let product: string;
    let ownItem: string;
    let otherItem: string;
    let claimId: string;
    const previousIds = process.env[CONTENT_AGENT_TOKEN_IDS_ENV];

    async function call(
      who: string,
      path: string,
      init: { method?: string; body?: unknown } = {},
    ): Promise<{ status: number; body: any }> {
      const response = await fetch(`${base}${path}`, {
        method: init.method ?? "GET",
        headers: {
          authorization: `Bearer ${raw[who]}`,
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
      const listed: string[] = [];
      for (const name of ["korall", "masik", "listan-kivul"]) {
        userId[name] = (
          await prisma.user.create({
            data: {
              email: `${name}-${suffix}@${EMAIL_DOMAIN}`,
              displayName: `Ágens ${name}`,
              role: "CONTENT_AGENT",
              isActive: true,
            },
          })
        ).id;
        raw[name] = randomBytes(24).toString("hex");
        const token = await prisma.serviceToken.create({
          data: {
            name: `${PREFIX}${name}`,
            slug: `agens-allitas-${name}-${suffix}`,
            tokenHash: hashSessionToken(raw[name]!),
            userId: userId[name],
          },
        });
        if (name !== "listan-kivul") listed.push(token.id);
      }
      process.env[CONTENT_AGENT_TOKEN_IDS_ENV] = listed.join(",");
      product = (
        await prisma.product.create({ data: { name: `${PREFIX}${suffix}` } })
      ).id;
      ownItem = (
        await prisma.contentItem.create({
          data: {
            title: `${PREFIX}saját ${suffix}`,
            channel: "FACEBOOK_POST",
            state: "AWAITING_REVIEW",
            authorId: userId.korall,
          },
        })
      ).id;
      otherItem = (
        await prisma.contentItem.create({
          data: {
            title: `${PREFIX}másé ${suffix}`,
            channel: "FACEBOOK_POST",
            state: "AWAITING_REVIEW",
            authorId: userId.masik,
          },
        })
      ).id;

      app = await NestFactory.create(AppModule, { logger: false });
      configureApp(app);
      await app.listen(0, "127.0.0.1");
      base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    });

    after(async () => {
      await app?.close();
      if (previousIds === undefined)
        delete process.env[CONTENT_AGENT_TOKEN_IDS_ENV];
      else process.env[CONTENT_AGENT_TOKEN_IDS_ENV] = previousIds;
      await removeLeftovers();
      nincsMaradek([
        {
          nev: "ContentItem (a suite előtagja)",
          darab: await prisma.contentItem.count({
            where: { title: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "ServiceToken (a suite előtagja)",
          darab: await prisma.serviceToken.count({
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
      await prisma.contentItem.deleteMany({
        where: { title: { startsWith: PREFIX } },
      });
      await prisma.product.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.serviceToken.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: EMAIL_DOMAIN } },
      });
    }

    it("a listán kívüli token: elutasítva", async () => {
      const refused = await call("listan-kivul", `/content/agent-claims`);
      assert.equal(refused.status, 401);
    });

    it("az ágens felvisz egy állítást, ellenőrizetlenül, a saját nevén", async () => {
      const created = await call(
        "korall",
        `/content/agent-claims/products/${product}`,
        {
          method: "POST",
          body: {
            claimType: "SAFETY",
            claimText: "Halakra és gerinctelenekre ártalmatlan.",
            sourceKind: "LABEL",
            sourceRef: "https://gyarto.example.invalid/cimke.pdf",
            sourceReadOn: "2026-11-12",
          },
        },
      );
      assert.equal(created.status, 201, JSON.stringify(created.body));
      claimId = created.body.id;
      assert.equal(created.body.status, "UNVERIFIED");
      assert.equal(created.body.recordedBy.id, userId.korall);
      assert.equal(created.body.output.checkRequiredBeforeSend, true);
    });

    it("a saját állítását nem ellenőrizheti, egy másik ágens igen, független megerősítést egyik sem adhat", async () => {
      const own = await call(
        "korall",
        `/content/agent-claims/${claimId}/status`,
        {
          method: "POST",
          body: { expectedVersion: 1, status: "MATCHES_MANUFACTURER" },
        },
      );
      assert.equal(own.status, 400);
      const other = await call(
        "masik",
        `/content/agent-claims/${claimId}/status`,
        {
          method: "POST",
          body: { expectedVersion: 1, status: "MATCHES_MANUFACTURER" },
        },
      );
      assert.equal(other.status, 201, JSON.stringify(other.body));
      const confirm = await call(
        "masik",
        `/content/agent-claims/${claimId}/status`,
        {
          method: "POST",
          body: { expectedVersion: 1, status: "INDEPENDENTLY_CONFIRMED" },
        },
      );
      assert.equal(confirm.status, 400);
      assert.match(confirm.body.message, /csak ember adhat/);
    });

    it("a saját tételéhez köt, a máséhoz nem (404)", async () => {
      const linked = await call(
        "korall",
        `/content/agent-claims/content/${ownItem}`,
        { method: "POST", body: { claimId } },
      );
      assert.equal(linked.status, 201, JSON.stringify(linked.body));
      assert.equal(linked.body.items[0].id, claimId);
      const foreign = await call(
        "korall",
        `/content/agent-claims/content/${otherItem}`,
        { method: "POST", body: { claimId } },
      );
      assert.equal(foreign.status, 404);
      const unlinked = await call(
        "korall",
        `/content/agent-claims/content/${ownItem}/unlink`,
        { method: "POST", body: { claimId } },
      );
      assert.equal(unlinked.status, 201, JSON.stringify(unlinked.body));
      assert.deepEqual(unlinked.body.items, []);
    });
  },
);
