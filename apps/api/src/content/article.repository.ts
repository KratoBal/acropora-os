import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";
import type {
  ArticleBodyInput,
  ArticleDetail,
  ArticleRevisionSummary,
  ArticleTaxonOption,
} from "@acropora/types";

import { VocabularyRepository } from "../knowledge-base/vocabulary/vocabulary.repository.js";
import { labelOf } from "../knowledge-base/vocabulary/vocabulary-versions.js";
import type { ContentState } from "./content-state.js";

/**
 * THE STATES IN WHICH AN ARTICLE BODY MAY CHANGE: the author's and the
 * reviewer's. From `AWAITING_APPROVAL` on the text is under (or past) the
 * approver's eye, and a change there would reach the public unapproved; to
 * change it, the item goes back to `AWAITING_REVISION` first (an existing move).
 */
export const ARTICLE_EDITABLE_STATES: readonly ContentState[] = [
  "IDEA",
  "DRAFTING",
  "AWAITING_REVIEW",
  "AWAITING_REVISION",
];

/** Why a move on an article cannot happen; the service answers 409 with it. */
export class ArticleStepError extends Error {}

type Tx = Prisma.TransactionClient;

const revisionSummary = (revision: {
  id: string;
  approvedAt: Date;
  approvedById: string;
  contentHash: string;
}): ArticleRevisionSummary => ({
  id: revision.id,
  approvedAt: revision.approvedAt.toISOString(),
  approvedById: revision.approvedById,
  contentHash: revision.contentHash,
});

/** The sha256 of a snapshot's public fields, in a fixed order. */
export function articleContentHash(snapshot: {
  title: string;
  excerpt: string;
  bodyHtml: string;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  channels: readonly string[];
  byline: string | null;
  seoTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  noindex: boolean;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        snapshot.title,
        snapshot.excerpt,
        snapshot.bodyHtml,
        snapshot.coverImageUrl,
        snapshot.coverImageAlt,
        [...snapshot.channels].sort(),
        snapshot.byline,
        snapshot.seoTitle,
        snapshot.metaDescription,
        snapshot.ogImageUrl,
        snapshot.noindex,
      ]),
    )
    .digest("hex");
}

/**
 * THE ARTICLE'S PART OF A STATE MOVE, inside the move's own transaction (called
 * from `ContentRepository.moveState`), so a state and its revision can never
 * part. Nothing happens for another channel.
 *
 *   AWAITING_APPROVAL -> READY_TO_SEND   the approval: an unchangeable snapshot
 *   READY_TO_SEND | SCHEDULED -> SENT    publishing: the APPROVED snapshot goes
 *                                        public, never the body being edited
 *   any -> AWAITING_REVISION | DISCARDED the approval is withdrawn, from every
 *                                        state that may hold one (READY_TO_SEND
 *                                        and SCHEDULED today); the public
 *                                        revision, if any, stays (barracuda,
 *                                        #1887 b)
 *   SENT -> AWAITING_REVISION            the correction of a published article
 *                                        (acrobot 36474): the same withdrawal;
 *                                        the page keeps the published revision
 *   any -> DISCARDED, once published     refused: a discarded item whose page
 *                                        stays public would be a lie, and there
 *                                        is no unpublishing; a correction ends
 *                                        with an approval and a new SENT
 */
export async function applyArticleStep(
  tx: Tx,
  input: {
    contentId: string;
    from: ContentState;
    to: ContentState;
    actorUserId: string;
  },
): Promise<void> {
  const item = await tx.contentItem.findUnique({
    where: { id: input.contentId },
    select: { channel: true, title: true },
  });
  if (!item || item.channel !== "ARTICLE") return;
  const body = await tx.articleBody.findUnique({
    where: { contentId: input.contentId },
  });

  if (input.from === "AWAITING_APPROVAL" && input.to === "READY_TO_SEND") {
    if (!body)
      throw new ArticleStepError(
        "A cikknek még nincs törzse: jóváhagyás előtt írd meg a cikket.",
      );
    const snapshot = {
      title: item.title,
      excerpt: body.excerpt,
      bodyHtml: body.bodyHtml,
      coverImageUrl: body.coverImageUrl,
      coverImageAlt: body.coverImageAlt,
      channels: body.channels,
      byline: body.byline,
      seoTitle: body.seoTitle,
      metaDescription: body.metaDescription,
      ogImageUrl: body.ogImageUrl,
      noindex: body.noindex,
    };
    const revision = await tx.articleRevision.create({
      data: {
        contentId: input.contentId,
        ...snapshot,
        contentHash: articleContentHash(snapshot),
        approvedById: input.actorUserId,
      },
      select: { id: true },
    });
    await tx.articleBody.update({
      where: { contentId: input.contentId },
      data: { approvedRevisionId: revision.id },
    });
    return;
  }

  if (input.to === "SENT") {
    if (!body?.approvedRevisionId)
      throw new ArticleStepError(
        "A cikknek nincs jóváhagyott változata, ezért nem publikálható.",
      );
    // THE RESEARCH PILOT PUBLISHES NOTHING (plan v4, 9.2 S5): an article with
    // any citation row, a not-technical mark included, is under the knowledge
    // base's check, and its first public release is Balázs's own decision
    // after the copyright check (13., 6.).
    if (
      (await tx.articleCitation.count({
        where: { contentId: input.contentId },
      })) > 0
    )
      throw new ArticleStepError(
        "Ez a cikk a kutatási tudástár hivatkozás-ellenőrzése alatt áll (hivatkozás vagy nem szakmai jelölés van rajta), ezért a pilotban nem publikálható: az első közzététel Balázs külön döntése, a szerzői jogi ellenőrzés után.",
      );
    await tx.articleBody.update({
      where: { contentId: input.contentId },
      data: {
        publishedRevisionId: body.approvedRevisionId,
        publishedAt: body.publishedAt ?? new Date(),
      },
    });
    return;
  }

  if (input.to === "DISCARDED" && body?.publishedRevisionId)
    throw new ArticleStepError(
      "A közzétett cikk nem vethető el: a javítás új jóváhagyással és közzététellel zárul.",
    );

  if (
    (input.to === "AWAITING_REVISION" || input.to === "DISCARDED") &&
    body?.approvedRevisionId
  )
    await tx.articleBody.update({
      where: { contentId: input.contentId },
      data: { approvedRevisionId: null },
    });
}

export type ArticleSaveOutcome =
  "ok" | "missing" | "not-article" | "not-editable" | "slug-taken";

@Injectable()
export class ArticleRepository {
  async detail(contentId: string): Promise<ArticleDetail | null> {
    const body = await prisma.articleBody.findUnique({
      where: { contentId },
      include: {
        products: {
          orderBy: { sortOrder: "asc" },
          include: { product: { select: { name: true } } },
        },
        taxa: { orderBy: { taxonKey: "asc" } },
        approvedRevision: true,
        publishedRevision: true,
        revisions: { orderBy: { approvedAt: "desc" } },
      },
    });
    if (!body) return null;
    return {
      contentId: body.contentId,
      slug: body.slug,
      excerpt: body.excerpt,
      bodyHtml: body.bodyHtml,
      coverImageUrl: body.coverImageUrl,
      coverImageAlt: body.coverImageAlt,
      channels: body.channels,
      byline: body.byline,
      seoTitle: body.seoTitle,
      metaDescription: body.metaDescription,
      ogImageUrl: body.ogImageUrl,
      noindex: body.noindex,
      taxonKeys: body.taxa.map((taxon) => taxon.taxonKey),
      products: body.products.map((link) => ({
        productId: link.productId,
        name: link.product.name,
        sortOrder: link.sortOrder,
      })),
      approvedRevision: body.approvedRevision
        ? revisionSummary(body.approvedRevision)
        : null,
      publishedRevision: body.publishedRevision
        ? revisionSummary(body.publishedRevision)
        : null,
      publishedAt: body.publishedAt?.toISOString() ?? null,
      revisions: body.revisions.map(revisionSummary),
      updatedAt: body.updatedAt.toISOString(),
    };
  }

  /** How many of these product ids exist. */
  async countProducts(ids: readonly string[]): Promise<number> {
    if (!ids.length) return 0;
    return prisma.product.count({ where: { id: { in: [...ids] } } });
  }

  /** Whether this item is an article whose body may change now. */
  async editable(contentId: string): Promise<boolean> {
    const item = await prisma.contentItem.findUnique({
      where: { id: contentId },
      select: { channel: true, state: true },
    });
    return (
      item?.channel === "ARTICLE" &&
      ARTICLE_EDITABLE_STATES.includes(item.state as ContentState)
    );
  }

  /**
   * THE TAXA AN ARTICLE CAN LINK TO: the TAXON rows of the APPROVED VOCABULARY,
   * as the vocabulary's own gate reads it (`versionsOf(...).approved`).
   *
   * A version is the WHOLE word list, not one row's state: version 1 lives in
   * code (`VOCABULARY_V1_ROWS`), the database holds version 2 onwards, and the
   * approved one is the latest whose rows are all approved, else the code's
   * version 1 (`vocabulary-versions.ts`). Reading database rows one by one (as
   * #1887 and #1898 did) offered nothing where no database version exists yet,
   * and could take a key a later approved version had dropped. A draft key is
   * not offered: ArticleTaxon is no foreign key, and an article linked to a
   * dropped draft would point at nothing (barracuda, #1896; acrobot 36330).
   */
  private async approvedTaxa() {
    const versions = await new VocabularyRepository().versions();
    return versions.approved.rows
      .filter((row) => row.kind === "TAXON" && row.status !== "RETIRED")
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  async taxonOptions(): Promise<ArticleTaxonOption[]> {
    return (await this.approvedTaxa()).map((row) => ({
      key: row.key,
      rank: row.rank ?? null,
      label: labelOf(row),
    }));
  }

  /** Which of these keys are TAXON keys of the approved vocabulary (the same set). */
  async knownTaxonKeys(keys: readonly string[]): Promise<Set<string>> {
    if (!keys.length) return new Set();
    const approved = new Set((await this.approvedTaxa()).map((row) => row.key));
    return new Set(keys.filter((key) => approved.has(key)));
  }

  /**
   * THE BODY, ITS PRODUCTS AND TAXA, in one transaction, and only while the
   * item is an article in an editable state: the state is read inside the
   * transaction, so an approval that ran meanwhile wins over the edit.
   */
  async save(
    contentId: string,
    input: ArticleBodyInput,
    userId: string,
  ): Promise<ArticleSaveOutcome> {
    try {
      return await prisma.$transaction(async (tx) => {
        /*
          THE ITEM ROW IS LOCKED FOR THE WHOLE SAVE (barracuda, #1887 a). Under
          READ COMMITTED a submission and an approval could otherwise run
          between this read and the write: the snapshot would hold the old body
          and the body the new one, in an approved state. With the lock the
          approval's conditional update waits for this save, and its snapshot
          reads the body this save wrote.
        */
        const [item] = await tx.$queryRaw<
          { channel: string; state: string }[]
        >`SELECT "channel"::text AS channel, "state"::text AS state FROM "ContentItem" WHERE "id" = ${contentId} FOR UPDATE`;
        if (!item) return "missing" as const;
        if (item.channel !== "ARTICLE") return "not-article" as const;
        if (!ARTICLE_EDITABLE_STATES.includes(item.state as ContentState))
          return "not-editable" as const;
        const data = {
          slug: input.slug,
          excerpt: input.excerpt,
          bodyHtml: input.bodyHtml,
          coverImageUrl: input.coverImageUrl,
          coverImageAlt: input.coverImageAlt,
          channels: input.channels,
          byline: input.byline,
          seoTitle: input.seoTitle,
          metaDescription: input.metaDescription,
          ogImageUrl: input.ogImageUrl,
          noindex: input.noindex,
          updatedById: userId,
        };
        await tx.articleBody.upsert({
          where: { contentId },
          create: { contentId, ...data },
          update: data,
        });
        await tx.articleProduct.deleteMany({ where: { contentId } });
        if (input.productIds.length)
          await tx.articleProduct.createMany({
            data: input.productIds.map((productId, sortOrder) => ({
              contentId,
              productId,
              sortOrder,
            })),
          });
        await tx.articleTaxon.deleteMany({ where: { contentId } });
        if (input.taxonKeys.length)
          await tx.articleTaxon.createMany({
            data: input.taxonKeys.map((taxonKey) => ({ contentId, taxonKey })),
          });
        return "ok" as const;
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "P2002"
      )
        return "slug-taken";
      throw error;
    }
  }
}
