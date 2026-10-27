import { Prisma, prisma } from "@acropora/database";
import {
  citationReport,
  splitSentences,
  warningKey,
  type CitationReport,
  type CitationRow,
  type CitedConclusion,
} from "@acropora/knowledge-base";

import { ARTICLE_EDITABLE_STATES } from "../../content/article-states.js";
import { citedClaims } from "../claims/claim-store.repository.js";
import { VocabularyRepository } from "../vocabulary/vocabulary.repository.js";
import {
  approvalBlockMessage,
  articleText,
  sentenceHash,
  type AnswerInput,
  type CitationInput,
} from "./article-citation.js";

type Tx = Prisma.TransactionClient;

export interface ArticleCitationReport extends CitationReport {
  contentId: string;
  /** Whether citations may change now: the article body's own editable states. */
  editable: boolean;
  vocabulary: { version: number; status: string };
  /** What each citation points at, by its id: the report itself names only the kind. */
  targets: {
    id: string;
    kind: string;
    claimId: string | null;
    conclusionId: string | null;
    reason: string | null;
  }[];
}

export class ArticleCitationNotFound extends Error {
  constructor(what: string) {
    super(what);
    this.name = "ArticleCitationNotFound";
  }
}

/** The write cannot happen; the service answers 409 with the message. */
export class ArticleCitationConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArticleCitationConflict";
  }
}

/** The input names something the article does not hold; the service answers 400. */
export class ArticleCitationInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArticleCitationInvalid";
  }
}

const CITATION_SELECT = {
  id: true,
  sentence: true,
  kind: true,
  claimId: true,
  conclusionId: true,
  answeredWarnings: true,
  reason: true,
} satisfies Prisma.ArticleCitationSelect;

async function loadArticle(tx: Tx | typeof prisma, contentId: string) {
  const item = await tx.contentItem.findUnique({
    where: { id: contentId },
    select: {
      title: true,
      channel: true,
      state: true,
      article: { select: { excerpt: true, bodyHtml: true } },
    },
  });
  if (!item) throw new ArticleCitationNotFound("A tartalom nem található.");
  if (item.channel !== "ARTICLE" || !item.article)
    throw new ArticleCitationConflict(
      "Ez a tartalom nem cikk, vagy még nincs törzse.",
    );
  return {
    state: item.state,
    text: articleText({ title: item.title, ...item.article }),
  };
}

function requireEditable(state: string) {
  if (!(ARTICLE_EDITABLE_STATES as readonly string[]).includes(state))
    throw new ArticleCitationConflict(
      "A cikk jóváhagyásra vár vagy már jóvá van hagyva: a hivatkozások csak javításra visszaküldve módosíthatók.",
    );
}

async function citedConclusions(
  tx: Tx | typeof prisma,
  ids: readonly string[],
): Promise<Map<string, CitedConclusion>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.knowledgeConclusion.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: {
      id: true,
      status: true,
      claims: { select: { claim: { select: { status: true } } } },
    },
  });
  return new Map(
    rows.map((c) => [
      c.id,
      { status: c.status, claimStatuses: c.claims.map((k) => k.claim.status) },
    ]),
  );
}

/**
 * WHETHER AN ARTICLE IS A KNOWLEDGE ARTICLE: marked once (`knowledgeSince`,
 * set by its first citation and never cleared), or carrying a citation row
 * (an article cited before the mark existed). The approval gate and the
 * pilot's publishing refusal both read this, never the citation count alone.
 */
export async function isKnowledgeArticle(
  tx: Tx | typeof prisma,
  contentId: string,
): Promise<boolean> {
  const body = await tx.articleBody.findUnique({
    where: { contentId },
    select: { knowledgeSince: true, _count: { select: { citations: true } } },
  });
  return Boolean(body && (body.knowledgeSince || body._count.citations > 0));
}

/**
 * AN ARTICLE'S CITATIONS (S5): the report over the current text, and the
 * writes. Citations change only while the body may (`ARTICLE_EDITABLE_STATES`):
 * what the approver saw checked is what stays checked. Every write leaves an
 * AuditLog row.
 */
export class ArticleCitationRepository {
  private readonly vocabulary = new VocabularyRepository();

  private async build(
    tx: Tx | typeof prisma,
    contentId: string,
  ): Promise<{ report: ArticleCitationReport; rows: CitationRow[] }> {
    const article = await loadArticle(tx, contentId);
    const stored = await tx.articleCitation.findMany({
      where: { contentId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: CITATION_SELECT,
    });
    const rows: CitationRow[] = stored.map((r) => ({
      id: r.id,
      sentence: r.sentence,
      kind: r.kind,
      claimId: r.claimId,
      conclusionId: r.conclusionId,
      answered: r.answeredWarnings,
    }));
    const [claims, conclusions, vocabulary] = await Promise.all([
      citedClaims(
        rows.flatMap((r) => (r.claimId ? [r.claimId] : [])),
        tx,
      ),
      citedConclusions(
        tx,
        rows.flatMap((r) => (r.conclusionId ? [r.conclusionId] : [])),
      ),
      this.vocabulary.approvedVocabulary(),
    ]);
    const report = citationReport({
      text: article.text,
      citations: rows,
      claims,
      conclusions,
      vocabulary,
    });
    return {
      report: {
        ...report,
        contentId,
        editable: (ARTICLE_EDITABLE_STATES as readonly string[]).includes(
          article.state,
        ),
        vocabulary: { version: vocabulary.version, status: vocabulary.status },
        targets: stored.map((r) => ({
          id: r.id,
          kind: r.kind,
          claimId: r.claimId,
          conclusionId: r.conclusionId,
          reason: r.reason,
        })),
      },
      rows,
    };
  }

  /**
   * Why a knowledge article may not be approved now, or null. An article
   * without any citation row is no knowledge article, and its approval is
   * none of this check's business; one with citations needs a clean report.
   * Runs in the approval's own transaction (`applyArticleStep`).
   */
  async approvalBlock(tx: Tx, contentId: string): Promise<string | null> {
    if (!(await isKnowledgeArticle(tx, contentId))) return null;
    const { report } = await this.build(tx, contentId);
    return report.clean ? null : approvalBlockMessage(report);
  }

  async report(contentId: string): Promise<ArticleCitationReport> {
    return (await this.build(prisma, contentId)).report;
  }

  async add(
    contentId: string,
    input: CitationInput,
    userId: string,
  ): Promise<ArticleCitationReport> {
    await prisma.$transaction(async (tx) => {
      const article = await loadArticle(tx, contentId);
      requireEditable(article.state);
      if (!splitSentences(article.text).includes(input.sentence))
        throw new ArticleCitationInvalid(
          "sentence: ez a mondat nincs a cikk mostani szövegében.",
        );
      if (input.kind === "CLAIM") {
        const claim = await tx.knowledgeClaim.findUnique({
          where: { id: input.targetId },
          select: { status: true },
        });
        if (!claim)
          throw new ArticleCitationInvalid("claimId: nincs ilyen állítás.");
        if (claim.status !== "VERIFIED")
          throw new ArticleCitationConflict(
            "Csak VERIFIED állításra lehet hivatkozni.",
          );
      } else if (input.kind === "CONCLUSION") {
        const conclusion = await tx.knowledgeConclusion.findUnique({
          where: { id: input.targetId },
          select: { status: true },
        });
        if (!conclusion)
          throw new ArticleCitationInvalid(
            "conclusionId: nincs ilyen következtetés.",
          );
        if (conclusion.status !== "APPROVED")
          throw new ArticleCitationConflict(
            "Csak jóváhagyott következtetésre lehet hivatkozni.",
          );
      }
      const target =
        input.kind === "NOT_TECHNICAL"
          ? {
              targetKey: "NOT_TECHNICAL",
              reason: input.reason,
              claimId: null,
              conclusionId: null,
            }
          : {
              targetKey: input.targetId,
              reason: null,
              claimId: input.kind === "CLAIM" ? input.targetId : null,
              conclusionId: input.kind === "CONCLUSION" ? input.targetId : null,
            };
      let id: string;
      try {
        ({ id } = await tx.articleCitation.create({
          data: {
            contentId,
            sentence: input.sentence,
            sentenceHash: sentenceHash(input.sentence),
            kind: input.kind,
            createdById: userId,
            ...target,
          },
          select: { id: true },
        }));
        // the first citation makes it a knowledge article, for good
        await tx.articleBody.updateMany({
          where: { contentId, knowledgeSince: null },
          data: { knowledgeSince: new Date() },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
          throw new ArticleCitationConflict("Ez a mondat erre már hivatkozik.");
        throw error;
      }
      await tx.auditLog.create({
        data: {
          userId,
          action: "ARTICLE_CITATION_ADDED",
          entityType: "ArticleCitation",
          entityId: id,
          metadata: { contentId, after: { ...input } },
        },
      });
    });
    return this.report(contentId);
  }

  async remove(
    contentId: string,
    citationId: string,
    userId: string,
  ): Promise<ArticleCitationReport> {
    await prisma.$transaction(async (tx) => {
      const article = await loadArticle(tx, contentId);
      requireEditable(article.state);
      const before = await tx.articleCitation.findFirst({
        where: { id: citationId, contentId },
        select: CITATION_SELECT,
      });
      if (!before) throw new ArticleCitationNotFound("Nincs ilyen hivatkozás.");
      await tx.articleCitation.delete({ where: { id: citationId } });
      await tx.auditLog.create({
        data: {
          userId,
          action: "ARTICLE_CITATION_REMOVED",
          entityType: "ArticleCitation",
          entityId: citationId,
          metadata: { contentId, before },
        },
      });
    });
    return this.report(contentId);
  }

  /**
   * Accepts named warnings of one citation, with a reason. Only a code the
   * check shows for that citation NOW can be answered, and the answer is
   * stored for the warnings it covered, code and detail (`warningKey`): a
   * judgement on a finding the editor saw, not a standing exemption.
   */
  async answer(
    contentId: string,
    citationId: string,
    input: AnswerInput,
    userId: string,
  ): Promise<ArticleCitationReport> {
    await prisma.$transaction(async (tx) => {
      requireEditable((await loadArticle(tx, contentId)).state);
      const { report, rows } = await this.build(tx, contentId);
      const row = rows.find((r) => r.id === citationId);
      if (!row) throw new ArticleCitationNotFound("Nincs ilyen hivatkozás.");
      const check = report.sentences
        .flatMap((s) => s.citations)
        .find((c) => c.id === citationId);
      if (!check)
        throw new ArticleCitationConflict(
          "A hivatkozás mondata már nincs a szövegben: árva hivatkozásra nincs mit válaszolni.",
        );
      const shown = new Set(check.warnings.map((w) => w.code));
      const unknown = input.codes.filter((c) => !shown.has(c));
      if (unknown.length > 0)
        throw new ArticleCitationInvalid(
          `codes: ezt az ellenőrzés most nem jelzi ennél a hivatkozásnál: ${unknown.join(", ")}.`,
        );
      const covered = check.warnings.filter((w) =>
        input.codes.includes(w.code),
      );
      const answeredWarnings = [
        ...new Set([...row.answered, ...covered.map(warningKey)]),
      ];
      const { count } = await tx.articleCitation.updateMany({
        where: {
          id: citationId,
          answeredWarnings: { equals: [...row.answered] },
        },
        data: {
          answeredWarnings,
          answerReason: input.reason,
          answeredById: userId,
          answeredAt: new Date(),
        },
      });
      if (count !== 1)
        throw new ArticleCitationConflict(
          "A hivatkozást közben más is megválaszolta. Töltsd újra.",
        );
      await tx.auditLog.create({
        data: {
          userId,
          action: "ARTICLE_CITATION_WARNINGS_ANSWERED",
          entityType: "ArticleCitation",
          entityId: citationId,
          metadata: {
            contentId,
            before: { answeredWarnings: [...row.answered] },
            after: { answeredWarnings },
            warnings: covered.map((w) => ({
              row: w.row,
              code: w.code,
              detail: w.detail,
            })),
            reason: input.reason,
          },
        },
      });
    });
    return this.report(contentId);
  }
}
