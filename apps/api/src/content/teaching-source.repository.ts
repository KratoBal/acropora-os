import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";
import {
  analyzeTeachingSource,
  teachingOutputFlags,
  type TeachingOutputBody,
  type TeachingSourceDetail,
  type TeachingSourceListItem,
  type TeachingSourceDocument,
  type TeachingSourceInput,
} from "@acropora/types";

import { ARTICLE_EDITABLE_STATES } from "./article-states.js";
import type { ContentState } from "./content-state.js";

/** Why a move on a teaching source cannot happen; the service answers 409 with it. */
export class TeachingSourceStepError extends Error {}

type Tx = Prisma.TransactionClient;

/** The document part of a source: the parts and the number table. */
type StoredDocument = Pick<TeachingSourceDocument, "parts" | "numbers">;

/**
 * JSON with its object keys sorted, so a hash does not depend on the order
 * the keys were written in.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}

/** The sha256 of a source: its title, its header fields and its document. */
export function teachingSourceHash(
  title: string,
  source: TeachingSourceDocument,
): string {
  return createHash("sha256")
    .update(
      canonical([
        title,
        source.subtitle,
        source.author,
        source.editor,
        source.audience,
        source.publicBasis,
        source.disclaimer,
        source.parts,
        source.numbers,
      ]),
    )
    .digest("hex");
}

/** The editor's message for the open questions that stop an approval, or null. */
export function teachingApprovalBlock(document: StoredDocument): string | null {
  const analysis = analyzeTeachingSource(document);
  if (analysis.problems.length)
    return `A forrásban hibás szám-hivatkozás áll, ezért nem hagyható jóvá: ${analysis.problems
      .slice(0, 5)
      .map((p) => p.message)
      .join(" ")}`;
  if (analysis.openQuestions.length)
    return `A forrásban nyitott kérdés áll, ezért nem hagyható jóvá (${analysis.openQuestions
      .map((q) => q.numberId)
      .join(
        ", ",
      )}). Az ellentmondó számot a szerkesztő a környezetével különbözteti meg, vagy javítja; a rendszer nem választ helyette.`;
  return null;
}

/**
 * THE TEACHING SOURCE'S PART OF A STATE MOVE, inside the move's own
 * transaction (called from `ContentRepository.moveState`), so a state and its
 * approved version never part. Nothing happens for another channel.
 *
 *   AWAITING_APPROVAL -> READY_TO_SEND   the approval: only a source with no
 *                                        open question and no broken
 *                                        reference (spec v2, point 3); the
 *                                        approved version is recorded
 *   any -> AWAITING_REVISION | DISCARDED the approval is withdrawn
 *
 * A source is never scheduled or sent (`allowedMoves`): its outputs go out,
 * each recorded on its own (a later slice).
 */
export async function applyTeachingSourceStep(
  tx: Tx,
  input: { contentId: string; from: ContentState; to: ContentState },
): Promise<void> {
  const item = await tx.contentItem.findUnique({
    where: { id: input.contentId },
    select: { channel: true },
  });
  if (!item || item.channel !== "TEACHING_SOURCE") return;
  const source = await tx.teachingSource.findUnique({
    where: { contentId: input.contentId },
    select: { document: true, version: true, approvedVersion: true },
  });

  if (input.from === "AWAITING_APPROVAL" && input.to === "READY_TO_SEND") {
    if (!source)
      throw new TeachingSourceStepError(
        "Az oktatóanyagnak még nincs forrása: jóváhagyás előtt írd meg.",
      );
    const blocked = teachingApprovalBlock(
      source.document as unknown as StoredDocument,
    );
    if (blocked) throw new TeachingSourceStepError(blocked);
    await tx.teachingSource.update({
      where: { contentId: input.contentId },
      data: { approvedVersion: source.version },
    });
    return;
  }

  if (
    (input.to === "AWAITING_REVISION" || input.to === "DISCARDED") &&
    source?.approvedVersion != null
  )
    await tx.teachingSource.update({
      where: { contentId: input.contentId },
      data: { approvedVersion: null },
    });
}

export type TeachingSourceSaveOutcome =
  | { kind: "ok"; version: number; changed: boolean }
  | { kind: "missing" | "not-teaching-source" | "not-editable" }
  | { kind: "stale"; currentVersion: number | null };

@Injectable()
export class TeachingSourceRepository {
  async detail(contentId: string): Promise<TeachingSourceDetail | null> {
    const source = await prisma.teachingSource.findUnique({
      where: { contentId },
      include: {
        versions: {
          orderBy: { version: "desc" },
          select: {
            version: true,
            contentHash: true,
            createdById: true,
            createdAt: true,
          },
        },
      },
    });
    if (!source) return null;
    const document = source.document as unknown as StoredDocument;
    return {
      contentId: source.contentId,
      subtitle: source.subtitle,
      author: source.author,
      editor: source.editor,
      audience: source.audience,
      publicBasis: source.publicBasis,
      disclaimer: source.disclaimer,
      parts: document.parts,
      numbers: document.numbers,
      version: source.version,
      contentHash: source.contentHash,
      approvedVersion: source.approvedVersion,
      versions: source.versions.map((v) => ({
        version: v.version,
        contentHash: v.contentHash,
        createdById: v.createdById,
        createdAt: v.createdAt.toISOString(),
      })),
      updatedAt: source.updatedAt.toISOString(),
    };
  }

  /** Whether this item is a teaching source whose text may change now. */
  async editable(contentId: string): Promise<boolean> {
    const item = await prisma.contentItem.findUnique({
      where: { id: contentId },
      select: { channel: true, state: true },
    });
    return (
      item?.channel === "TEACHING_SOURCE" &&
      ARTICLE_EDITABLE_STATES.includes(item.state as ContentState)
    );
  }

  /**
   * THE SOURCE AND ITS NEW VERSION, in one transaction, only while the item is
   * a teaching source in an editable state (the article's states: from
   * AWAITING_APPROVAL on, the text is under the approver's eye). The item row
   * is locked for the whole save, as the article's is, so an approval that
   * runs meanwhile reads the document this save wrote.
   *
   * A save on an older version than the stored one is refused (`stale`); an
   * unchanged save writes nothing and keeps the version.
   */
  async save(
    contentId: string,
    input: TeachingSourceInput,
    userId: string,
  ): Promise<TeachingSourceSaveOutcome> {
    return prisma.$transaction(async (tx) => {
      const [item] = await tx.$queryRaw<
        { channel: string; state: string; title: string }[]
      >`SELECT "channel"::text AS channel, "state"::text AS state, "title" FROM "ContentItem" WHERE "id" = ${contentId} FOR UPDATE`;
      if (!item) return { kind: "missing" as const };
      if (item.channel !== "TEACHING_SOURCE")
        return { kind: "not-teaching-source" as const };
      if (!ARTICLE_EDITABLE_STATES.includes(item.state as ContentState))
        return { kind: "not-editable" as const };

      const { baseVersion, ...source } = input;
      const existing = await tx.teachingSource.findUnique({
        where: { contentId },
        select: { version: true, contentHash: true },
      });
      if ((existing?.version ?? null) !== baseVersion)
        return {
          kind: "stale" as const,
          currentVersion: existing?.version ?? null,
        };

      const contentHash = teachingSourceHash(item.title, source);
      if (existing && existing.contentHash === contentHash)
        return {
          kind: "ok" as const,
          version: existing.version,
          changed: false,
        };

      const version = (existing?.version ?? 0) + 1;
      const header = {
        subtitle: source.subtitle,
        author: source.author,
        editor: source.editor,
        audience: source.audience,
        publicBasis: source.publicBasis,
        disclaimer: source.disclaimer,
        document: {
          parts: source.parts,
          numbers: source.numbers,
        } as unknown as Prisma.InputJsonValue,
        contentHash,
      };
      await tx.teachingSource.upsert({
        where: { contentId },
        create: { contentId, ...header, version, updatedById: userId },
        update: { ...header, version, updatedById: userId },
      });
      await tx.teachingSourceVersion.create({
        data: {
          contentId,
          version,
          title: item.title,
          ...header,
          createdById: userId,
        },
      });
      return { kind: "ok" as const, version, changed: true };
    });
  }

  /**
   * THE SOURCE LIST (spec v2, point 4): every teaching source not discarded,
   * newest change first, with its outputs counted by state. An output is
   * stale when the source has a newer version; it differs when an edited
   * copy was uploaded to it; over the frame when its deck says so.
   */
  async list(limit = 200): Promise<TeachingSourceListItem[]> {
    const items = await prisma.contentItem.findMany({
      where: { channel: "TEACHING_SOURCE", state: { not: "DISCARDED" } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        title: true,
        state: true,
        updatedAt: true,
        teachingSource: {
          select: {
            version: true,
            approvedVersion: true,
            audience: true,
            document: true,
            updatedAt: true,
            outputs: {
              select: {
                sourceVersion: true,
                body: true,
                sentAt: true,
                // only the edited copies still waiting for a decision: those
                // ask for work (whether one differs is measured on reading it)
                _count: { select: { edits: { where: { decidedAt: null } } } },
              },
            },
          },
        },
      },
    });
    return items.map((item) => {
      const source = item.teachingSource;
      const outputs = source?.outputs ?? [];
      // the same rules as the output list (teaching-output.service.ts):
      // stale when the source is newer, approved when its version is the approved one
      const isStale = (o: { sourceVersion: number }) =>
        o.sourceVersion < (source?.version ?? 0);
      const isApproved = (o: { sourceVersion: number }) =>
        o.sourceVersion === source?.approvedVersion;
      return {
        contentId: item.id,
        title: item.title,
        state: item.state,
        version: source?.version ?? null,
        approvedVersion: source?.approvedVersion ?? null,
        audience: source?.audience ?? null,
        openQuestions: source
          ? analyzeTeachingSource(source.document as unknown as StoredDocument)
              .openQuestions.length
          : 0,
        outputs: {
          total: outputs.length,
          current: outputs.filter((o) => !isStale(o) && isApproved(o)).length,
          stale: outputs.filter(isStale).length,
          withdrawn: outputs.filter((o) => !isStale(o) && !isApproved(o))
            .length,
          awaitingDecision: outputs.filter((o) => o._count.edits > 0).length,
          overFrame: outputs.filter(
            (o) =>
              teachingOutputFlags(o.body as unknown as TeachingOutputBody)
                .overFrame > 0,
          ).length,
          sent: outputs.filter((o) => o.sentAt).length,
        },
        updatedAt: (source?.updatedAt ?? item.updatedAt).toISOString(),
      };
    });
  }
}
