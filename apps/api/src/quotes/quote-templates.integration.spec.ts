import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { prisma } from "@acropora/database";
import {
  PERMISSIONS,
  type AuthenticatedUser,
  type Permission,
} from "@acropora/types";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { configureApp } from "../app.configuration.js";
import { PermissionGuard } from "../auth/guards/permission.guard.js";
import { QuotesModule } from "./quotes.module.js";

const gate = integrationDatabaseGate(process.env);

@Module({
  imports: [QuotesModule],
  providers: [{ provide: APP_GUARD, useClass: PermissionGuard }],
})
class TestQuotesModule {}

const MANAGER: Permission[] = [
  PERMISSIONS.QUOTES_VIEW,
  PERMISSIONS.QUOTES_MANAGE,
  PERMISSIONS.QUOTES_TEMPLATES_MANAGE,
];
const WRITER: Permission[] = [
  PERMISSIONS.QUOTES_VIEW,
  PERMISSIONS.QUOTES_MANAGE,
];

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const paragraph = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describe(
  "Quote templates: the manager's endpoints",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = randomUUID();
    const templateIds: string[] = [];
    const quoteIds: string[] = [];
    let app: INestApplication, url: string, actorId: string;
    let perms: Permission[] = MANAGER;

    const request = async (
      path: string,
      method = "GET",
      body?: unknown,
      as: Permission[] = MANAGER,
    ) => {
      perms = as;
      const res = await fetch(url + path, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      perms = MANAGER;
      const text = await res.text();
      return {
        status: res.status,
        body: text ? (JSON.parse(text) as Json) : null,
      };
    };

    const valid = (name: string) => ({
      name: `${name} ${suffix}`,
      priceDisplay: "GROSS",
      defaultValidityDays: 30,
      blocks: [
        { kind: "TEXT", title: "Bevezető", content: paragraph("Köszönjük!") },
        { kind: "SECTION", title: "Akvárium és bútor" },
        { kind: "SUMMARY", title: "Összesítés" },
      ],
      milestones: [
        { label: "Előleg", percent: "40" },
        { label: "Telepítés", percent: "40" },
        { label: "Átadás", percent: "20" },
      ],
    });

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      actorId = (
        await prisma.user.create({
          data: {
            email: `quote-tpl-${suffix}@example.test`,
            displayName: "Quote template test",
            role: "ADMIN",
          },
        })
      ).id;
      app = await NestFactory.create(TestQuotesModule, { logger: false });
      app.use(
        (req: { user: AuthenticatedUser }, _res: unknown, next: () => void) => {
          req.user = {
            id: actorId,
            email: `quote-tpl-${suffix}@example.test`,
            displayName: "Quote template test",
            role: "ADMIN",
            customerId: null,
            supplierId: null,
            permissions: perms,
          };
          next();
        },
      );
      configureApp(app);
      await app.listen(0, "127.0.0.1");
      url = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    });

    it("a manager creates, edits and archives; the picker sees only the active ones", async () => {
      const created = await request(
        "/quote-templates",
        "POST",
        valid("Sablon"),
      );
      assert.equal(created.status, 201);
      const id = created.body!.id as string;
      templateIds.push(id);
      assert.deepEqual(
        created.body!.blocks.map((b: Json) => b.title),
        ["Bevezető", "Akvárium és bútor", "Összesítés"],
      );
      assert.deepEqual(
        created.body!.milestones.map((m: Json) => m.percent),
        ["40", "40", "20"],
      );

      // only the schedule changes: the stored blocks must stay as they are
      const patched = await request(`/quote-templates/${id}`, "PATCH", {
        defaultValidityDays: 45,
        milestones: [
          { label: "Előleg", percent: "50" },
          { label: "Átadás", percent: "50" },
        ],
      });
      assert.equal(patched.status, 200);
      assert.equal(patched.body!.defaultValidityDays, 45);
      assert.equal(patched.body!.milestones.length, 2);
      assert.equal(patched.body!.blocks.length, 3, "PATCH-KEEPS-BLOCKS");

      // a quote writer reads the list (the picker), and sees this one
      const picker = await request(
        "/quote-templates",
        "GET",
        undefined,
        WRITER,
      );
      assert.ok(picker.body!.some((t: Json) => t.id === id));

      const archived = await request(`/quote-templates/${id}/archive`, "POST");
      assert.equal(archived.status, 200);
      assert.ok(archived.body!.archivedAt);
      const after = await request("/quote-templates", "GET", undefined, WRITER);
      assert.ok(!after.body!.some((t: Json) => t.id === id), "ARCHIVED-HIDDEN");
      const all = await request("/quote-templates?includeArchived=true");
      assert.ok(all.body!.some((t: Json) => t.id === id));
      const late = await request(`/quote-templates/${id}`, "PATCH", {
        name: "Késő",
      });
      assert.equal(late.status, 409);
    });

    it("a quote writer without quotes.templates.manage cannot write", async () => {
      const res = await request(
        "/quote-templates",
        "POST",
        valid("Tiltott"),
        WRITER,
      );
      assert.equal(res.status, 403, "WRITE-403");
    });

    it("the editor's rules hold: a text block without text, an image, a bad schedule are 400s", async () => {
      const noText = valid("Szöveg nélkül");
      noText.blocks = [{ kind: "TERMS", title: "Feltételek" } as never];
      assert.equal(
        (await request("/quote-templates", "POST", noText)).status,
        400,
        "TEXT-REQUIRED-400",
      );
      const image = valid("Kép");
      image.blocks = [{ kind: "IMAGE", title: "Kép" } as never];
      assert.equal(
        (await request("/quote-templates", "POST", image)).status,
        400,
      );
      const schedule = valid("Rossz ütemezés");
      schedule.milestones = [{ label: "Egy", percent: "60" }];
      assert.equal(
        (await request("/quote-templates", "POST", schedule)).status,
        400,
        "SCHEDULE-400",
      );
    });

    it("a saved template starts a new quote with its blocks and schedule", async () => {
      const created = await request(
        "/quote-templates",
        "POST",
        valid("Indító"),
      );
      templateIds.push(created.body!.id);
      const quote = await request(
        "/quotes",
        "POST",
        {
          title: `Sablonból ${suffix}`,
          validUntil: "2099-12-31",
          templateId: created.body!.id,
        },
        WRITER,
      );
      assert.equal(quote.status, 201, "TEMPLATE-STARTS-QUOTE");
      const blocks = await prisma.quoteBlock.findMany({
        where: { versionId: quote.body!.latestVersion.id },
        orderBy: { position: "asc" },
      });
      assert.deepEqual(
        blocks.map((b) => b.title),
        ["Bevezető", "Akvárium és bútor", "Összesítés"],
      );
      quoteIds.push(quote.body!.id);
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await app?.close();
      const versions = (
        await prisma.quoteVersion.findMany({
          where: { quoteId: { in: quoteIds } },
          select: { id: true },
        })
      ).map((v) => v.id);
      await prisma.quoteEvent.deleteMany({
        where: { quoteId: { in: quoteIds } },
      });
      await prisma.quotePaymentMilestone.deleteMany({
        where: { versionId: { in: versions } },
      });
      await prisma.quoteBlock.deleteMany({
        where: { versionId: { in: versions } },
      });
      await prisma.quoteVersion.deleteMany({
        where: { quoteId: { in: quoteIds } },
      });
      await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
      await prisma.quoteTemplate.deleteMany({
        where: { name: { endsWith: suffix } },
      });
      if (actorId) {
        await prisma.auditLog.deleteMany({ where: { userId: actorId } });
        await prisma.user.deleteMany({ where: { id: actorId } });
      }
      await prisma.$disconnect();
    });
  },
);
