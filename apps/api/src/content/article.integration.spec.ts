import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { ArticleBodyInput } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { ArticleImageRepository } from "./article-image.repository.js";
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
    const articleImages = new ArticleImageRepository();
    const imageIds: string[] = [];
    const content = new ContentRepository();
    const actor = randomUUID();
    const ids: string[] = [];
    const taxonKey = `ARTINT${Date.now() % 1_000_000}`;

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
      await prisma.articleImage.deleteMany({ where: { id: { in: imageIds } } });
      await prisma.knowledgeVocabularyEntry.deleteMany({
        where: { key: { startsWith: taxonKey } },
      });
      nincsMaradek([
        {
          nev: "ContentItem (article test)",
          darab: await prisma.contentItem.count({ where: { id: { in: ids } } }),
        },
        {
          nev: "ArticleImage (article test)",
          darab: await prisma.articleImage.count({
            where: { id: { in: imageIds } },
          }),
        },
        {
          nev: "KnowledgeVocabularyEntry (article test)",
          darab: await prisma.knowledgeVocabularyEntry.count({
            where: { key: { startsWith: taxonKey } },
          }),
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

    it("ARTICLE-INT-CORRECT: a published article goes back to revision while the page keeps the published text; the next approval and SENT publish the correction", async () => {
      const id = await item("ARTICLE");
      assert.equal(
        await articles.save(id, body({ slug: `${prefix}javitas` }), actor),
        "ok",
      );
      for (const [from, to] of [
        ["DRAFTING", "AWAITING_REVIEW"],
        ["AWAITING_REVIEW", "AWAITING_APPROVAL"],
        ["AWAITING_APPROVAL", "READY_TO_SEND"],
        ["READY_TO_SEND", "SENT"],
      ])
        assert.equal(await move(id, from!, to!), true, `${from} -> ${to}`);
      const first = await articles.detail(id);
      const firstPublished = first?.publishedRevision?.id;
      assert.ok(firstPublished && first?.publishedAt);

      // the correction: back to revision, the page still shows the first text
      assert.equal(await move(id, "SENT", "AWAITING_REVISION"), true);
      const correcting = await articles.detail(id);
      assert.equal(correcting?.publishedRevision?.id, firstPublished);
      assert.equal(correcting?.approvedRevision, null);
      assert.equal(
        await articles.save(
          id,
          body({
            slug: `${prefix}javitas`,
            bodyHtml: "<p>Javított szöveg</p>",
          }),
          actor,
        ),
        "ok",
      );
      // a published article is not discarded, not even from its correction
      await assert.rejects(
        move(id, "AWAITING_REVISION", "DISCARDED"),
        ArticleStepError,
      );

      for (const [from, to] of [
        ["AWAITING_REVISION", "AWAITING_REVIEW"],
        ["AWAITING_REVIEW", "AWAITING_APPROVAL"],
        ["AWAITING_APPROVAL", "READY_TO_SEND"],
        ["READY_TO_SEND", "SENT"],
      ])
        assert.equal(await move(id, from!, to!), true, `${from} -> ${to}`);
      const corrected = await articles.detail(id);
      assert.notEqual(corrected?.publishedRevision?.id, firstPublished);
      assert.equal(corrected?.revisions.length, 2);
      // the article's date stays the first publication
      assert.equal(corrected?.publishedAt, first?.publishedAt);
      const shown = await prisma.articleRevision.findUniqueOrThrow({
        where: { id: corrected!.publishedRevision!.id },
      });
      assert.equal(shown.bodyHtml, "<p>Javított szöveg</p>");
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

    it("ARTICLE-INT-SCHEDULED: discarding a scheduled article withdraws its approval", async () => {
      const id = await item("ARTICLE");
      await articles.save(id, body({ slug: `${prefix}utemezett` }), actor);
      await move(id, "DRAFTING", "AWAITING_REVIEW");
      await move(id, "AWAITING_REVIEW", "AWAITING_APPROVAL");
      await move(id, "AWAITING_APPROVAL", "READY_TO_SEND");
      await move(id, "READY_TO_SEND", "SCHEDULED");
      assert.ok((await articles.detail(id))?.approvedRevision);
      await move(id, "SCHEDULED", "DISCARDED");
      assert.equal((await articles.detail(id))?.approvedRevision, null);
    });

    it("ARTICLE-INT-LOCK: an approval that starts during a save waits for it, and snapshots the saved body", async () => {
      const id = await item("ARTICLE", "AWAITING_APPROVAL");
      await prisma.articleBody.create({
        data: {
          contentId: id,
          slug: `${prefix}zar`,
          bodyHtml: "<p>Régi</p>",
          channels: ["WEBSHOP_BLOG"],
        },
      });
      // hold the row as the save does, then let an approval try meanwhile
      let approval: Promise<boolean> | undefined;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "ContentItem" WHERE "id" = ${id} FOR UPDATE`;
        approval = move(id, "AWAITING_APPROVAL", "READY_TO_SEND");
        await new Promise((resolve) => setTimeout(resolve, 300));
        await tx.articleBody.update({
          where: { contentId: id },
          data: { bodyHtml: "<p>Új</p>" },
        });
      });
      assert.equal(await approval, true);
      const detail = await articles.detail(id);
      const revision = await prisma.articleRevision.findUniqueOrThrow({
        where: { id: detail!.approvedRevision!.id },
      });
      assert.equal(revision.bodyHtml, "<p>Új</p>");
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

    it("ARTICLE-INT-EDITABLE: the body is editable in the author's and reviewer's states only, and only on an article", async () => {
      const drafting = await item("ARTICLE", "DRAFTING");
      const awaiting = await item("ARTICLE", "AWAITING_APPROVAL");
      const post = await item("FACEBOOK_POST", "DRAFTING");
      assert.deepEqual(
        [
          await articles.editable(drafting),
          await articles.editable(awaiting),
          await articles.editable(post),
          await articles.editable("nincs-ilyen"),
        ],
        [true, false, false, false],
      );
    });

    it("ARTICLE-INT-TAXA: the editor's taxa are the approved vocabulary version's: the code's version 1 without a database version, then the latest wholly approved one", async () => {
      // with no database version, the approved vocabulary is the code's version 1
      if ((await prisma.knowledgeVocabularyEntry.count()) === 0) {
        const fromCode = await articles.taxonOptions();
        assert.ok(
          fromCode.some((o) => o.key === "SPS" && o.label === "SPS"),
          "the code's version 1 is offered",
        );
        assert.deepEqual(
          [...(await articles.knownTaxonKeys(["SPS"]))],
          ["SPS"],
        );
      }
      const top =
        (
          await prisma.knowledgeVocabularyEntry.aggregate({
            _max: { version: true },
          })
        )._max.version ?? 1;
      const approved = Math.max(top, 1) + 1;
      await prisma.knowledgeVocabularyEntry.createMany({
        data: [
          // a wholly approved version: it replaces version 1 entirely
          {
            kind: "TAXON",
            key: `${taxonKey}_A`,
            forms: ["új alak"],
            version: approved,
            rank: "GENUS",
            status: "APPROVED",
          },
          {
            kind: "TAXON",
            key: `${taxonKey}_B`,
            forms: [],
            version: approved,
            status: "APPROVED",
          },
          {
            kind: "TAXON",
            key: `${taxonKey}_R`,
            forms: ["kivont"],
            version: approved,
            status: "RETIRED",
          },
          {
            kind: "EFFECT",
            key: `${taxonKey}_C`,
            forms: ["hatás"],
            version: approved,
            status: "APPROVED",
          },
          // a newer draft does not change what is approved
          {
            kind: "TAXON",
            key: `${taxonKey}_A`,
            forms: ["vázlat"],
            version: approved + 1,
            rank: "GENUS",
            status: "DRAFT",
          },
          {
            kind: "TAXON",
            key: `${taxonKey}_D`,
            forms: ["csak vázlat"],
            version: approved + 1,
            status: "DRAFT",
          },
        ] as never,
      });
      assert.deepEqual(await articles.taxonOptions(), [
        { key: `${taxonKey}_A`, rank: "GENUS", label: "Új alak" },
        { key: `${taxonKey}_B`, rank: null, label: `${taxonKey}_B` },
      ]);
      // the save's check takes the same set: version 1's SPS is no longer in it
      assert.deepEqual(
        [
          ...(await articles.knownTaxonKeys([
            `${taxonKey}_A`,
            `${taxonKey}_D`,
            `${taxonKey}_R`,
            `${taxonKey}_C`,
            "SPS",
          ])),
        ],
        [`${taxonKey}_A`],
      );
    });

    it("ARTICLE-INT-IMAGE: an image's bytes come back unchanged by id, and the same file is found by its hash", async () => {
      const contentId = await item("ARTICLE");
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 7]);
      const sha256 = randomUUID().replace(/-/g, "").padEnd(64, "0");
      const row = await articleImages.create({
        contentId,
        contentType: "image/png",
        width: 1,
        height: 1,
        sha256,
        bytes,
        uploadedById: null,
      });
      imageIds.push(row.id);
      assert.match(row.id, /^c[a-z0-9]{24}$/);
      const back = await articleImages.content(row.id);
      assert.equal(back?.contentType, "image/png");
      assert.deepEqual([...(back?.bytes ?? [])], [...bytes]);
      assert.equal((await articleImages.findBySha256(sha256))?.id, row.id);
      assert.equal(back?.sha256, sha256);
      // the 304's lookup: the type and the hash, without the bytes
      assert.deepEqual(await articleImages.meta(row.id), {
        contentType: "image/png",
        sha256,
      });
      assert.equal(await articleImages.content("c" + "z".repeat(24)), null);
    });
  },
);
