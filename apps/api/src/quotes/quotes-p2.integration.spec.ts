import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Global, Module, type INestApplication } from "@nestjs/common";
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
import { MARKER_FILE } from "../service-assets/document-store/filesystem-document-store.js";
import { QUOTE_DOCUMENT_ENV } from "./quote-publish.service.js";
import { QuotesModule } from "./quotes.module.js";

const gate = integrationDatabaseGate(process.env);

/** The store's environment for this spec only; `process.env` is never written. */
const storeRoot = mkdtempSync(join(tmpdir(), "quote-store-"));
// the store writes only onto a mounted volume, which the marker file proves
writeFileSync(join(storeRoot, MARKER_FILE), "");
const storeEnv: NodeJS.ProcessEnv = { DOCUMENT_STORE_ROOT: storeRoot };

@Global()
@Module({
  providers: [{ provide: QUOTE_DOCUMENT_ENV, useValue: storeEnv }],
  exports: [QUOTE_DOCUMENT_ENV],
})
class TestStoreEnvModule {}

@Module({
  imports: [TestStoreEnvModule, QuotesModule],
  providers: [{ provide: APP_GUARD, useClass: PermissionGuard }],
})
class TestQuotesModule {}

const PUBLISHER: Permission[] = [
  PERMISSIONS.QUOTES_VIEW,
  PERMISSIONS.QUOTES_MANAGE,
  PERMISSIONS.QUOTES_PUBLISH,
];
const WRITER: Permission[] = [
  PERMISSIONS.QUOTES_VIEW,
  PERMISSIONS.QUOTES_MANAGE,
];
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Every file under a directory (the store writes one file per document). */
function files(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  } catch {
    return [];
  }
}

describe(
  "Quotes P2: publishing and the PDF over HTTP",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = randomUUID();
    const quoteIds: string[] = [];
    let app: INestApplication, url: string, actorId: string;
    let perms: Permission[] = PUBLISHER;

    const request = async (
      path: string,
      method = "GET",
      body?: unknown,
      as: Permission[] = PUBLISHER,
    ) => {
      perms = as;
      const res = await fetch(url + path, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      perms = PUBLISHER;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const json = res.headers.get("content-type")?.includes("json")
        ? (JSON.parse(Buffer.from(bytes).toString("utf8")) as Json)
        : null;
      return {
        status: res.status,
        body: json,
        bytes,
        type: res.headers.get("content-type"),
      };
    };

    /** A draft quote with one offered item, written straight to the database. */
    async function draftQuote(title: string, withItem = true) {
      const created = await request("/quotes", "POST", {
        title,
        validUntil: "2099-12-31",
      });
      assert.equal(created.status, 201);
      const quoteId = created.body!.id as string;
      quoteIds.push(quoteId);
      const versionId = created.body!.latestVersion.id as string;
      const block = await prisma.quoteBlock.create({
        data: { versionId, position: 0, kind: "SECTION", title: "Rendszer" },
      });
      if (withItem)
        await prisma.quoteItem.create({
          data: {
            versionId,
            blockId: block.id,
            position: 0,
            source: "STANDALONE",
            name: "Árvíztűrő tükörfúrógép",
            quantity: "1",
            unit: "db",
            unitNetPrice: "100000",
            vatRatePercent: "27",
            isOptional: false,
          },
        });
      return { quoteId, versionId, blockId: block.id };
    }

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      actorId = (
        await prisma.user.create({
          data: {
            email: `quote-p2-${suffix}@example.test`,
            displayName: "Quote P2 test",
            role: "ADMIN",
          },
        })
      ).id;
      app = await NestFactory.create(TestQuotesModule, { logger: false });
      app.use(
        (req: { user: AuthenticatedUser }, _res: unknown, next: () => void) => {
          req.user = {
            id: actorId,
            email: `quote-p2-${suffix}@example.test`,
            displayName: "Quote P2 test",
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

    it("without a configured store publishing refuses (503) and the draft stays", async () => {
      const { quoteId, versionId } = await draftQuote(`P2 store ${suffix}`);
      delete storeEnv.DOCUMENT_STORE_ROOT;
      try {
        const res = await request(
          `/quotes/${quoteId}/versions/${versionId}/publish`,
          "POST",
        );
        assert.equal(res.status, 503, "NO-STORE-503");
      } finally {
        storeEnv.DOCUMENT_STORE_ROOT = storeRoot;
      }
      const v = await prisma.quoteVersion.findUniqueOrThrow({
        where: { id: versionId },
      });
      assert.equal(v.status, "DRAFT");
    });

    it("publish needs quotes.publish, and an offered item", async () => {
      const { quoteId, versionId } = await draftQuote(
        `P2 rights ${suffix}`,
        false,
      );
      const denied = await request(
        `/quotes/${quoteId}/versions/${versionId}/publish`,
        "POST",
        undefined,
        WRITER,
      );
      assert.equal(denied.status, 403, "PUBLISH-403");
      const empty = await request(
        `/quotes/${quoteId}/versions/${versionId}/publish`,
        "POST",
      );
      assert.equal(empty.status, 400, "EMPTY-400");
    });

    it("a double click publishes one version with one file, and the PDF is the stored bytes", async () => {
      const { quoteId, versionId } = await draftQuote(`P2 publish ${suffix}`);
      const before = files(storeRoot).length;
      const [a, b] = await Promise.all([
        request(`/quotes/${quoteId}/versions/${versionId}/publish`, "POST"),
        request(`/quotes/${quoteId}/versions/${versionId}/publish`, "POST"),
      ]);
      assert.deepEqual([a.status, b.status], [200, 200]);
      const v = await prisma.quoteVersion.findUniqueOrThrow({
        where: { id: versionId },
      });
      assert.equal(v.status, "PUBLISHED");
      assert.equal(files(storeRoot).length, before + 1, "ONE-FILE");
      const pdf = await request(`/quotes/${quoteId}/versions/${versionId}/pdf`);
      assert.equal(pdf.status, 200);
      assert.equal(pdf.type, "application/pdf");
      assert.equal(sha(pdf.bytes), v.pdfSha256, "STORED-BYTES");
      assert.equal(
        await prisma.quoteEvent.count({
          where: { versionId, kind: "PUBLISHED" },
        }),
        1,
      );
    });

    it("editing and publishing v2 leaves v1's bytes and hash alone", async () => {
      const { quoteId, versionId } = await draftQuote(`P2 versions ${suffix}`);
      assert.equal(
        (
          await request(
            `/quotes/${quoteId}/versions/${versionId}/publish`,
            "POST",
          )
        ).status,
        200,
      );
      const v1 = await prisma.quoteVersion.findUniqueOrThrow({
        where: { id: versionId },
      });
      const v1Bytes = (
        await request(`/quotes/${quoteId}/versions/${versionId}/pdf`)
      ).bytes;

      const draft = await request(`/quotes/${quoteId}/versions`, "POST");
      assert.equal(draft.status, 201);
      const v2 = (draft.body!.versions as Json[]).find(
        (x) => x.status === "DRAFT",
      )!;
      const item = v2.blocks[0].items[0];
      assert.equal(
        (
          await request(
            `/quotes/${quoteId}/versions/${v2.id}/items/${item.id}`,
            "PATCH",
            { unitNetPrice: "250000" },
          )
        ).status,
        200,
      );
      assert.equal(
        (await request(`/quotes/${quoteId}/versions/${v2.id}/publish`, "POST"))
          .status,
        200,
      );

      const after1 = await prisma.quoteVersion.findUniqueOrThrow({
        where: { id: versionId },
      });
      assert.equal(after1.status, "SUPERSEDED");
      assert.equal(after1.pdfSha256, v1.pdfSha256, "V1-HASH");
      const again = (
        await request(`/quotes/${quoteId}/versions/${versionId}/pdf`)
      ).bytes;
      assert.equal(sha(again), sha(v1Bytes), "V1-BYTES");
      const after2 = await prisma.quoteVersion.findUniqueOrThrow({
        where: { id: v2.id },
      });
      assert.notEqual(after2.pdfSha256, v1.pdfSha256);
    });

    it("a draft's PDF is a live preview, not stored", async () => {
      const { quoteId, versionId } = await draftQuote(`P2 preview ${suffix}`);
      const before = files(storeRoot).length;
      const pdf = await request(`/quotes/${quoteId}/versions/${versionId}/pdf`);
      assert.equal(pdf.status, 200);
      assert.equal(pdf.type, "application/pdf");
      assert.equal(files(storeRoot).length, before);
    });

    after(async () => {
      if (gate.mode !== "run") return;
      if (app) await app.close();
      const versions = (
        await prisma.quoteVersion.findMany({
          where: { quoteId: { in: quoteIds } },
          select: { id: true },
        })
      ).map((x) => x.id);
      await prisma.quoteEvent.deleteMany({
        where: { quoteId: { in: quoteIds } },
      });
      await prisma.quoteBomItem.deleteMany({
        where: { versionId: { in: versions } },
      });
      await prisma.quotePaymentMilestone.deleteMany({
        where: { versionId: { in: versions } },
      });
      await prisma.quoteItem.deleteMany({
        where: { versionId: { in: versions } },
      });
      await prisma.quoteBlock.deleteMany({
        where: { versionId: { in: versions } },
      });
      await prisma.quoteVersion.updateMany({
        where: { quoteId: { in: quoteIds } },
        data: { createdFromVersionId: null },
      });
      await prisma.quoteVersion.deleteMany({
        where: { quoteId: { in: quoteIds } },
      });
      await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
      if (actorId) {
        await prisma.auditLog.deleteMany({ where: { userId: actorId } });
        await prisma.user.deleteMany({ where: { id: actorId } });
      }
      rmSync(storeRoot, { recursive: true, force: true });
      await prisma.$disconnect();
    });
  },
);
