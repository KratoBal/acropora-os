import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import { warningKey } from "@acropora/knowledge-base";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { ArticleStepError } from "../../content/article.repository.js";
import { ContentRepository } from "../../content/content.repository.js";
import {
  ConclusionConflict,
  ConclusionRepository,
} from "../conclusions/conclusion.repository.js";
import {
  ArticleCitationConflict,
  ArticleCitationInvalid,
  ArticleCitationRepository,
} from "./article-citation.repository.js";
import { sentenceHash } from "./article-citation.js";

/**
 * CONCLUSIONS AND AN ARTICLE'S CITATIONS ON A DATABASE (S5).
 *
 * WHAT TURNS IT RED: a conclusion on a claim that is not VERIFIED; an approved
 * conclusion that still changes; a citation to a sentence the article does
 * not hold, or written while the article waits for approval; a warning
 * answered that the check does not show; a claim citation that also carries
 * a not-technical reason (the CHECK); an article with citations published in the pilot; a write
 * without its AuditLog row.
 */
const gate = integrationDatabaseGate(process.env);
const EMAIL_DOMAIN = "knowledge-citation-integration.invalid";

describe(
  "knowledge conclusions and article citations, on a database",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = Date.now() % 1_000_000;
    const conclusions = new ConclusionRepository();
    const citations = new ArticleCitationRepository();
    const content = new ContentRepository();
    let userId = "";
    let verifiedId = "";
    let candidateId = "";
    const contentIds: string[] = [];

    const claim = async (status: "VERIFIED" | "CANDIDATE") =>
      (
        await prisma.knowledgeClaim.create({
          data: {
            layer: "SCIENTIFIC",
            subject: "PHOSPHATE",
            effect: "CALCIFICATION",
            direction: "DECREASE",
            status,
          },
        })
      ).id;

    const article = async (state: string, bodyHtml: string) => {
      const item = await prisma.contentItem.create({
        data: {
          title: "Mennyi foszfát ideális?",
          channel: "ARTICLE",
          state: state as never,
          article: {
            create: {
              slug: `kb-cit-int-${suffix}-${contentIds.length}`,
              excerpt: "",
              bodyHtml,
            },
          },
        },
      });
      contentIds.push(item.id);
      return item.id;
    };

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      userId = (
        await prisma.user.create({
          data: {
            email: `szerkeszto-${suffix}@${EMAIL_DOMAIN}`,
            displayName: "Kitalált Szerkesztő",
            role: "OWNER",
            isActive: true,
          },
        })
      ).id;
      verifiedId = await claim("VERIFIED");
      candidateId = await claim("CANDIDATE");
    });

    after(removeLeftovers);

    async function removeLeftovers() {
      const users = { email: { endsWith: `@${EMAIL_DOMAIN}` } };
      await prisma.articleCitation.deleteMany({ where: { createdBy: users } });
      await prisma.contentItem.deleteMany({
        where: { id: { in: contentIds } },
      });
      await prisma.knowledgeConclusion.deleteMany({
        where: { createdBy: users },
      });
      await prisma.knowledgeClaim.deleteMany({
        where: { id: { in: [verifiedId, candidateId].filter(Boolean) } },
      });
      await prisma.auditLog.deleteMany({ where: { user: users } });
      await prisma.user.deleteMany({ where: users });
      nincsMaradek([
        {
          nev: "KnowledgeConclusion (teszt-szerkeszto)",
          darab: await prisma.knowledgeConclusion.count({
            where: { createdBy: users },
          }),
        },
        {
          nev: "ArticleCitation (teszt-szerkeszto)",
          darab: await prisma.articleCitation.count({
            where: { createdBy: users },
          }),
        },
        {
          nev: "ContentItem (teszt-cikkek)",
          darab: await prisma.contentItem.count({
            where: { id: { in: contentIds } },
          }),
        },
      ]);
    }

    const audit = (entityId: string) =>
      prisma.auditLog.findMany({
        where: { entityId },
        orderBy: { createdAt: "asc" },
        select: { action: true },
      });

    it("KB-CONC-INT: a conclusion stands on VERIFIED claims, changes only as a draft, and every step is audited", async () => {
      await assert.rejects(
        conclusions.create(
          { text: "K.", reasoning: "R.", claimIds: [candidateId] },
          userId,
        ),
        ConclusionConflict,
      );
      const draft = await conclusions.create(
        { text: "K.", reasoning: "R.", claimIds: [verifiedId] },
        userId,
      );
      assert.equal(draft.status, "DRAFT");
      const edited = await conclusions.update(
        draft.id,
        { text: "K2.", reasoning: "R2.", claimIds: [verifiedId] },
        userId,
      );
      assert.equal(edited.revision, 2);
      const approved = await conclusions.approve(draft.id, userId);
      assert.equal(approved.status, "APPROVED");
      assert.equal(approved.approvedById, userId);
      assert.equal(approved.citationCount, 0);
      // one article sentence on it: the count the withdrawal's question names
      const cited = await article("DRAFTING", "<p>K2 szerint így van.</p>");
      await citations.add(
        cited,
        {
          sentence: "K2 szerint így van.",
          kind: "CONCLUSION",
          targetId: draft.id,
        },
        userId,
      );
      assert.equal((await conclusions.detail(draft.id)).citationCount, 1);
      await assert.rejects(
        conclusions.update(
          draft.id,
          { text: "K3.", reasoning: "R3.", claimIds: [verifiedId] },
          userId,
        ),
        ConclusionConflict,
      );
      const withdrawn = await conclusions.withdraw(draft.id, "elavult", userId);
      assert.equal(withdrawn.status, "WITHDRAWN");
      assert.deepEqual(
        (await audit(draft.id)).map((a) => a.action),
        [
          "KNOWLEDGE_CONCLUSION_CREATED",
          "KNOWLEDGE_CONCLUSION_UPDATED",
          "KNOWLEDGE_CONCLUSION_APPROVED",
          "KNOWLEDGE_CONCLUSION_WITHDRAWN",
        ],
      );
    });

    it("KB-CIT-INT: a citation names a sentence of the text, a warning is answered only as the check shows it, and an edit after the approval request is refused", async () => {
      const id = await article(
        "DRAFTING",
        "<p>A foszfát csökkentette a kalcifikációt. Ez a második mondat.</p>",
      );
      const first = "A foszfát csökkentette a kalcifikációt.";

      await assert.rejects(
        citations.add(
          id,
          {
            sentence: "Nincs ilyen mondat.",
            kind: "CLAIM",
            targetId: verifiedId,
          },
          userId,
        ),
        ArticleCitationInvalid,
      );
      await assert.rejects(
        citations.add(
          id,
          { sentence: first, kind: "CLAIM", targetId: candidateId },
          userId,
        ),
        ArticleCitationConflict,
      );

      let report = await citations.add(
        id,
        { sentence: first, kind: "CLAIM", targetId: verifiedId },
        userId,
      );
      await assert.rejects(
        citations.add(
          id,
          { sentence: first, kind: "CLAIM", targetId: verifiedId },
          userId,
        ),
        ArticleCitationConflict,
      );
      // the claim has no evidence: the sentence check finds the missing scope
      const cited = report.sentences.find((s) => s.sentence === first)!;
      assert.equal(cited.status, "WARNING");
      const check = cited.citations[0]!;
      assert.ok(check.unanswered.length > 0);
      assert.deepEqual(
        report.targets.find((t) => t.id === check.id),
        {
          id: check.id,
          kind: "CLAIM",
          claimId: verifiedId,
          conclusionId: null,
          reason: null,
        },
      );
      assert.deepEqual(
        report.sentences.map((s) => s.status),
        ["UNCITED", "WARNING", "UNCITED"],
      );

      await assert.rejects(
        citations.answer(
          id,
          check.id,
          { codes: ["NOT_SHOWN_HERE"], reason: "mert" },
          userId,
        ),
        ArticleCitationInvalid,
      );
      report = await citations.answer(
        id,
        check.id,
        { codes: check.unanswered, reason: "a szerkesztő mérlegelte" },
        userId,
      );
      assert.equal(
        report.sentences.find((s) => s.sentence === first)?.status,
        "OK",
      );
      // the answer is stored per warning, code and detail, in the #1919 column
      const stored = await prisma.articleCitation.findUniqueOrThrow({
        where: { id: check.id },
        select: { answeredWarnings: true },
      });
      assert.deepEqual(
        [...stored.answeredWarnings].sort(),
        check.warnings.map(warningKey).sort(),
      );

      report = await citations.add(
        id,
        {
          sentence: "Ez a második mondat.",
          kind: "NOT_TECHNICAL",
          reason: "átvezetés",
        },
        userId,
      );
      assert.equal(report.counts.uncited, 1, "the title stays uncited");
      assert.equal(report.clean, false);

      await prisma.contentItem.update({
        where: { id },
        data: { state: "AWAITING_APPROVAL" },
      });
      await assert.rejects(
        citations.remove(id, check.id, userId),
        ArticleCitationConflict,
      );
      assert.deepEqual(
        (await audit(check.id)).map((a) => a.action),
        ["ARTICLE_CITATION_ADDED", "ARTICLE_CITATION_WARNINGS_ANSWERED"],
      );
    });

    it("KB-CIT-CHECK: the database refuses a claim citation that also carries a reason", async () => {
      const id = await article("DRAFTING", "<p>Mondat.</p>");
      await assert.rejects(
        prisma.articleCitation.create({
          data: {
            contentId: id,
            sentence: "Mondat.",
            sentenceHash: sentenceHash("Mondat."),
            kind: "CLAIM",
            claimId: verifiedId,
            reason: "nem szakmai is",
            targetKey: verifiedId,
            createdById: userId,
          },
        }),
        /ArticleCitation_target_by_kind/,
      );
    });

    it("KB-CIT-PILOT: an article that cites the knowledge base is not published in the pilot", async () => {
      const id = await article("DRAFTING", "<p>Mondat.</p>");
      await citations.add(
        id,
        { sentence: "Mondat.", kind: "NOT_TECHNICAL", reason: "teszt" },
        userId,
      );
      const revision = await prisma.articleRevision.create({
        data: {
          contentId: id,
          title: "Mennyi foszfát ideális?",
          excerpt: "",
          bodyHtml: "<p>Mondat.</p>",
          noindex: false,
          contentHash: "x",
          approvedById: userId,
        },
      });
      await prisma.articleBody.update({
        where: { contentId: id },
        data: { approvedRevisionId: revision.id },
      });
      await prisma.contentItem.update({
        where: { id },
        data: { state: "READY_TO_SEND" },
      });
      await assert.rejects(
        content.moveState({
          id,
          from: "READY_TO_SEND" as never,
          to: "SENT" as never,
          actorUserId: userId,
        }),
        ArticleStepError,
      );
      const after = await prisma.contentItem.findUniqueOrThrow({
        where: { id },
        select: {
          state: true,
          article: { select: { publishedRevisionId: true } },
        },
      });
      assert.equal(after.state, "READY_TO_SEND");
      assert.equal(after.article?.publishedRevisionId, null);
    });
  },
);
