import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type {
  ImportRowResult,
  UnasImportReport,
  UnasParsedWorkbook,
  UnasProductImportRow,
} from "@acropora/types";

import type { CatalogProductSnapshot } from "./unas-diff.engine.js";

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

@Injectable()
export class UnasImportRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async catalogSnapshot(): Promise<Map<string, CatalogProductSnapshot>> {
    const [variants, categoryReferences] = await Promise.all([
      prisma.productVariant.findMany({
        select: {
          sku: true,
          product: {
            select: {
              name: true,
              isActive: true,
              brand: { select: { name: true } },
              categories: { select: { categoryId: true } },
              images: { select: { url: true } },
              channelListings: {
                where: { channel: "UNAS" },
                select: { externalStatus: true },
                take: 1,
              },
            },
          },
        },
      }),
      prisma.externalReference.findMany({
        where: { system: "UNAS", entityType: "Category" },
        select: { entityId: true, externalId: true },
      }),
    ]);
    const categoryExternalId = new Map(
      categoryReferences.map((reference) => [
        reference.entityId,
        reference.externalId,
      ]),
    );
    return new Map(
      variants.map(({ sku, product }) => [
        sku,
        {
          sku,
          name: product.name,
          brandName: product.brand?.name ?? null,
          categoryIds: product.categories
            .map((item) => categoryExternalId.get(item.categoryId))
            .filter((id): id is string => Boolean(id)),
          imageUrls: product.images.map((item) => item.url),
          externalStatus: product.channelListings[0]?.externalStatus ?? null,
          isActive: product.isActive,
        },
      ]),
    );
  }

  async categorySnapshot(): Promise<Map<string, string>> {
    const references = await prisma.externalReference.findMany({
      where: { system: "UNAS", entityType: "Category" },
      select: { externalId: true, entityId: true },
    });
    const categories = await prisma.category.findMany({
      where: { id: { in: references.map((item) => item.entityId) } },
      select: { id: true, name: true },
    });
    const names = new Map(
      categories.map((category) => [category.id, category.name]),
    );
    return new Map(
      references.map((reference) => [
        reference.externalId,
        names.get(reference.entityId) ?? "",
      ]),
    );
  }

  async saveStaging(
    sourceFileName: string,
    fileSha256: string,
    workbook: UnasParsedWorkbook,
    products: ImportRowResult<UnasProductImportRow>[],
  ): Promise<string> {
    const productByRow = new Map(
      products.map((item) => [item.sourceRowNumber, item]),
    );
    const rows: Prisma.CatalogImportRowCreateWithoutBatchInput[] = [
      ...workbook.products.map((row) => {
        const result = productByRow.get(row.sourceRowNumber)!;
        return {
          entityType: "PRODUCT" as const,
          sourceRowNumber: row.sourceRowNumber,
          externalId: row.externalId,
          sku: row.sku || null,
          rawPayload: json(row.rawPayload),
          parsedPayload: json(row),
          issues: json(result.issues),
          status: result.status,
        };
      }),
      ...workbook.categories.map((row) => ({
        entityType: "CATEGORY" as const,
        sourceRowNumber: row.sourceRowNumber,
        externalId: row.externalId,
        rawPayload: json(row.rawPayload),
        parsedPayload: json(row),
        issues: [],
        status: "VALID" as const,
      })),
      ...workbook.brands.map((row) => ({
        entityType: "BRAND" as const,
        sourceRowNumber: row.sourceRowNumber,
        externalId: row.externalId,
        rawPayload: json(row.rawPayload),
        parsedPayload: json(row),
        issues: [],
        status: row.name ? ("VALID" as const) : ("INVALID" as const),
      })),
    ];
    const batch = await prisma.catalogImportBatch.create({
      data: {
        provider: "UNAS",
        sourceFileName,
        fileSha256,
        status: "STAGED",
        rows: { create: rows },
      },
      select: { id: true },
    });
    return batch.id;
  }

  async findReportByHash(fileSha256: string): Promise<UnasImportReport | null> {
    const batch = await prisma.catalogImportBatch.findFirst({
      where: { provider: "UNAS", fileSha256, status: "VALIDATED" },
      orderBy: { createdAt: "desc" },
      select: { report: true },
    });
    return (batch?.report as unknown as UnasImportReport | null) ?? null;
  }

  async saveReport(batchId: string, report: UnasImportReport) {
    await prisma.catalogImportBatch.update({
      where: { id: batchId },
      data: {
        status: "VALIDATED",
        report: json(report),
      },
    });
  }

  async getReport(batchId: string): Promise<UnasImportReport | null> {
    const batch = await prisma.catalogImportBatch.findUnique({
      where: { id: batchId },
      select: { report: true },
    });
    return (batch?.report as unknown as UnasImportReport | null) ?? null;
  }
}
