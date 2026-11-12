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
 * THE MANUFACTURER CLAIMS THROUGH THE OS API (T5.3, points 1-4).
 *
 *   - a claim is recorded with its source, unchecked; the recorder cannot check it, another
 *     colleague can, and only a person with content.approve can confirm it independently;
 *   - an edit of the claim is a new version and clears the check; a note edit keeps it;
 *   - every step is in the log with the full value;
 *   - a dosing claim on a product with a Product Knowledge dosing fact must stand on that fact,
 *     and a fact that changes since makes the claim unchecked for output;
 *   - a viewer reads and cannot write.
 *
 * Runs only on a database named for testing; see integrationDatabaseGate.
 */
const gate = integrationDatabaseGate(process.env);

const EMAIL_DOMAIN = "gyartoi-allitas.invalid";
const PREFIX = "GYARTOI-ALLITAS-PROBA ";
const PASSWORD = "gyartoi allitas jelszo";

describe("gyártói állítások (T5.3)", { skip: gate.mode === "skip" }, () => {
  const suffix = `${Date.now() % 1_000_000}`;
  let app: INestApplication;
  let base: string;
  const bearer: Record<string, string> = {};
  const userId: Record<string, string> = {};
  let product: string;
  let dosedProduct: string;
  let factId: string;
  let variantFactId: string;
  let claimId: string;

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

  const CLAIM = {
    claimType: "EFFECT",
    claimText: "Növeli a korallok színintenzitását.",
    sourceKind: "MANUFACTURER_PAGE",
    sourceRef: "https://gyarto.example.invalid/termek",
    sourceReadOn: "2026-11-12",
  };

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
            displayName: `Gyártói állítás ${name}`,
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
    dosedProduct = (
      await prisma.product.create({
        data: { name: `${PREFIX}adagolt ${suffix}` },
      })
    ).id;
    // An accepted Product Knowledge dosing fact on the second product.
    await prisma.productEnrichmentRun.create({
      data: {
        requestedById: userId.a!,
        status: "COMPLETED",
        productLimit: 1,
        requestLimit: 1,
        products: {
          create: {
            productId: dosedProduct,
            checkedAt: new Date(),
            sourceCount: 1,
            fieldCount: 1,
            fields: {
              create: [
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
    const result = await prisma.productEnrichmentFieldResult.findFirstOrThrow({
      where: { field: "dosing", check: { productId: dosedProduct } },
    });
    factId = (
      await prisma.productKnowledgeFact.create({
        data: {
          productId: dosedProduct,
          field: "dosing",
          value: "5 ml/100 L/day",
          status: "VERIFIED",
          fieldResultId: result.id,
          acceptedById: userId.o!,
          acceptedAt: new Date(),
          revision: 1,
        },
      })
    ).id;

    // A variant-level dosing fact on the same product: not what a claim may stand on.
    const variant = await prisma.productVariant.create({
      data: { productId: dosedProduct, sku: `GYA-${suffix}` },
    });
    variantFactId = (
      await prisma.productKnowledgeFact.create({
        data: {
          productId: dosedProduct,
          variantId: variant.id,
          scopeKey: variant.id,
          field: "dosing",
          value: "5 ml/100 L/day",
          status: "VERIFIED",
          fieldResultId: result.id,
          acceptedById: userId.o!,
          acceptedAt: new Date(),
          revision: 1,
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
    // The facts first: they hold the enrichment result and the accepting user (RESTRICT).
    await prisma.productKnowledgeFact.deleteMany({
      where: { product: { name: { startsWith: PREFIX } } },
    });
    await prisma.productEnrichmentRun.deleteMany({
      where: { requestedBy: { email: { endsWith: EMAIL_DOMAIN } } },
    });
    // The claims and their log go with the product.
    await prisma.product.deleteMany({
      where: { name: { startsWith: PREFIX } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: EMAIL_DOMAIN } },
    });
  }

  it("rögzítés: az állítás ellenőrizetlen, csak vázlatba mehet, a gyártó szerint jelöléssel", async () => {
    const created = await call(
      "a",
      `/products/${product}/manufacturer-claims`,
      { method: "POST", body: CLAIM },
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    claimId = created.body.id;
    assert.equal(created.body.status, "UNVERIFIED");
    assert.equal(created.body.version, 1);
    assert.equal(created.body.sourceReadOn, "2026-11-12");
    assert.equal(created.body.sourcePublishedOn, null);
    assert.equal(created.body.output.mode, "DRAFT_ONLY");
    assert.equal(created.body.output.attribution, "a gyártó szerint");
  });

  it("a felvivő nem ellenőrizheti, egy másik kolléga igen", async () => {
    const own = await call("a", `/manufacturer-claims/${claimId}/status`, {
      method: "POST",
      body: { expectedVersion: 1, status: "MATCHES_MANUFACTURER" },
    });
    assert.equal(own.status, 400);
    const other = await call("b", `/manufacturer-claims/${claimId}/status`, {
      method: "POST",
      body: { expectedVersion: 1, status: "MATCHES_MANUFACTURER" },
    });
    assert.equal(other.status, 201, JSON.stringify(other.body));
    assert.equal(other.body.status, "MATCHES_MANUFACTURER");
    assert.equal(other.body.verifiedBy.id, userId.b);
    assert.equal(other.body.output.mode, "PUBLISHABLE");
  });

  it("független megerősítés: jóváhagyási jog nélkül elutasítva, a tulajdonosnak megy", async () => {
    const manager = await call("b", `/manufacturer-claims/${claimId}/status`, {
      method: "POST",
      body: { expectedVersion: 1, status: "INDEPENDENTLY_CONFIRMED" },
    });
    assert.equal(manager.status, 400);
    const owner = await call("o", `/manufacturer-claims/${claimId}/status`, {
      method: "POST",
      body: { expectedVersion: 1, status: "INDEPENDENTLY_CONFIRMED" },
    });
    assert.equal(owner.status, 201, JSON.stringify(owner.body));
    assert.equal(owner.body.output.attribution, null);
  });

  it("a megjegyzés szerkesztése új változat, és megtartja az ellenőrzést", async () => {
    const edited = await call("b", `/manufacturer-claims/${claimId}`, {
      method: "PATCH",
      body: { expectedVersion: 1, note: "csak teszt kirakatra" },
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.version, 2);
    assert.equal(edited.body.status, "INDEPENDENTLY_CONFIRMED");
    assert.equal(edited.body.recordedBy.id, userId.a);
  });

  it("az állítás szerkesztése új változat, törli az ellenőrzést, és a szerkesztő lesz a rögzítő", async () => {
    const stale = await call("b", `/manufacturer-claims/${claimId}`, {
      method: "PATCH",
      body: { expectedVersion: 1, claimText: "Más szöveg." },
    });
    assert.equal(stale.status, 409);
    const edited = await call("b", `/manufacturer-claims/${claimId}`, {
      method: "PATCH",
      body: {
        expectedVersion: 2,
        claimText: "Növeli a színintenzitást.",
        sourcePublishedOn: "2026-03-01",
      },
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.version, 3);
    assert.equal(edited.body.status, "UNVERIFIED");
    assert.equal(edited.body.verifiedBy, null);
    assert.equal(edited.body.recordedBy.id, userId.b);
    assert.equal(edited.body.sourcePublishedOn, "2026-03-01");
  });

  it("a napló minden lépést tart, a teljes értékkel", async () => {
    const log = await call("v", `/manufacturer-claims/${claimId}/events`);
    assert.equal(log.status, 200);
    assert.deepEqual(
      log.body.items.map((e: { kind: string }) => e.kind),
      ["EDITED", "EDITED", "STATUS_CHANGED", "STATUS_CHANGED", "CREATED"],
    );
    const first = log.body.items.at(-1);
    assert.equal(first.snapshot.claimText, CLAIM.claimText);
    assert.equal(first.actorName, "Gyártói állítás a");
    assert.equal(
      log.body.items[0].snapshot.claimText,
      "Növeli a színintenzitást.",
    );
  });

  it("a néző olvas, de nem ír", async () => {
    const list = await call("v", `/products/${product}/manufacturer-claims`);
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 1);
    const write = await call("v", `/products/${product}/manufacturer-claims`, {
      method: "POST",
      body: CLAIM,
    });
    assert.equal(write.status, 403);
  });

  it("szám-érték mértékegység nélkül: elutasítva", async () => {
    const response = await call(
      "a",
      `/products/${product}/manufacturer-claims`,
      { method: "POST", body: { ...CLAIM, valueAmount: 5 } },
    );
    assert.equal(response.status, 400);
  });

  it("adagolás a Product Knowledge tény mellett: hivatkozás nélkül elutasítva, hivatkozással saját szám nélkül", async () => {
    const dosing = {
      ...CLAIM,
      claimType: "DOSING",
      claimText: "Napi 5 ml 100 literenként.",
    };
    const unlinked = await call(
      "a",
      `/products/${dosedProduct}/manufacturer-claims`,
      { method: "POST", body: dosing },
    );
    assert.equal(unlinked.status, 400);
    assert.match(unlinked.body.message, new RegExp(factId));
    const ownNumber = await call(
      "a",
      `/products/${dosedProduct}/manufacturer-claims`,
      {
        method: "POST",
        body: {
          ...dosing,
          knowledgeFactId: factId,
          valueAmount: 5,
          valueUnit: "ml",
        },
      },
    );
    assert.equal(ownNumber.status, 400);
    const variantLevel = await call(
      "a",
      `/products/${dosedProduct}/manufacturer-claims`,
      { method: "POST", body: { ...dosing, knowledgeFactId: variantFactId } },
    );
    assert.equal(variantLevel.status, 400);
    const linked = await call(
      "a",
      `/products/${dosedProduct}/manufacturer-claims`,
      { method: "POST", body: { ...dosing, knowledgeFactId: factId } },
    );
    assert.equal(linked.status, 201, JSON.stringify(linked.body));
    assert.equal(linked.body.knowledgeLink, "CURRENT");
    assert.equal(linked.body.knowledgeFact.value, "5 ml/100 L/day");
    const checked = await call(
      "b",
      `/manufacturer-claims/${linked.body.id}/status`,
      {
        method: "POST",
        body: { expectedVersion: 1, status: "MATCHES_MANUFACTURER" },
      },
    );
    assert.equal(checked.status, 201, JSON.stringify(checked.body));
    assert.equal(checked.body.output.mode, "PUBLISHABLE");

    // The fact moves: the claim counts as unchecked, and cannot be checked until re-linked.
    await prisma.productKnowledgeFact.update({
      where: { id: factId },
      data: { value: "10 ml/100 L/day", revision: 2 },
    });
    const after = await call(
      "v",
      `/products/${dosedProduct}/manufacturer-claims`,
    );
    const claim = after.body.items[0];
    assert.equal(claim.knowledgeLink, "CHANGED");
    assert.equal(claim.output.mode, "DRAFT_ONLY");
    assert.deepEqual(claim.output.reasons, ["KNOWLEDGE_FACT_CHANGED"]);
    const relinked = await call("a", `/manufacturer-claims/${claim.id}`, {
      method: "PATCH",
      body: { expectedVersion: 1, knowledgeFactId: factId },
    });
    assert.equal(relinked.status, 200, JSON.stringify(relinked.body));
    assert.equal(relinked.body.knowledgeLink, "CURRENT");
    assert.equal(relinked.body.knowledgeFactRevision, 2);
    assert.equal(relinked.body.status, "UNVERIFIED");
  });

  it("az ellenőrzésre váró sor: adagolás elöl", async () => {
    const queue = await call("v", `/manufacturer-claims?status=UNVERIFIED`);
    assert.equal(queue.status, 200);
    const ours = queue.body.items.filter((item: { productName: string }) =>
      item.productName.startsWith(PREFIX),
    );
    assert.deepEqual(
      ours.map((item: { claimType: string }) => item.claimType),
      ["DOSING", "EFFECT"],
    );
  });

  it("archiválás: kikerül a listából, a naplóba bekerül", async () => {
    const archived = await call("a", `/manufacturer-claims/${claimId}`, {
      method: "DELETE",
    });
    assert.equal(archived.status, 204);
    const list = await call("v", `/products/${product}/manufacturer-claims`);
    assert.equal(list.body.items.length, 0);
    const all = await call(
      "v",
      `/products/${product}/manufacturer-claims?includeArchived=true`,
    );
    assert.equal(all.body.items[0].output.mode, "BLOCKED");
    const log = await call("v", `/manufacturer-claims/${claimId}/events`);
    assert.equal(log.body.items[0].kind, "ARCHIVED");
  });
});
