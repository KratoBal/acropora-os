import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { ArticleBodyInput } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { ArticleRepository, ArticleStepError } from "./article.repository.js";
import { ContentRepository } from "./content.repository.js";

/**
 * THE ARTICLE ON THE REAL DATABASE (acrobot, 2026-10-26, msg 36158). The
 * revision is written in the state move's own transaction, so only the real
 * database can show that a state and its revision never part.
 *
 * WHAT TURNS IT RED: an approval without a snapshot; a snapshot that follows a
 * later edit; publishing the body being edited instead of the approved
 * snapshot; an approval without a body that still moves the state (no
 * rollback); an edit in an approved state accepted; another channel touched.
 */
const gate = integrationDatabaseGate(process.env);

describe(
  "Article body and revisions, on the database",
  { skip: gate.mode === "skip" },
  () => {
    const prefix = `art-int-${Date.now() % 1_000_000}-`;
    const articles = new ArticleRepository();
    const content = new ContentRepository();
    const actor = randomUUID();
    const ids: string[] = [];

    const body = (over: Partial<ArticleBodyInput> = {}): ArticleBodyInput => ({
      slug: `${prefix}cikk`,
      excerpt: "Bevezető",
      bodyHtml: "<p>Első szöveg</p>",
      coverImageUrl: null,
      coverImageAlt: null,
      channels: ["WEBSHOP_BLOG"],
      byline: null,
      seoTitle: null,
      metaDescription: null,
      ogImageUrl: null,
      noindex: false,
      productIds: [],
      taxonKeys: [],
      ...over,
    });

    const item = async (
      channel: "ARTICLE" | "FACEBOOK_POST",
      state = "DRAFTING",
    ) => {
      const created = await prisma.contentItem.create({
        data: { title: `${prefix}${channel}`, channel, state: state as never },
      });
      ids.push(created.id);
      return created.id;
    };
    const move = (id: string, from: string, to: string) =>
      content.moveState({
        id,
        from: from as never,
        to: to as never,
        actorUserId: actor,
      });

    before(() => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
    });

    after(async () => {
      await prisma.contentItem.deleteMany({ where: { id: { in: ids } } });
      nincsMaradek([
        {
          nev: "ContentItem (article test)",
          darab: await prisma.contentItem.count({ where: { id: { in: ids } } }),
        },
        {
          nev: "ArticleBody (article test)",
          darab: await prisma.articleBody.count({
            where: { contentId: { in: ids } },
          }),
        },
      ]);
    });

    it("ARTICLE-INT-PATH: approval snapshots, an edit after it is refused, publishing shows the approved snapshot", async () => {
      const id = await item("ARTICLE");
      assert.equal(await articles.save(id, body(), actor), "ok");
      for (const [from, to] of [
        ["DRAFTING", "AWAITING_REVIEW"],
        ["AWAITING_REVIEW", "AWAITING_APPROVAL"],
        ["AWAITING_APPROVAL", "READY_TO_SEND"],
      ])
        assert.equal(await move(id, from!, to!), true, `${from} -> ${to}`);
      const approved = await articles.detail(id);
      assert.ok(approved?.approvedRevision);
      assert.equal(approved.revisions.length, 1);
      assert.equal(approved.publishedRevision, null);

      assert.equal(
        await articles.save(
          id,
          body({ bodyHtml: "<p>Késői javítás</p>" }),
          actor,
        ),
        "not-editable",
      );

      assert.equal(await move(id, "READY_TO_SEND", "SENT"), true);
      const published = await articles.detail(id);
      assert.equal(
        published?.publishedRevision?.id,
        approved.approvedRevision.id,
      );
      assert.ok(published?.publishedAt);
      const revision = await prisma.articleRevision.findUniqueOrThrow({
        where: { id: approved.approvedRevision.id },
      });
      assert.equal(revision.bodyHtml, "<p>Első szöveg</p>");
      assert.equal(revision.approvedById, actor);
    });

    it("ARTICLE-INT-NOBODY: an approval without a body moves nothing", async () => {
      const id = await item("ARTICLE", "AWAITING_APPROVAL");
      await assert.rejects(
        move(id, "AWAITING_APPROVAL", "READY_TO_SEND"),
        ArticleStepError,
      );
      const after = await prisma.contentItem.findUniqueOrThrow({
        where: { id },
      });
      assert.equal(after.state, "AWAITING_APPROVAL");
    });

    it("ARTICLE-INT-REVISION: sending back withdraws the approval, the published snapshot stays", async () => {
      const id = await item("ARTICLE");
      await articles.save(id, body({ slug: `${prefix}masik` }), actor);
      await move(id, "DRAFTING", "AWAITING_REVIEW");
      await move(id, "AWAITING_REVIEW", "AWAITING_APPROVAL");
      await move(id, "AWAITING_APPROVAL", "READY_TO_SEND");
      await move(id, "READY_TO_SEND", "AWAITING_REVISION");
      const back = await articles.detail(id);
      assert.equal(back?.approvedRevision, null);
      assert.equal(back?.revisions.length, 1);
      assert.equal(
        await articles.save(
          id,
          body({ slug: `${prefix}masik`, bodyHtml: "<p>Javítva</p>" }),
          actor,
        ),
        "ok",
      );
    });

    it("ARTICLE-INT-OTHER: another channel is untouched by the article steps, and takes no body", async () => {
      const id = await item("FACEBOOK_POST", "AWAITING_APPROVAL");
      assert.equal(await move(id, "AWAITING_APPROVAL", "READY_TO_SEND"), true);
      assert.equal(
        await prisma.articleRevision.count({ where: { contentId: id } }),
        0,
      );
      assert.equal(
        await articles.save(id, body({ slug: `${prefix}poszt` }), actor),
        "not-article",
      );
    });

    it("ARTICLE-INT-SLUG: a slug belongs to one article", async () => {
      const first = await item("ARTICLE");
      const second = await item("ARTICLE");
      assert.equal(
        await articles.save(first, body({ slug: `${prefix}egy` }), actor),
        "ok",
      );
      assert.equal(
        await articles.save(second, body({ slug: `${prefix}egy` }), actor),
        "slug-taken",
      );
    });
  },
);
