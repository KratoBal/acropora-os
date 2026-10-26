import { Injectable } from "@nestjs/common";
import { prisma } from "@acropora/database";

export interface ArticleImageRow {
  id: string;
  contentType: string;
}

export interface ArticleImageContent {
  contentType: string;
  bytes: Uint8Array;
}

/** The article images' store: the bytes in the database, like the mail images. */
@Injectable()
export class ArticleImageRepository {
  /** The same file uploaded again gives the existing row (same bytes, same address). */
  findBySha256(sha256: string): Promise<ArticleImageRow | null> {
    return prisma.articleImage.findFirst({
      where: { sha256 },
      select: { id: true, contentType: true },
      orderBy: { createdAt: "asc" },
    });
  }

  create(input: {
    contentId: string;
    contentType: string;
    width: number;
    height: number;
    sha256: string;
    bytes: Uint8Array;
    uploadedById: string | null;
  }): Promise<ArticleImageRow> {
    return prisma.articleImage.create({
      data: {
        contentId: input.contentId,
        contentType: input.contentType,
        sizeBytes: input.bytes.byteLength,
        width: input.width,
        height: input.height,
        sha256: input.sha256,
        content: Buffer.from(input.bytes),
        uploadedById: input.uploadedById,
      },
      select: { id: true, contentType: true },
    });
  }

  async content(id: string): Promise<ArticleImageContent | null> {
    const row = await prisma.articleImage.findUnique({
      where: { id },
      select: { contentType: true, content: true },
    });
    return row
      ? { contentType: row.contentType, bytes: new Uint8Array(row.content) }
      : null;
  }
}
