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
import { copyVersionContent } from "./quote-version-editor.js";

const gate = integrationDatabaseGate(process.env);

@Module({
  imports: [QuotesModule],
  providers: [{ provide: APP_GUARD, useClass: PermissionGuard }],
})
class TestQuotesModule {}

const WRITER: Permission[] = [
  PERMISSIONS.QUOTES_VIEW,
  PERMISSIONS.QUOTES_MANAGE,
];

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/*
  KIVÁLTOTT TÉTEL (Luca 2026-11-26, card 2540d9d4), PR 2: az opcionális tétel a (nem opcionális) tétel HELYÉRE léphet. Itt a szerkesztő szabályai,
  HTTP-n és az adatbázison át: mit enged, mit utasít el érthető üzenettel, és mi történik a kiváltott tétel törlésekor, az opcionális jelölés
  visszavételekor, a blokk törlésekor és az új verzió másolásakor. MI PIROSÍT: ha egy tiltott kiváltás átmegy, ha az elutasítás kulcshiba
  (500) marad érthető üzenet helyett, ha a törlés elakad a Restrict kulcson, ha az új verzió a RÉGI verzió tételére mutat.
*/
describe(
  "Quotes: an optional item stands in for a line (editor rules)",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = randomUUID();
    const quoteIds: string[] = [];
    let app: INestApplication, url: string;
    let actorId: string;
    let quoteId: string, versionId: string, blockId: string;

    const user = (): AuthenticatedUser => ({
      id: actorId,
      email: `quote-repl-${suffix}@example.test`,
      displayName: "Quote replaces test",
      role: "ADMIN",
      customerId: null,
      supplierId: null,
      permissions: WRITER,
    });
    const request = async (path: string, method = "GET", body?: unknown) => {
      const res = await fetch(url + path, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: (await res.json()) as Json };
    };
    const v = (path: string) =>
      `/quotes/${quoteId}/versions/${versionId}${path}`;
    const items = (dto: Json, id = versionId): Json[] =>
      (
        (dto.versions as Json[]).find((x) => x.id === id)!.blocks as Json[]
      ).flatMap((b) => b.items as Json[]);
    const byName = (dto: Json, name: string, id = versionId) =>
      items(dto, id).find((i) => i.name === name)!;
    const line = (name: string, over: Json = {}) => ({
      source: "STANDALONE",
      name,
      quantity: "1",
      unit: "db",
      unitNetPrice: "1000",
      vatRatePercent: "27",
      ...over,
    });
    const add = async (
      blockPath: string,
      name: string,
      over: Json = {},
      inVersion = versionId,
    ) => {
      const res = await request(blockPath + "/items", "POST", line(name, over));
      assert.equal(res.status, 201, `${name}: ${JSON.stringify(res.body)}`);
      return byName(res.body, name, inVersion).id as string;
    };
    const patch = (itemId: string, body: Json) =>
      request(v(`/items/${itemId}`), "PATCH", body);
    const detail = async () => (await request(`/quotes/${quoteId}`)).body;
    const replaces = async (itemId: string) =>
      items(await detail()).find((i) => i.id === itemId)!.replacesItemId;

    let a: string, b: string, o1: string, o2: string;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      actorId = (
        await prisma.user.create({
          data: {
            email: `quote-repl-${suffix}@example.test`,
            displayName: "Quote replaces test",
            role: "ADMIN",
          },
        })
      ).id;
      app = await NestFactory.create(TestQuotesModule, { logger: false });
      app.use(
        (req: { user: AuthenticatedUser }, _res: unknown, next: () => void) => {
          req.user = user();
          next();
        },
      );
      configureApp(app);
      await app.listen(0, "127.0.0.1");
      url = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
      const created = await request("/quotes", "POST", {
        title: "Replaces editor",
        validUntil: "2026-12-31",
      });
      assert.equal(created.status, 201);
      quoteId = created.body.id;
      quoteIds.push(quoteId);
      versionId = created.body.latestVersion.id;
      const block = await request(v("/blocks"), "POST", {
        kind: "SECTION",
        title: "Szűrés",
      });
      assert.equal(block.status, 201, JSON.stringify(block.body));
      blockId = (
        (block.body.versions as Json[]).find((x) => x.id === versionId)!
          .blocks as Json[]
      ).find((x) => x.title === "Szűrés")!.id;
      a = await add(v(`/blocks/${blockId}`), "A régi szűrő");
      b = await add(v(`/blocks/${blockId}`), "B tartó");
      o1 = await add(v(`/blocks/${blockId}`), "O1 új szűrő", {
        isOptional: true,
      });
      o2 = await add(v(`/blocks/${blockId}`), "O2 másik szűrő", {
        isOptional: true,
      });
    });

    it("an optional item is set to stand in for a line, and the clear removes it", async () => {
      const set = await patch(o1, { replacesItemId: a });
      assert.equal(set.status, 200, JSON.stringify(set.body));
      assert.equal(byName(set.body, "O1 új szűrő").replacesItemId, a);
      assert.equal(byName(set.body, "A régi szűrő").replacesItemId, null);
      const cleared = await patch(o1, { replacesItemId: null });
      assert.equal(cleared.status, 200);
      assert.equal(byName(cleared.body, "O1 új szűrő").replacesItemId, null);
    });

    it("an item can be created already standing in for a line", async () => {
      const created = await add(v(`/blocks/${blockId}`), "O3 azonnal", {
        isOptional: true,
        replacesItemId: b,
      });
      assert.equal(await replaces(created), b);
      const gone = await request(v(`/items/${created}`), "DELETE");
      assert.equal(gone.status, 200, JSON.stringify(gone.body));
    });

    it("the rules refuse with a message, never with a key error", async () => {
      // not optional: cannot stand in for anything
      let res = await patch(b, { replacesItemId: a });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.match(res.body.message as string, /opcionális/);
      // an optional line cannot be replaced
      res = await patch(o1, { replacesItemId: o2 });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      // not itself
      res = await patch(o1, { replacesItemId: o1 });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      // a line that is not in this version
      res = await patch(o1, { replacesItemId: "no-such-item" });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      // one replacer per line
      assert.equal((await patch(o1, { replacesItemId: a })).status, 200);
      res = await patch(o2, { replacesItemId: a });
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.match(res.body.message as string, /már kiváltja/);
      // the replaced line cannot become optional while something replaces it
      res = await patch(a, { isOptional: true });
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.match(res.body.message as string, /nem lehet opcionális/);
      assert.equal(await replaces(o1), a);
    });

    it("taking the optional mark back also ends the replacement", async () => {
      assert.equal(await replaces(o1), a);
      const res = await patch(o1, { isOptional: false });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(byName(res.body, "O1 új szűrő").replacesItemId, null);
      assert.equal(
        (await patch(o1, { isOptional: true, replacesItemId: a })).status,
        200,
      );
    });

    it("deleting the replaced line releases the replacement: the optional item becomes a supplement", async () => {
      const gone = await request(v(`/items/${a}`), "DELETE");
      assert.equal(gone.status, 200, JSON.stringify(gone.body));
      assert.equal(await replaces(o1), null);
      a = await add(v(`/blocks/${blockId}`), "A pótolt szűrő");
      assert.equal((await patch(o1, { replacesItemId: a })).status, 200);
    });

    it("deleting a block releases the replacements that point into it, and the ones inside it", async () => {
      const second = await request(v("/blocks"), "POST", {
        kind: "SECTION",
        title: "Második",
      });
      assert.equal(second.status, 201, JSON.stringify(second.body));
      const secondId = (
        (second.body.versions as Json[]).find((x) => x.id === versionId)!
          .blocks as Json[]
      ).find((x) => x.title === "Második")!.id as string;
      const c = await add(v(`/blocks/${secondId}`), "C a második blokkban");
      const d = await add(v(`/blocks/${secondId}`), "D szintén ott");
      const oc = await add(v(`/blocks/${secondId}`), "OC opcionális ott", {
        isOptional: true,
        replacesItemId: c,
      });
      // an optional line of the FIRST block replaces a line of the block that is deleted
      assert.equal((await patch(o2, { replacesItemId: d })).status, 200);
      const gone = await request(v(`/blocks/${secondId}`), "DELETE");
      assert.equal(gone.status, 200, JSON.stringify(gone.body));
      assert.equal(await replaces(o2), null);
      assert.equal(
        items(await detail()).some((i) => i.id === oc),
        false,
      );
    });

    it("the database keeps the same rules: only an optional line replaces, one replacer per line, same version", async () => {
      await assert.rejects(
        prisma.quoteItem.update({
          where: { id: b },
          data: { replacesItemId: a },
        }),
        "a non optional line cannot replace (CHECK)",
      );
      await assert.rejects(
        prisma.quoteItem.update({
          where: { id: o2 },
          data: { replacesItemId: a },
        }),
        "one replacer per line (unique)",
      );
      // a line of ANOTHER quote's version (its own throwaway quote)
      const otherQuote = await request("/quotes", "POST", {
        title: "Replaces other",
        validUntil: "2026-12-31",
      });
      assert.equal(otherQuote.status, 201);
      quoteIds.push(otherQuote.body.id);
      const otherVersion = otherQuote.body.latestVersion.id as string;
      const otherBlock = await request(
        `/quotes/${otherQuote.body.id}/versions/${otherVersion}/blocks`,
        "POST",
        { kind: "SECTION", title: "Más" },
      );
      assert.equal(otherBlock.status, 201, JSON.stringify(otherBlock.body));
      const otherBlockId = (
        (otherBlock.body.versions as Json[]).find((x) => x.id === otherVersion)!
          .blocks as Json[]
      ).find((x) => x.title === "Más")!.id as string;
      const other = await request(
        `/quotes/${otherQuote.body.id}/versions/${otherVersion}/blocks/${otherBlockId}/items`,
        "POST",
        line("Másik ajánlat tétele"),
      );
      assert.equal(other.status, 201, JSON.stringify(other.body));
      const otherItem = items(other.body, otherVersion).find(
        (i) => i.name === "Másik ajánlat tétele",
      )!;
      await assert.rejects(
        prisma.quoteItem.update({
          where: { id: o2 },
          data: { replacesItemId: otherItem.id },
        }),
        "a line of another version (composite key)",
      );
    });

    // barracuda #3023 (d): a draft with a replacement inside is deleted in one go, the items point at each other with a Restrict key
    it("a draft quote that holds a replacement can be deleted", async () => {
      const created = await request("/quotes", "POST", {
        title: "Replaces delete",
        validUntil: "2026-12-31",
      });
      assert.equal(created.status, 201);
      const id = created.body.id as string;
      quoteIds.push(id);
      const ver = created.body.latestVersion.id as string;
      const block = await request(
        `/quotes/${id}/versions/${ver}/blocks`,
        "POST",
        { kind: "SECTION", title: "Törlendő" },
      );
      assert.equal(block.status, 201, JSON.stringify(block.body));
      const blockPath = `/quotes/${id}/versions/${ver}/blocks/${
        (
          (block.body.versions as Json[]).find((x) => x.id === ver)!
            .blocks as Json[]
        ).find((x) => x.title === "Törlendő")!.id
      }`;
      const base = await add(blockPath, "Törlendő régi", {}, ver);
      await add(
        blockPath,
        "Törlendő új",
        { isOptional: true, replacesItemId: base },
        ver,
      );
      const res = await fetch(url + `/quotes/${id}`, { method: "DELETE" });
      assert.ok(res.status < 300, `DELETE answered ${res.status}`);
      assert.equal(await prisma.quote.count({ where: { id } }), 0);
      assert.equal(
        await prisma.quoteItem.count({ where: { versionId: ver } }),
        0,
      );
    });

    it("a new version copy points at the NEW lines, not at the old version's", async () => {
      assert.equal(await replaces(o1), a);
      await prisma.quoteVersion.update({
        where: { id: versionId },
        data: {
          status: "PUBLISHED",
          pdfStorageKey: "v1-test",
          pdfSha256: "0".repeat(64),
          pageCount: 1,
          publishedAt: new Date(),
        },
      });
      const target = await prisma.quoteVersion.create({
        data: {
          quoteId,
          versionNumber: 2,
          validUntil: new Date("2099-12-31T00:00:00Z"),
          priceDisplay: "NET",
          createdFromVersionId: versionId,
        },
      });
      const full = await prisma.quoteVersion.findUniqueOrThrow({
        where: { id: versionId },
        include: { blocks: { include: { items: true } }, bomItems: true },
      });
      await prisma.$transaction((tx) =>
        copyVersionContent(tx, full, target.id),
      );
      const copied = await prisma.quoteItem.findMany({
        where: { versionId: target.id },
        select: { id: true, name: true, replacesItemId: true },
      });
      const copiedOptional = copied.find((i) => i.name === "O1 új szűrő")!;
      const copiedLine = copied.find((i) => i.name === "A pótolt szűrő")!;
      assert.equal(copiedOptional.replacesItemId, copiedLine.id);
      assert.notEqual(copiedLine.id, a);
      // and the old version still points at its own line
      assert.equal(
        (await prisma.quoteItem.findUniqueOrThrow({ where: { id: o1 } }))
          .replacesItemId,
        a,
      );
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
      // the replacements point at each other: let go first, the key is Restrict
      await prisma.quoteItem.updateMany({
        where: { versionId: { in: versions } },
        data: { replacesItemId: null },
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
      await prisma.user.deleteMany({ where: { id: actorId } });
    });
  },
);
