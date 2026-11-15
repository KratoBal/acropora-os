import { Injectable } from "@nestjs/common";
import { prisma, type Prisma } from "@acropora/database";
import type {
  TeachingEditDecision,
  TeachingOutputBody,
  TeachingOutputKind,
  TeachingSlideText,
} from "@acropora/types";

export interface TeachingOutputEditRow {
  id: string;
  outputId: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  slides: TeachingSlideText[];
  uploadedById: string | null;
  uploadedAt: Date;
  toSource: boolean | null;
  decisionNote: string | null;
  decidedById: string | null;
  decidedAt: Date | null;
}

const EDIT_SELECT = {
  id: true,
  outputId: true,
  fileName: true,
  sizeBytes: true,
  sha256: true,
  slides: true,
  uploadedById: true,
  uploadedAt: true,
  toSource: true,
  decisionNote: true,
  decidedById: true,
  decidedAt: true,
} as const;

const row = (
  r: Omit<TeachingOutputEditRow, "slides"> & { slides: unknown },
) => ({
  ...r,
  slides: r.slides as TeachingSlideText[],
});

/**
 * THE EDITED COPIES OF A TEACHING OUTPUT (T5.2, the "differs from the source"
 * mark). An upload is a row; the only later write is the editor's decision,
 * once. The file's bytes are written, never read back here (the lists carry
 * the text read from it).
 */
@Injectable()
export class TeachingOutputEditRepository {
  /** The output of this content item, its kind and body, or null. */
  async output(
    contentId: string,
    outputId: string,
  ): Promise<{ kind: TeachingOutputKind; body: TeachingOutputBody } | null> {
    const output = await prisma.teachingOutput.findFirst({
      where: { id: outputId, contentId },
      select: { kind: true, body: true },
    });
    return output
      ? {
          kind: output.kind,
          body: output.body as unknown as TeachingOutputBody,
        }
      : null;
  }

  async create(input: {
    outputId: string;
    fileName: string;
    contentType: string;
    sha256: string;
    bytes: Uint8Array;
    slides: TeachingSlideText[];
    userId: string;
  }): Promise<string> {
    const created = await prisma.teachingOutputEdit.create({
      data: {
        outputId: input.outputId,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.bytes.byteLength,
        sha256: input.sha256,
        content: Buffer.from(input.bytes),
        slides: input.slides as unknown as Prisma.InputJsonValue,
        uploadedById: input.userId,
      },
      select: { id: true },
    });
    return created.id;
  }

  async list(outputId: string): Promise<TeachingOutputEditRow[]> {
    const rows = await prisma.teachingOutputEdit.findMany({
      where: { outputId },
      orderBy: { uploadedAt: "desc" },
      select: EDIT_SELECT,
    });
    return rows.map(row);
  }

  async get(
    outputId: string,
    id: string,
  ): Promise<TeachingOutputEditRow | null> {
    const found = await prisma.teachingOutputEdit.findFirst({
      where: { id, outputId },
      select: EDIT_SELECT,
    });
    return found ? row(found) : null;
  }

  /** The decision, once: a conditional update on an undecided row. */
  async decide(input: {
    outputId: string;
    id: string;
    decision: TeachingEditDecision;
    userId: string;
    at: Date;
  }): Promise<boolean> {
    const result = await prisma.teachingOutputEdit.updateMany({
      where: { id: input.id, outputId: input.outputId, decidedAt: null },
      data: {
        toSource: input.decision.toSource,
        decisionNote: input.decision.note,
        decidedById: input.userId,
        decidedAt: input.at,
      },
    });
    return result.count === 1;
  }

  /** Per output: how many edits, and how many still wait for a decision. */
  async counts(
    outputIds: readonly string[],
  ): Promise<Map<string, { edits: number; undecided: number }>> {
    const out = new Map<string, { edits: number; undecided: number }>();
    if (!outputIds.length) return out;
    const rows = await prisma.teachingOutputEdit.findMany({
      where: { outputId: { in: [...outputIds] } },
      select: { outputId: true, decidedAt: true },
    });
    for (const r of rows) {
      const c = out.get(r.outputId) ?? { edits: 0, undecided: 0 };
      c.edits += 1;
      if (!r.decidedAt) c.undecided += 1;
      out.set(r.outputId, c);
    }
    return out;
  }
}
