import { Injectable } from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";
import type {
  TeachingAudience,
  TeachingOutputBody,
  TeachingOutputKind,
  TeachingOutputSource,
  TeachingSourceDocument,
} from "@acropora/types";

/** The source's state an output decision reads. */
export interface TeachingOutputSourceState {
  channel: string;
  itemState: string;
  version: number | null;
  approvedVersion: number | null;
}

export interface TeachingOutputRow {
  id: string;
  kind: TeachingOutputKind;
  sourceVersion: number;
  body: TeachingOutputBody;
  audience: TeachingAudience;
  generatedById: string | null;
  generatedAt: Date;
  sentTo: string | null;
  sentPublic: boolean | null;
  sentById: string | null;
  sentAt: Date | null;
  /** When each edited copy was decided on (null: still waiting). */
  edits: { decidedAt: Date | null }[];
}

const OUTPUT_SELECT = {
  id: true,
  kind: true,
  sourceVersion: true,
  body: true,
  generatedById: true,
  generatedAt: true,
  sentTo: true,
  sentPublic: true,
  sentById: true,
  sentAt: true,
  edits: { select: { decidedAt: true } },
} as const;

/**
 * THE OUTPUTS OF A TEACHING SOURCE (T5.2, slice 2b): one row per generation,
 * from one source version. Nothing here edits a row's body; the only write
 * after the creation is the "went out" record, once.
 */
@Injectable()
export class TeachingOutputRepository {
  async state(contentId: string): Promise<TeachingOutputSourceState | null> {
    const item = await prisma.contentItem.findUnique({
      where: { id: contentId },
      select: {
        channel: true,
        state: true,
        teachingSource: { select: { version: true, approvedVersion: true } },
      },
    });
    if (!item) return null;
    return {
      channel: item.channel,
      itemState: item.state,
      version: item.teachingSource?.version ?? null,
      approvedVersion: item.teachingSource?.approvedVersion ?? null,
    };
  }

  /** One stored version of the source, in the shape the generators take. */
  async versionSource(
    contentId: string,
    version: number,
  ): Promise<TeachingOutputSource | null> {
    const row = await prisma.teachingSourceVersion.findUnique({
      where: { contentId_version: { contentId, version } },
    });
    if (!row) return null;
    const document = row.document as unknown as Pick<
      TeachingSourceDocument,
      "parts" | "numbers"
    >;
    return {
      title: row.title,
      version: row.version,
      subtitle: row.subtitle,
      author: row.author,
      editor: row.editor,
      audience: row.audience,
      publicBasis: row.publicBasis,
      disclaimer: row.disclaimer,
      parts: document.parts,
      numbers: document.numbers,
    };
  }

  async create(input: {
    contentId: string;
    kind: TeachingOutputKind;
    sourceVersion: number;
    body: TeachingOutputBody;
    generatedAt: Date;
    userId: string;
  }): Promise<string> {
    const row = await prisma.teachingOutput.create({
      data: {
        contentId: input.contentId,
        kind: input.kind,
        sourceVersion: input.sourceVersion,
        body: input.body as unknown as Prisma.InputJsonValue,
        generatedAt: input.generatedAt,
        generatedById: input.userId,
      },
      select: { id: true },
    });
    return row.id;
  }

  /** The outputs, newest first, each with the audience of the version it came from. */
  async list(contentId: string): Promise<TeachingOutputRow[]> {
    const [rows, versions] = await Promise.all([
      prisma.teachingOutput.findMany({
        where: { contentId },
        orderBy: { generatedAt: "desc" },
        select: OUTPUT_SELECT,
      }),
      prisma.teachingSourceVersion.findMany({
        where: { contentId },
        select: { version: true, audience: true },
      }),
    ]);
    const audience = new Map(versions.map((v) => [v.version, v.audience]));
    return rows.map((row) => ({
      ...row,
      body: row.body as unknown as TeachingOutputBody,
      // both hang on the source, so the version row is there; if not, the closed side
      audience: audience.get(row.sourceVersion) ?? "INTERNAL",
    }));
  }

  async get(contentId: string, id: string): Promise<TeachingOutputRow | null> {
    return (await this.list(contentId)).find((row) => row.id === id) ?? null;
  }

  /**
   * THE "WENT OUT" RECORD, ONCE: a conditional update on a row not yet sent,
   * so two records at the same time leave one, and the second is told.
   *
   * The source's state stands in the SAME statement (barracuda on #2579): the
   * output's version must still be the source's current and approved one. The
   * service checks these before, on its own read, to say why; this condition
   * keeps an approval withdrawn in between from letting the record through.
   * Measured (2026-11-15, Postgres 17, log_statement): Prisma sends it as one
   * `UPDATE ... WHERE ... AND EXISTS (SELECT ... FROM "TeachingSource" ...)`,
   * with no separate read of the ids first.
   */
  async markSent(input: {
    contentId: string;
    id: string;
    sourceVersion: number;
    to: string;
    public: boolean;
    userId: string;
    at: Date;
  }): Promise<boolean> {
    const result = await prisma.teachingOutput.updateMany({
      where: {
        id: input.id,
        contentId: input.contentId,
        sourceVersion: input.sourceVersion,
        sentAt: null,
        source: {
          version: input.sourceVersion,
          approvedVersion: input.sourceVersion,
        },
      },
      data: {
        sentTo: input.to,
        sentPublic: input.public,
        sentById: input.userId,
        sentAt: input.at,
      },
    });
    return result.count === 1;
  }
}
