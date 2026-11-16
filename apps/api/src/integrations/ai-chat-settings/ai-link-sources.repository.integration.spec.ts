import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { AiChatSettingsRepository } from "./ai-chat-settings.repository.js";

/**
 * THE STORED LINK SOURCES IN THE DATABASE (card 9d060f5c). WHAT TURNS IT RED: an addition or a removal leaves no
 * audit row (or one without the author or the host); a second addition of the same host wins; the database takes
 * a host in upper case, a manufacturer document without a brand or an authority with one, when the server's rule
 * is bypassed.
 */
const gate = integrationDatabaseGate(process.env);
describe(
  "AI link sources: the repository against the database",
  { skip: gate.mode === "skip" },
  () => {
    const run = randomUUID().slice(0, 8);
    const host = `gyarto-${run}.example.com`;
    const repository = new AiChatSettingsRepository();
    let userId: string;
    let brandName: string;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      userId = (
        await prisma.user.create({
          data: {
            email: `ai-link-source-${run}@example.invalid`,
            displayName: "Link source test",
            role: "ADMIN",
          },
        })
      ).id;
      brandName = `Teszt Márka ${run}`;
      await prisma.brand.create({
        data: {
          name: brandName,
          normalizedName: `teszt-marka-${run}`,
          slug: `teszt-marka-${run}`,
        },
      });
    });

    after(async () => {
      await prisma.aiLinkSource.deleteMany({
        where: { host: { contains: run } },
      });
      if (userId) {
        await prisma.auditLog.deleteMany({ where: { userId } });
        await prisma.user.delete({ where: { id: userId } });
      }
      await prisma.brand.deleteMany({ where: { slug: `teszt-marka-${run}` } });
    });

    it("an addition and a removal each write one audit row with the author and the host, in the same transaction", async () => {
      const added = await repository.addLinkSource(
        {
          host,
          category: "MANUFACTURER_DOCUMENT",
          brand: brandName,
          note: "teszt",
        },
        userId,
      );
      assert.ok(added);
      assert.equal(added.host, host);
      assert.ok(
        (await repository.linkSources()).some(
          (source) => source.id === added.id,
        ),
      );

      assert.equal(await repository.removeLinkSource(added.id, userId), true);
      assert.equal(await repository.removeLinkSource(added.id, userId), false);

      const rows = await prisma.auditLog.findMany({
        where: { entityType: "AiLinkSource", entityId: added.id },
        orderBy: { createdAt: "asc" },
      });
      assert.deepEqual(
        rows.map((row) => [
          row.action,
          row.userId,
          (row.metadata as { host?: string })?.host,
        ]),
        [
          ["ai-link-source.added", userId, host],
          ["ai-link-source.removed", userId, host],
        ],
      );
    });

    it("the same host twice: exactly one addition wins, the other is null, and only one audit row is written", async () => {
      const twice = `ketszer-${run}.example.com`;
      const results = await Promise.all(
        [0, 1].map(() =>
          repository.addLinkSource(
            { host: twice, category: "AUTHORITY", brand: null, note: null },
            userId,
          ),
        ),
      );
      assert.equal(results.filter((result) => result !== null).length, 1);
      assert.equal(
        await prisma.auditLog.count({
          where: {
            action: "ai-link-source.added",
            metadata: { path: ["host"], equals: twice },
          },
        }),
        1,
      );
    });

    it("the database refuses what the server's rule refuses, if the rule is bypassed", async () => {
      for (const data of [
        {
          host: `NAGY-${run}.example.com`,
          category: "AUTHORITY" as const,
          brand: null,
        },
        {
          host: `http://${run}.example.com/x`,
          category: "AUTHORITY" as const,
          brand: null,
        },
        {
          host: `nobrand-${run}.example.com`,
          category: "MANUFACTURER_DOCUMENT" as const,
          brand: null,
        },
        {
          host: `blank-${run}.example.com`,
          category: "MANUFACTURER_DOCUMENT" as const,
          brand: "  ",
        },
        {
          host: `authbrand-${run}.example.com`,
          category: "AUTHORITY" as const,
          brand: "Red Sea",
        },
      ])
        await assert.rejects(
          prisma.aiLinkSource.create({ data }),
          JSON.stringify(data),
        );
    });

    it("the brand lookup finds a live brand in any letter case and gives back its own spelling", async () => {
      assert.equal(
        await repository.brandName(brandName.toUpperCase()),
        brandName,
      );
      assert.equal(await repository.brandName(`${brandName} X`), null);
    });
  },
);
