import { prisma } from "@acropora/database";
import { Injectable } from "@nestjs/common";

/** Egy kep a listaban -- a tartalma nelkul, az kulon vegponton jon. */
export interface MailImageSummary {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
  readonly createdAt: Date;
}

/** A kep a mellekleteshez: a bajtokkal egyutt. */
export interface MailImageContent {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

const OSSZEGZES = {
  id: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  width: true,
  height: true,
  createdAt: true,
} as const;

/**
 * A LEVELSABLON KEPEI (`MailImage`). Lasd a sema fejlecet: egyszer feltoltve,
 * tobb sablonba beszurhato, torles nincs.
 */
@Injectable()
export class MailImageRepository {
  async findBySha256(sha256: string): Promise<MailImageSummary | null> {
    return prisma.mailImage.findUnique({
      where: { sha256 },
      select: OSSZEGZES,
    });
  }

  async create(input: {
    fileName: string;
    contentType: string;
    width: number;
    height: number;
    sha256: string;
    bytes: Uint8Array;
    uploadedById: string | null;
  }): Promise<MailImageSummary> {
    return prisma.mailImage.create({
      data: {
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.bytes.byteLength,
        width: input.width,
        height: input.height,
        sha256: input.sha256,
        content: Buffer.from(input.bytes),
        uploadedById: input.uploadedById,
      },
      select: OSSZEGZES,
    });
  }

  async list(): Promise<readonly MailImageSummary[]> {
    return prisma.mailImage.findMany({
      select: OSSZEGZES,
      orderBy: { createdAt: "desc" },
    });
  }

  /** A letezo azonositok a kertek kozul -- a mentes ezzel ellenoriz. */
  async existingIds(ids: readonly string[]): Promise<ReadonlySet<string>> {
    if (ids.length === 0) return new Set();
    const sorok = await prisma.mailImage.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true },
    });
    return new Set(sorok.map((sor) => sor.id));
  }

  async contents(ids: readonly string[]): Promise<readonly MailImageContent[]> {
    if (ids.length === 0) return [];
    const sorok = await prisma.mailImage.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, fileName: true, contentType: true, content: true },
    });
    return sorok.map((sor) => ({
      id: sor.id,
      fileName: sor.fileName,
      contentType: sor.contentType,
      bytes: new Uint8Array(sor.content),
    }));
  }
}
